"""Shared fixtures: a throwaway repository for the guard tests, and sources
for the arranger.

The guard's rules are about the repository's shape, so each test builds a tiny
one in a temp directory using the real schemas, then bends one thing.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from music21 import key, meter, note, stream

from fixtures import ode_to_joy
from runenote.bundle import musicxml_text
from runenote.source import Source, load

REAL_ROOT = Path(__file__).resolve().parents[2]


class FakeRepo:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.core = root / "content" / "packs" / "core"
        self.core.mkdir(parents=True)
        (root / "quests").mkdir()
        shutil.copytree(REAL_ROOT / "content" / "schema", root / "content" / "schema")
        self.write_pack([])

    def write_pack(self, songs: list[str]) -> None:
        manifest = {
            "id": "core",
            "name": "Runenote core",
            "version": "0.1.0",
            "licence": "CC-BY-SA-4.0",
            "songs": songs,
        }
        (self.core / "pack.json").write_text(json.dumps(manifest), encoding="utf-8")

    def add_song(
        self,
        song_id: str,
        *,
        licence: str = "public-domain",
        listed: bool = True,
        write_files: bool = True,
        **overrides: Any,
    ) -> dict[str, Any]:
        bundle = self.core / song_id
        bundle.mkdir()
        song: dict[str, Any] = {
            "id": song_id,
            "title": song_id.replace("-", " ").title(),
            "source": {"kind": "midi", "origin": "test fixture", "licence": licence},
            "time_signature": "4/4",
            "tempo_bpm": 100,
            "backing": "backing.mid",
            "tiers": [
                {
                    "level": 1,
                    "file": "tier-1.musicxml",
                    "hands": "right",
                    "difficulty": 10,
                    "range": {"low": 60, "high": 67},
                }
            ],
        }
        song.update(overrides)
        (bundle / "song.json").write_text(json.dumps(song), encoding="utf-8")
        if write_files:
            (bundle / "backing.mid").write_bytes(b"")
            (bundle / "tier-1.musicxml").write_text("<score-partwise/>", encoding="utf-8")
        if listed:
            manifest = json.loads((self.core / "pack.json").read_text(encoding="utf-8"))
            self.write_pack([*manifest["songs"], song_id])
        return song

    def add_quest(self, quest_id: str, *song_refs: str) -> None:
        steps = ["  - kind: learn"] + [f"  - kind: song\n    song: {ref}" for ref in song_refs]
        text = f"id: {quest_id}\ntitle: {quest_id}\nsteps:\n" + "\n".join(steps) + "\n"
        (self.root / "quests" / f"{quest_id}.yaml").write_text(text, encoding="utf-8")


@pytest.fixture
def repo(tmp_path: Path) -> FakeRepo:
    return FakeRepo(tmp_path)


# --- sources for the arranger ---------------------------------------------


def source_from(score: stream.Score, path: Path, **kwargs: Any) -> Source:
    """Write a music21 score out and load it back the way the pipeline would."""
    path.write_text(musicxml_text(score), encoding="utf-8")
    return load(path, **kwargs)


@pytest.fixture(scope="session")
def ode(tmp_path_factory: pytest.TempPathFactory) -> Source:
    """Ode to Joy as the pipeline sees it: two parts, D major, an octave wide."""
    return source_from(ode_to_joy.score(), tmp_path_factory.mktemp("ode") / "ode.musicxml")


def melody_only(notes: str) -> stream.Score:
    """A one-part score in C major from a run of quarter notes, e.g. "C4 D4 E4"."""
    part = stream.Part()
    part.insert(0, key.Key("C"))
    part.insert(0, meter.TimeSignature("4/4"))
    for name in notes.split():
        part.append(note.Note(name, quarterLength=1))
    part.makeMeasures(inPlace=True)
    score = stream.Score()
    score.insert(0, part)
    return score
