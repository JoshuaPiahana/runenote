"""Load a source file into what the arranger needs: the score, its parts, and
the facts about it a bundle must state.

Only MusicXML today. The MIDI importer the plan calls for lands with the
first MIDI source worth arranging; both feed this same :class:`Source`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import fmean

from music21 import converter, key, meter, stream, tempo

MUSICXML_SUFFIXES = frozenset({".musicxml", ".mxl", ".xml"})

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
    if path.suffix.lower() not in MUSICXML_SUFFIXES:
        msg = f"{path}: not a MusicXML file (expected one of {sorted(MUSICXML_SUFFIXES)})"
        raise SourceError(msg)
    parsed = converter.parse(path)
    if not isinstance(parsed, stream.Score):
        msg = f"{path}: parsed as {type(parsed).__name__}, not a score"
        raise SourceError(msg)

    signatures = parsed.flatten().getElementsByClass(meter.TimeSignature)
    if not signatures:
        msg = f"{path}: no time signature"
        raise SourceError(msg)

    marks = [m for m in parsed.flatten().getElementsByClass(tempo.MetronomeMark) if m.number]
    stated = marks[0].getQuarterBPM() if marks else None
    if tempo_bpm is not None:
        bpm, guessed = tempo_bpm, False
    elif stated is not None:
        bpm, guessed = float(stated), False
    else:
        bpm, guessed = DEFAULT_TEMPO_BPM, True

    return Source(
        path=path,
        score=parsed,
        title=parsed.metadata.bestTitle if parsed.metadata else path.stem,
        composer=parsed.metadata.composer if parsed.metadata else None,
        key=_written_key(parsed),
        time_signature=signatures[0].ratioString,
        tempo_bpm=bpm,
        tempo_is_default=guessed,
    )


def _written_key(score: stream.Score) -> key.Key:
    """The key signature as written, trusting the source over analysis: sheet
    music states its key, and analysis of a short tune is often wrong."""
    written = score.flatten().getElementsByClass(key.KeySignature).first()
    if isinstance(written, key.Key):
        return written
    analysed: key.Key = score.analyze("key")
    if written is None:
        return analysed
    as_key: key.Key = written.asKey(analysed.mode)
    return as_key
