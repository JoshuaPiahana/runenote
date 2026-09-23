"""The rule in docs/DECISIONS.md, "A bundle is never edited by hand": what
the pipeline writes validates, and it can write it again from what it wrote.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from conftest import REAL_ROOT, FakeRepo
from fixtures import (
    amazing_grace,
    happy_birthday,
    korobeiniki,
    minuet_in_g,
    ode_to_joy,
    transcription,
    twinkle_twinkle,
)
from runenote.arrange import arrange
from runenote.bundle import BundleError, Choices, musicxml_text, rebuild, write
from runenote.guard import check
from runenote.source import Source
from runenote.tiers import load_tiers

CORE = REAL_ROOT / "content" / "packs" / "core"
CHOICES = Choices(song_id="ode-to-joy", melody=1, licence="public-domain", origin="a test")


def files_of(bundle: Path) -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in sorted(bundle.iterdir()) if p.is_file()}


def test_a_written_bundle_validates_and_passes_the_guard(repo: FakeRepo, ode: Source) -> None:
    song = write(
        arrange(ode, 1, load_tiers()), ode, CHOICES, repo.core / "ode-to-joy", schema_root=repo.root
    )
    repo.write_pack(["ode-to-joy"])
    report = check(repo.root)
    assert report.ok, report.problems
    assert song["source"] == {
        "kind": "musicxml",
        "licence": "public-domain",
        "file": "source.musicxml",
        "melody": 1,
        "origin": "a test",
    }
    assert sorted(files_of(repo.core / "ode-to-joy")) == [
        "backing.mid",
        "song.json",
        "source.musicxml",
        "tier-1.musicxml",
        "tier-2.musicxml",
        "tier-3.musicxml",
        "tier-4.musicxml",
    ]


def test_a_bundle_rebuilds_itself_byte_for_byte(tmp_path: Path, ode: Source) -> None:
    out = tmp_path / "ode-to-joy"
    write(arrange(ode, 1, load_tiers()), ode, CHOICES, out, schema_root=REAL_ROOT)
    before = files_of(out)
    rebuild(out, schema_root=REAL_ROOT)
    assert files_of(out) == before


def test_a_bundle_without_recorded_choices_cannot_be_rebuilt(tmp_path: Path, ode: Source) -> None:
    out = tmp_path / "ode-to-joy"
    write(arrange(ode, 1, load_tiers()), ode, CHOICES, out, schema_root=REAL_ROOT)
    song = json.loads((out / "song.json").read_text(encoding="utf-8"))
    del song["source"]["melody"]
    (out / "song.json").write_text(json.dumps(song), encoding="utf-8")
    with pytest.raises(BundleError, match="cannot rebuild"):
        rebuild(out, schema_root=REAL_ROOT)


def test_musicxml_output_is_the_same_every_time() -> None:
    assert musicxml_text(ode_to_joy.score()) == musicxml_text(ode_to_joy.score())


# --- the core pack ----------------------------------------------------------


def core_songs() -> list[str]:
    manifest = json.loads((CORE / "pack.json").read_text(encoding="utf-8"))
    return list(manifest["songs"])


@pytest.mark.parametrize("song_id", core_songs())
def test_the_core_pack_is_what_the_pipeline_produces(song_id: str, tmp_path: Path) -> None:
    """Regenerating a core bundle changes nothing. If this fails, either the
    pipeline changed (regenerate and commit) or someone edited a bundle by
    hand (do not)."""
    rebuild(CORE / song_id, tmp_path, schema_root=REAL_ROOT)
    committed = files_of(CORE / song_id)
    fresh = files_of(tmp_path)
    assert sorted(fresh) == sorted(committed)
    for name in committed:
        assert fresh[name] == committed[name], f"{song_id}/{name} differs from a fresh build"


def test_the_core_ode_to_joy_source_is_the_transcription() -> None:
    """The committed source is the text in fixtures/ode_to_joy.py, so a wrong
    note gets fixed there, once, and regenerated."""
    committed = (CORE / "ode-to-joy" / "source.musicxml").read_text(encoding="utf-8")
    assert committed == musicxml_text(ode_to_joy.score())


# Every other core song is a transcription built by fixtures/transcription.py.
TRANSCRIBED = {
    "twinkle-twinkle": twinkle_twinkle.TUNE,
    "happy-birthday": happy_birthday.TUNE,
    "amazing-grace": amazing_grace.TUNE,
    "korobeiniki": korobeiniki.TUNE,
    "minuet-in-g": minuet_in_g.TUNE,
}


def test_every_core_song_has_a_transcription() -> None:
    """A core source nobody can read as text is a source nobody can correct."""
    assert set(core_songs()) == {"ode-to-joy", *TRANSCRIBED}


@pytest.mark.parametrize("song_id", sorted(TRANSCRIBED))
def test_a_core_source_is_its_transcription(song_id: str) -> None:
    committed = (CORE / song_id / "source.musicxml").read_text(encoding="utf-8")
    assert committed == musicxml_text(transcription.score(TRANSCRIBED[song_id]))


def test_a_bar_that_does_not_add_up_is_refused() -> None:
    """Only the first bar (a pickup) and the last may be short, so one wrong
    duration cannot quietly shift every note after it."""
    tune = twinkle_twinkle.TUNE
    wrong = dataclasses.replace(tune, melody=tune.melody.replace("A4 A4 G4:h", "A4 G4:h", 1))
    with pytest.raises(ValueError, match="bar 2"):
        transcription.score(wrong)
