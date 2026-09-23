"""Load a source file into what the arranger needs: the score, its parts, and
the facts about it a bundle must state.

MusicXML or MIDI; both feed this same :class:`Source`. MIDI is how most game
piano arrangements are published (NinSheetMusic offers MIDI, not MusicXML),
so it is quantised on the way in: a notation program's MIDI export is
already on the grid, and rounding to sixteenths and triplet eighths only
removes the odd tick of drift.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import fmean

from music21 import converter, key, meter, pitch, stream, tempo

MUSICXML_SUFFIXES = frozenset({".musicxml", ".mxl", ".xml"})
MIDI_SUFFIXES = frozenset({".mid", ".midi"})
# Sixteenths and eighth-note triplets. Finer divisions would keep a
# performance's slop as written rhythm, which the tiers then have to read.
MIDI_GRID = (4, 3)

# When a source states no tempo, this is a guess and the CLI says so.
DEFAULT_TEMPO_BPM = 120.0


class SourceError(Exception):
    """The file cannot be arranged as it stands; the message says why."""


@dataclass(frozen=True)
class PartInfo:
    """What a human needs to see to pick the melody."""

    index: int
    """1-based position in the score; the stable way to name a part."""
    name: str
    notes: int
    low: int
    high: int
    mean_pitch: float


@dataclass(frozen=True)
class Source:
    path: Path
    score: stream.Score
    title: str
    composer: str | None
    key: key.Key
    time_signature: str
    tempo_bpm: float
    tempo_is_default: bool

    @property
    def kind(self) -> str:
        """What song.json records as the source's format."""
        return "midi" if self.path.suffix.lower() in MIDI_SUFFIXES else "musicxml"

    @property
    def parts(self) -> list[PartInfo]:
        infos = []
        for index, part in enumerate(self.score.parts, start=1):
            midis = [p.midi for n in part.flatten().notes for p in n.pitches]
            infos.append(
                PartInfo(
                    index=index,
                    name=str(part.partName or part.id or f"part {index}"),
                    notes=len(midis),
                    low=min(midis, default=0),
                    high=max(midis, default=0),
                    mean_pitch=fmean(midis) if midis else 0.0,
                )
            )
        return infos

    def suggested_melody(self) -> int:
        """The part that sits highest. Right far more often than wrong, which
        is why a human confirms it rather than choosing from scratch."""
        candidates = [p for p in self.parts if p.notes]
        if not candidates:
            msg = f"{self.path}: no part has any notes"
            raise SourceError(msg)
        return max(candidates, key=lambda p: p.mean_pitch).index

    def part(self, index: int) -> stream.Part:
        parts = list(self.score.parts)
        if not 1 <= index <= len(parts):
            msg = f"{self.path}: no part {index}; it has {len(parts)}"
            raise SourceError(msg)
        return parts[index - 1]


def load(path: Path, *, tempo_bpm: float | None = None) -> Source:
    suffix = path.suffix.lower()
    if suffix in MUSICXML_SUFFIXES:
        parsed = converter.parse(path)
    elif suffix in MIDI_SUFFIXES:
        parsed = converter.parse(path, quantizePost=True, quarterLengthDivisors=MIDI_GRID)
    else:
        known = sorted(MUSICXML_SUFFIXES | MIDI_SUFFIXES)
        msg = f"{path}: not a MusicXML or MIDI file (expected one of {known})"
        raise SourceError(msg)
    if not isinstance(parsed, stream.Score):
        msg = f"{path}: parsed as {type(parsed).__name__}, not a score"
        raise SourceError(msg)

    signatures = list(parsed.flatten().getElementsByClass(meter.TimeSignature))
    if not signatures:
        msg = f"{path}: no time signature"
        raise SourceError(msg)

    marks = [m for m in parsed.flatten().getElementsByClass(tempo.MetronomeMark) if m.number]
    stated = marks[0].getQuarterBPM() if marks else None
    if tempo_bpm is not None:
        bpm, guessed = tempo_bpm, False
    elif stated is not None:
        # A MIDI tempo is microseconds a beat, so 110 bpm reads back as
        # 110.00000000000001; nobody wrote the extra digits.
        bpm, guessed = round(float(stated), 2), False
    else:
        bpm, guessed = DEFAULT_TEMPO_BPM, True

    return Source(
        path=path,
        score=parsed,
        # A MIDI file seldom names its piece; the file name is the next best.
        title=(parsed.metadata.bestTitle if parsed.metadata else None) or path.stem,
        composer=parsed.metadata.composer if parsed.metadata else None,
        key=_written_key(parsed),
        time_signature=_metre(parsed, signatures),
        tempo_bpm=bpm,
        tempo_is_default=guessed,
    )


def _metre(score: stream.Score, signatures: list[meter.TimeSignature]) -> str:
    """The time signature that governs most of the song.

    Not simply the first: notation programs often write a pickup as a bar of
    its own metre (Song of Time arrives as one bar of 1/4, then 4/4 to the
    end), and a song read as 1/4 gets no band and the wrong count-in.
    """
    # Every part repeats the signatures, so one per offset.
    placed = sorted(
        {float(s.getOffsetInHierarchy(score)): s.ratioString for s in signatures}.items()
    )
    ends = [start for start, _ in placed[1:]] + [float(score.highestTime)]
    covered: dict[str, float] = {}
    for (start, ratio), stop in zip(placed, ends, strict=True):
        covered[ratio] = covered.get(ratio, 0.0) + max(stop - start, 0.0)
    # Ties go to the earlier signature, which is what a reader would say.
    first = placed[0][1]
    return max(covered, key=lambda ratio: (covered[ratio], ratio == first))


# A written key signature loses to analysis only when the notes contradict it
# this clearly: more than this share of them outside its scale beyond what
# the analysed key leaves outside.
KEY_CONTRADICTED = 0.05


def _written_key(score: stream.Score) -> key.Key:
    """The key signature as written, trusting the source over analysis: sheet
    music states its key, and analysis of a short tune is often wrong.

    Unless the notes say otherwise. A sequenced MIDI file often carries a
    default signature of no sharps or flats whatever it plays (Zelda's
    Lullaby from VGMusic: "C major", with an F sharp in nearly every bar),
    and writing such a song in C puts an accidental on every F. Relative keys
    share a scale, so this only ever overrules a signature that is wrong,
    never a major-or-minor judgement.
    """
    written = score.flatten().getElementsByClass(key.KeySignature).first()
    analysed: key.Key = score.analyze("key")
    if written is None:
        return analysed
    as_key: key.Key = written if isinstance(written, key.Key) else written.asKey(analysed.mode)
    pitches = [p for n in score.flatten().notes for p in n.pitches]
    if not pitches:
        return as_key
    excess = _outside(pitches, as_key) - _outside(pitches, analysed)
    return analysed if excess > KEY_CONTRADICTED * len(pitches) else as_key


def _outside(pitches: list[pitch.Pitch], scale_of: key.Key) -> int:
    inside = {p.pitchClass for p in scale_of.getScale().getPitches()}
    return sum(1 for p in pitches if p.pitchClass not in inside)
