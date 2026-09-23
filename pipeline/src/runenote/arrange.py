"""Turn a source into tiers.

The rules are the ones in docs/DECISIONS.md: simplify by removing layers, by
transposing to a friendlier key and by folding a stray note back into reach,
and never by rewriting the melody's rhythm. Which layers, how far, and to
which keys is the tier table's business (``tiers.yaml``), not this module's.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from music21 import chord, interval, key, layout, metadata, note, pitch, stream, tempo

from runenote import band, stems
from runenote.source import Source
from runenote.tiers import Tier


class ArrangeError(Exception):
    """The source cannot be arranged at any level; the message says why."""


@dataclass(frozen=True)
class ArrangedTier:
    tier: Tier
    score: stream.Score
    low: int
    high: int
    folded: int
    """Melody notes moved by an octave to fit the tier's reach."""
    difficulty: float


@dataclass(frozen=True)
class Backing:
    style: band.Style
    score: stream.Score


@dataclass(frozen=True)
class Arrangement:
    key: key.Key
    semitones: int
    """How far the song moved from its written key; 0 when it stayed."""
    tiers: list[ArrangedTier]
    backing: Backing | stems.StemBacking | None
    """The band, generated or played from the source's own parts by role; or
    None when the song has no harmony to build one from or no style fits its
    time signature."""


@dataclass(frozen=True)
class FoldPlan:
    low: int
    high: int
    folded: int


def arrange(
    source: Source,
    melody: int,
    tiers: Sequence[Tier],
    styles: Sequence[band.Style] | None = None,
    roles: Mapping[int, str] | None = None,
) -> Arrangement:
    """``roles``, when given, name what each non-melody part of a MIDI source
    does (see stems.py): the backing is then those parts themselves, and the
    left hand is read from the bass and keys parts only."""
    melody_part = source.part(melody)
    if roles is not None:
        if source.kind != "midi":
            msg = f"{source.path}: roles need a MIDI source; the backing is copied from its tracks"
            raise ArrangeError(msg)
        try:
            stems.check(stems.read(source.path), melody, roles)
        except stems.StemError as error:
            raise ArrangeError(f"{source.path}: {error}") from error
    accompaniment = [
        p
        for i, p in enumerate(source.score.parts, start=1)
        if i != melody and (roles is None or roles.get(i) in ("bass", "keys"))
    ]
    midis = _midis(_skyline(melody_part))
    if not midis:
        msg = f"{source.path}: part {melody} has no notes to be the melody"
        raise ArrangeError(msg)

    fitting = [t for t in tiers if _fits(t, midis, has_accompaniment=bool(accompaniment))]
    if not fitting:
        msg = f"{source.path}: the melody meets no tier's rules; nothing to arrange"
        raise ArrangeError(msg)

    # One key for the whole song, chosen for the easiest level it reaches.
    target, semitones = nearest_key(source.key, fitting[0].max_accidentals)
    shift = _shift(source.key, target, semitones)
    melody_t = melody_part.transpose(shift)
    accompaniment_t = [p.transpose(shift) for p in accompaniment]

    if roles is not None:
        bass_t = [p.transpose(shift) for i, p in _numbered(source) if roles.get(i) == "bass"]
        keys_t = [p.transpose(shift) for i, p in _numbered(source) if roles.get(i) == "keys"]

        def left(layers: frozenset[str]) -> stream.Part:
            return _left_hand_from_roles(bass_t, keys_t, layers)

        arranged = [_build(source, tier, melody_t, left, target) for tier in fitting]
        try:
            played = stems.build(source.path, melody, roles, semitones)
        except stems.StemError as error:
            raise ArrangeError(f"{source.path}: {error}") from error
        return Arrangement(key=target, semitones=semitones, tiers=arranged, backing=played)

    def chordified(layers: frozenset[str]) -> stream.Part:
        return _left_hand(accompaniment_t, layers)

    arranged = [_build(source, tier, melody_t, chordified, target) for tier in fitting]

    # The band is generated from the accompaniment's harmony rather than being
    # the accompaniment itself: see band.py, and DECISIONS, "The backing is a
    # band, and it plays the parts you are not playing".
    backing = None
    style = band.choose(styles if styles is not None else band.load_styles(), source.time_signature)
    if accompaniment_t and style is not None:
        score = band.build(melody_t, accompaniment_t, style)
        _set_tempo(score, source.tempo_bpm)
        backing = Backing(style=style, score=score)

    return Arrangement(key=target, semitones=semitones, tiers=arranged, backing=backing)


def nearest_key(source: key.Key, max_accidentals: int | None) -> tuple[key.Key, int]:
    """The key with at most ``max_accidentals`` sharps or flats that is the
    fewest semitones from ``source``, and how many. Ties go downward."""
    if max_accidentals is None or abs(source.sharps) <= max_accidentals:
        return source, 0

    def shift(candidate: key.Key) -> int:
        up = (candidate.tonic.pitchClass - source.tonic.pitchClass) % 12
        return up - 12 if up >= 6 else up

    candidates = [
        key.KeySignature(fifths).asKey(source.mode)
        for fifths in range(-max_accidentals, max_accidentals + 1)
    ]
    best = min(candidates, key=lambda k: (abs(shift(k)), shift(k)))
    return best, shift(best)


def fold_plan(midis: Sequence[int], span: int) -> FoldPlan:
    """The window of ``span`` semitones that leaves the most notes where they
    are, preferring one that holds the first note, then the lower one."""

    def inside(low: int) -> int:
        return sum(low <= m <= low + span for m in midis)

    low = max(sorted(set(midis)), key=lambda x: (inside(x), x <= midis[0] <= x + span, -x))
    return FoldPlan(low=low, high=low + span, folded=len(midis) - inside(low))


def _fits(tier: Tier, midis: Sequence[int], *, has_accompaniment: bool) -> bool:
    if tier.hands == "both" and not has_accompaniment:
        return False
    if tier.span is None or max(midis) - min(midis) <= tier.span:
        return True
    if not tier.fold:
        return False
    return fold_plan(midis, tier.span).folded <= tier.max_folded * len(midis)


def _build(
    source: Source,
    tier: Tier,
    melody: stream.Part,
    left_hand: Callable[[frozenset[str]], stream.Part],
    target: key.Key,
) -> ArrangedTier:
    right = copy.deepcopy(melody) if "harmony" in tier.layers else _skyline(melody)
    right.partName = "Right hand"
    folded = 0
    if tier.fold and tier.span is not None:
        midis = _midis(right)
        if max(midis) - min(midis) > tier.span:
            folded = _fold(right, fold_plan(midis, tier.span))

    parts = [right]
    if tier.hands == "both":
        parts.append(left_hand(tier.layers))

    score = stream.Score()
    score.metadata = metadata.Metadata(title=source.title)
    if source.composer:
        score.metadata.composer = source.composer
    for part in parts:
        score.insert(0, part)
    if len(parts) > 1:
        score.insert(0, layout.StaffGroup(parts, symbol="brace"))
    _set_tempo(score, source.tempo_bpm)

    pitches = [p.midi for part in parts for n in part.flatten().notes for p in n.pitches]
    return ArrangedTier(
        tier=tier,
        score=score,
        low=min(pitches),
        high=max(pitches),
        folded=folded,
        difficulty=_difficulty(parts, target),
    )


def _left_hand(accompaniment: Sequence[stream.Part], layers: frozenset[str]) -> stream.Part:
    if len(accompaniment) == 1:
        left = copy.deepcopy(accompaniment[0])
    else:
        # Several accompanying parts (an orchestration, say) collapse into one
        # hand's worth of chords.
        left = stream.Score([copy.deepcopy(p) for p in accompaniment]).chordify()
    if "harmony" not in layers:
        _replace_chords(left, lambda c: min(c.pitches, key=lambda p: p.midi))
    left.partName = "Left hand"
    return left


# The most notes a reduced left-hand chord holds: the bass and two above it,
# all inside an octave, so one hand can always take it.
LEFT_HAND_NOTES = 3


def _left_hand_from_roles(
    bass: Sequence[stream.Part],
    keys: Sequence[stream.Part],
    layers: frozenset[str],
) -> stream.Part:
    """One hand's worth of an orchestra's bass and harmony.

    Chordifying an orchestration straight into the left hand gives chords no
    hand can hold (Zelda's Lullaby: five notes, three and a half octaves
    apart). So the hand follows the bass line's rhythm and, where the tier
    asks for harmony, adds the chord the keys are sounding at that moment,
    closed up inside the octave above the bass: the same voicing the band's
    keys use. The pitches are the orchestra's; only the spacing is new.
    """
    left = _left_hand(bass or keys, frozenset())
    if "harmony" in layers:
        flats = [part.flatten() for part in [*bass, *keys]]
        sounding = [(float(flat.elementOffset(n)), n) for flat in flats for n in flat.notes]
        # A tied note keeps the chord it started with, or the tie would join
        # two different chords.
        voiced: list[pitch.Pitch] = []
        for n in sorted(left.recurse().getElementsByClass(note.Note), key=_offset_in(left)):
            container = n.activeSite
            if n.tie is None or n.tie.type == "start" or not voiced:
                at = _offset_in(left)(n)
                heard = [
                    p
                    for start, s in sounding
                    if start <= at < start + float(s.quarterLength)
                    for p in s.pitches
                ]
                voiced = _close_above(n.pitch, heard)
            if len(voiced) > 1 and container is not None:
                held = chord.Chord([copy.deepcopy(p) for p in voiced])
                held.duration = copy.deepcopy(n.duration)
                held.tie = n.tie
                container.replace(n, held)
    left.partName = "Left hand"
    return left


def _offset_in(site: stream.Stream[Any]) -> Callable[[note.GeneralNote], float]:
    return lambda n: float(n.getOffsetInHierarchy(site))


def _close_above(root: pitch.Pitch, heard: Sequence[pitch.Pitch]) -> list[pitch.Pitch]:
    """The bass, and the other pitch classes heard, each placed in the octave
    above it and kept nearest first, spelled as the orchestra spelled them."""
    placed: dict[int, pitch.Pitch] = {}
    for p in heard:
        step = (p.pitchClass - root.pitchClass) % 12
        if step == 0 or step in placed:
            continue
        above = copy.deepcopy(p)
        above.octave = root.octave
        while above.midi <= root.midi:
            above.octave = (above.octave or 4) + 1
        while above.midi > root.midi + 12:
            above.octave = (above.octave or 4) - 1
        placed[step] = above
    return [copy.deepcopy(root), *[placed[s] for s in sorted(placed)][: LEFT_HAND_NOTES - 1]]


def _numbered(source: Source) -> list[tuple[int, stream.Part]]:
    return list(enumerate(source.score.parts, start=1))


def _skyline(part: stream.Part) -> stream.Part:
    """The melody layer: the top note wherever the part has a chord."""
    top = copy.deepcopy(part)
    _replace_chords(top, lambda c: max(c.pitches, key=lambda p: p.midi))
    return top


def _replace_chords(part: stream.Part, pick: Callable[[chord.Chord], pitch.Pitch]) -> None:
    for container in [part, *part.recurse(streamsOnly=True)]:
        for c in list(container.getElementsByClass(chord.Chord)):
            n = note.Note(pick(c))
            n.duration = copy.deepcopy(c.duration)
            n.tie = c.tie
            container.replace(c, n)


def _fold(part: stream.Part, plan: FoldPlan) -> int:
    moved = 0
    for n in part.recurse().getElementsByClass(note.Note):
        before = n.pitch.midi
        while n.pitch.midi > plan.high:
            n.pitch.octave = (n.pitch.octave or 4) - 1
        while n.pitch.midi < plan.low:
            n.pitch.octave = (n.pitch.octave or 4) + 1
        moved += n.pitch.midi != before
    return moved


def _midis(part: stream.Part) -> list[int]:
    return [p.midi for n in part.flatten().notes for p in n.pitches]


def _shift(source: key.Key, target: key.Key, semitones: int) -> interval.Interval:
    """A named interval, so transposition keeps its spelling and moves the
    key signature with it."""
    start = pitch.Pitch(source.tonic.name, octave=4)
    end = pitch.Pitch(target.tonic.name, octave=4)
    end.octave = 4 + (start.midi + semitones - end.midi) // 12
    return interval.Interval(start, end)


def _set_tempo(score: stream.Score, bpm: float) -> None:
    """One tempo, the bundle's, wherever the source put its marks."""
    for mark in list(score.recurse().getElementsByClass(tempo.MetronomeMark)):
        mark.activeSite.remove(mark)
    first = score.parts.first()
    if first is None:
        return
    target = first.getElementsByClass(stream.Measure).first() or first
    target.insert(0, tempo.MetronomeMark(number=bpm))


def _difficulty(parts: Sequence[stream.Part], target: key.Key) -> float:
    """A rough score for ordering songs within a level. Wider, busier, more
    rhythms, more accidentals and two hands all count; the weights are a
    first guess, to be re-tuned once there are enough songs to compare."""
    notes = [n for part in parts for n in part.flatten().notes]
    bars = max(len(part.getElementsByClass(stream.Measure)) for part in parts) or 1
    reach = max(max(m) - min(m) for m in map(_midis, parts))
    played = sum(len(n.pitches) for n in notes)
    rhythms = {n.duration.quarterLength for n in notes}
    score = (
        reach * 1.5
        + len(rhythms) * 5
        + played / bars * 2
        + abs(int(target.sharps)) * 4
        + (15 if len(parts) > 1 else 0)
    )
    return round(min(100.0, float(score)), 1)
