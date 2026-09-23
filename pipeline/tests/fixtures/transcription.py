"""Build a core song's source from a transcription written as text.

Each core song after Ode to Joy is a module holding its tune as text, the way
``ode_to_joy.py`` does, and calls ``score()`` here. Unlike Ode to Joy, bars are
taken from the text rather than recomputed, so the "|" a reader sees is the
barline the player sees, and a bar whose notes do not add up to the metre is an
error rather than a silent shift of every note after it. Only the first bar may
be short (a pickup) and only the last may be short (the pickup's complement).

Melody tokens: a pitch (or "r" for a rest), then an optional ":duration", then
an optional "~" to tie into the next note. Accompaniment tokens: a chord name
from the song's CHORDS (or "r"), with the same optional ":duration".
Durations: s sixteenth, e eighth, q quarter (the melody's default), h half,
w whole; a trailing "." dots it. An accompaniment chord defaults to a full bar.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from itertools import pairwise

from music21 import chord, clef, duration, key, layout, metadata, meter, note, stream, tempo, tie

_DURATIONS = {
    "s": Fraction(1, 4),
    "e": Fraction(1, 2),
    "q": Fraction(1),
    "h": Fraction(2),
    "w": Fraction(4),
}


@dataclass(frozen=True)
class Tune:
    title: str
    composer: str | None
    key: str  # music21 key name, e.g. "G" or "a" (lower case is minor)
    time: str  # e.g. "3/4"
    tempo_bpm: int
    melody: str
    accompaniment: str
    chords: dict[str, str]


def _quarter_length(token: str) -> Fraction:
    dotted = token.endswith(".")
    base = _DURATIONS[token.rstrip(".")]
    return base * Fraction(3, 2) if dotted else base


def _bars(text: str) -> list[list[str]]:
    return [bar.split() for bar in text.replace("\n", " | ").split("|") if bar.split()]


def _melody_bar(tokens: list[str]) -> list[note.GeneralNote]:
    out: list[note.GeneralNote] = []
    for token in tokens:
        tied = token.endswith("~")
        pitch, _, dur = token.rstrip("~").partition(":")
        n: note.GeneralNote = note.Rest() if pitch == "r" else note.Note(pitch)
        n.duration = duration.Duration(_quarter_length(dur or "q"))
        if tied:
            n.tie = tie.Tie("start")
        out.append(n)
    return out


def _chord_bar(tokens: list[str], chords: dict[str, str], bar: Fraction) -> list[note.GeneralNote]:
    out: list[note.GeneralNote] = []
    for token in tokens:
        name, _, dur = token.partition(":")
        c: note.GeneralNote = note.Rest() if name == "r" else chord.Chord(chords[name].split())
        c.duration = duration.Duration(_quarter_length(dur) if dur else bar)
        out.append(c)
    return out


def _close_ties(notes: list[note.GeneralNote]) -> None:
    """A "~" starts a tie; the note after it is where the tie ends."""
    for before, after in pairwise(notes):
        if isinstance(before, note.Note) and before.tie is not None and before.tie.type == "start":
            if not isinstance(after, note.Note) or after.pitch != before.pitch:
                raise ValueError(f"a tie from {before} must end on the same pitch, not {after}")
            after.tie = tie.Tie("stop")


def _check_lengths(label: str, lengths: list[Fraction], bar: Fraction) -> None:
    for i, length in enumerate(lengths):
        edge = i in (0, len(lengths) - 1)
        if length > bar or (length < bar and not edge):
            raise ValueError(f"{label} bar {i + 1} lasts {length} quarters, not {bar}")


def _part(part_id: str, name: str, bars: list[list[note.GeneralNote]], tune: Tune) -> stream.Part:
    part = stream.Part(id=part_id)
    part.partName = name
    bar = Fraction(meter.TimeSignature(tune.time).barDuration.quarterLength)
    pickup = sum((Fraction(n.quarterLength) for n in bars[0]), Fraction(0)) < bar
    offset = Fraction(0)
    for i, contents in enumerate(bars):
        m = stream.Measure(number=i if pickup else i + 1)
        if i == 0:
            m.append(clef.TrebleClef() if part_id == "P1" else clef.BassClef())
            m.append(key.Key(tune.key))
            m.append(meter.TimeSignature(tune.time))
            if pickup:
                m.paddingLeft = float(bar - sum(Fraction(n.quarterLength) for n in contents))
        for n in contents:
            m.append(n)
        part.insert(offset, m)
        offset += sum((Fraction(n.quarterLength) for n in contents), Fraction(0))
    return part


def score(tune: Tune) -> stream.Score:
    """The transcription as a two-part score, right hand over left."""
    bar = Fraction(meter.TimeSignature(tune.time).barDuration.quarterLength)
    melody = [_melody_bar(tokens) for tokens in _bars(tune.melody)]
    accompaniment = [_chord_bar(tokens, tune.chords, bar) for tokens in _bars(tune.accompaniment)]
    _close_ties([n for b in melody for n in b])
    lengths = [
        [sum((Fraction(n.quarterLength) for n in b), Fraction(0)) for b in p]
        for p in (melody, accompaniment)
    ]
    _check_lengths("melody", lengths[0], bar)
    _check_lengths("accompaniment", lengths[1], bar)
    if lengths[0] != lengths[1]:
        raise ValueError(f"{tune.title}: the hands' bars differ: {lengths[0]} vs {lengths[1]}")

    s = stream.Score()
    s.metadata = metadata.Metadata(title=tune.title)
    if tune.composer:
        s.metadata.composer = tune.composer
    s.insert(0, _part("P1", "Right hand", melody, tune))
    s.insert(0, _part("P2", "Left hand", accompaniment, tune))
    first = s.parts[0].getElementsByClass(stream.Measure).first()
    assert first is not None
    first.insert(0, tempo.MetronomeMark(number=tune.tempo_bpm))
    s.insert(0, layout.StaffGroup(list(s.parts), symbol="brace"))
    return s
