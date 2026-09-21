"""Write an arrangement to disk as a song bundle, and rebuild one.

A bundle carries everything needed to make it again: the source file and the
choices a human made about it (which part is the melody, the licence, where
it came from, the tempo). ``rebuild`` reads those back out of ``song.json``,
so a bundle is never edited by hand: change the pipeline or the source and
regenerate. A test holds the core pack to that.
"""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, ValidationError
from music21 import stream
from music21.midi.translate import streamToMidiFile
from music21.musicxml.m21ToXml import GeneralObjectExporter

from runenote import source as sources
from runenote.arrange import Arrangement, arrange
from runenote.tiers import Tier, load_tiers

SONG_SCHEMA = "song.schema.json"
TIER_FILE = "tier-{level}.musicxml"
BACKING_FILE = "backing.mid"


class BundleError(Exception):
    """The bundle would not be valid; the message says why."""


@dataclass(frozen=True)
class Choices:
    """What the human decided; recorded in song.json so it need not be decided twice."""

    song_id: str
    melody: int
    licence: str
    origin: str | None = None
    title: str | None = None
    composer: str | None = None
    tempo_bpm: float | None = None


def write(
    arrangement: Arrangement,
    source: sources.Source,
    choices: Choices,
    out: Path,
    *,
    schema_root: Path,
) -> dict[str, Any]:
    """Write the bundle and return the song.json it holds."""
    out.mkdir(parents=True, exist_ok=True)
    source_file = "source" + source.path.suffix.lower()
    if source.path.resolve() != (out / source_file).resolve():
        shutil.copyfile(source.path, out / source_file)

    song: dict[str, Any] = {
        "id": choices.song_id,
        "title": choices.title or source.title,
        "source": {
            "kind": "musicxml",
            "licence": choices.licence,
            "file": source_file,
            "melody": choices.melody,
        },
        "key": f"{arrangement.key.tonic.name.replace('-', 'b')} {arrangement.key.mode}",
        "time_signature": source.time_signature,
        "tempo_bpm": source.tempo_bpm,
        "tiers": [
            {
                "level": t.tier.level,
                "file": TIER_FILE.format(level=t.tier.level),
                "hands": t.tier.hands,
                "difficulty": t.difficulty,
                "range": {"low": t.low, "high": t.high},
            }
            for t in arrangement.tiers
        ],
    }
    composer = choices.composer or source.composer
    if composer:
        song["composer"] = composer
    if choices.origin:
        song["source"]["origin"] = choices.origin
    if arrangement.backing is not None:
        song["backing"] = BACKING_FILE

    try:
        Draft202012Validator(_schema(schema_root)).validate(song)
    except ValidationError as error:
        msg = f"{choices.song_id}: song.json would not validate: {error.message}"
        raise BundleError(msg) from error

    # Stale tiers from an earlier table would otherwise linger unreferenced.
    for old in out.glob(TIER_FILE.format(level="*")):
        old.unlink()
    (out / BACKING_FILE).unlink(missing_ok=True)

    for tier in arrangement.tiers:
        path = out / TIER_FILE.format(level=tier.tier.level)
        path.write_text(musicxml_text(tier.score), encoding="utf-8")
    if arrangement.backing is not None:
        (out / BACKING_FILE).write_bytes(midi_bytes(arrangement.backing))
    (out / "song.json").write_text(json.dumps(song, indent=2) + "\n", encoding="utf-8")
    return song


def rebuild(
    bundle: Path,
    out: Path | None = None,
    *,
    schema_root: Path,
    tiers: list[Tier] | None = None,
) -> dict[str, Any]:
    """Make the bundle again from its own source and recorded choices, into
    ``out`` (default: in place)."""
    song = json.loads((bundle / "song.json").read_text(encoding="utf-8"))
    recorded = song.get("source", {})
    if "file" not in recorded or "melody" not in recorded:
        msg = f"{bundle}: song.json records no source file and melody part; cannot rebuild"
        raise BundleError(msg)
    choices = Choices(
        song_id=song["id"],
        melody=recorded["melody"],
        licence=recorded["licence"],
        origin=recorded.get("origin"),
        title=song.get("title"),
        composer=song.get("composer"),
        tempo_bpm=song.get("tempo_bpm"),
    )
    source = sources.load(bundle / recorded["file"], tempo_bpm=choices.tempo_bpm)
    arrangement = arrange(source, choices.melody, tiers or load_tiers())
    return write(arrangement, source, choices, out or bundle, schema_root=schema_root)


def musicxml_text(score: stream.Score) -> str:
    """MusicXML that is the same every time for the same score: no export
    date, and part ids numbered in order rather than randomised."""
    text = GeneralObjectExporter().parse(score).decode("utf-8")
    text = re.sub(r"[ \t]*<encoding-date>[^<]*</encoding-date>\n", "", text)
    for number, old in enumerate(re.findall(r'<score-part id="([^"]+)"', text), start=1):
        text = text.replace(f'id="{old}"', f'id="P{number}"')
    return text


def midi_bytes(score: stream.Score) -> bytes:
    return bytes(streamToMidiFile(score).writestr())


def _schema(root: Path) -> Any:
    path = root / "content" / "schema" / SONG_SCHEMA
    return json.loads(path.read_text(encoding="utf-8"))
