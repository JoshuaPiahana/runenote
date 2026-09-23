"""Carrying a family pack between machines."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from runenote import packs


def _pack(packs_dir: Path, pack_id: str = "family", songs: tuple[str, ...] = ("tune",)) -> Path:
    pack = packs_dir / pack_id
    for song in songs:
        (pack / song).mkdir(parents=True)
        (pack / song / "song.json").write_text(json.dumps({"id": song}))
        (pack / song / "tier-1.musicxml").write_text(f"<{song}/>")
    (pack / "incoming").mkdir()
    (pack / "incoming" / "raw.mid").write_bytes(b"working file")
    (pack / "pack.json").write_text(json.dumps({"id": pack_id, "songs": list(songs)}))
    return pack


def _files(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_round_trip_carries_the_listed_bundles_and_no_working_files(tmp_path: Path) -> None:
    here, there = tmp_path / "here", tmp_path / "there"
    pack = _pack(here, songs=("tune", "other"))
    there.mkdir()

    carried = packs.export_pack(pack, tmp_path)
    moved = packs.import_pack(carried.path, there)

    expected = {k: v for k, v in _files(pack).items() if not k.startswith("incoming/")}
    assert _files(moved.path) == expected
    assert (moved.pack_id, moved.songs) == ("family", 2)


def test_import_keeps_the_working_files_already_there(tmp_path: Path) -> None:
    carried = packs.export_pack(_pack(tmp_path / "here"), tmp_path)
    there = tmp_path / "there"
    old = _pack(there)
    (old / "incoming" / "raw.mid").write_bytes(b"the laptop's own")
    (old / "tune" / "stale.musicxml").write_text("from an older pack")

    packs.import_pack(carried.path, there)

    assert (old / "incoming" / "raw.mid").read_bytes() == b"the laptop's own"
    assert not (old / "tune" / "stale.musicxml").exists()


def test_a_listed_song_without_a_bundle_is_not_exported(tmp_path: Path) -> None:
    pack = _pack(tmp_path / "here")
    (pack / "pack.json").write_text(json.dumps({"id": "family", "songs": ["tune", "missing"]}))
    with pytest.raises(packs.PackError, match="missing"):
        packs.export_pack(pack, tmp_path)


def test_core_is_never_carried(tmp_path: Path) -> None:
    with pytest.raises(packs.PackError, match="core"):
        packs.export_pack(_pack(tmp_path / "here", "core"), tmp_path)
    archive = tmp_path / "core.pack.zip"
    with zipfile.ZipFile(archive, "w") as z:
        z.writestr("core/pack.json", json.dumps({"id": "core", "songs": []}))
    with pytest.raises(packs.PackError, match="core"):
        packs.import_pack(archive, tmp_path)


@pytest.mark.parametrize(
    "names",
    [
        ["family/pack.json", "family/../../escaped.txt"],
        ["family/pack.json", "other/pack.json"],
        ["family/tune/song.json"],
    ],
)
def test_a_bad_archive_leaves_the_old_copy(tmp_path: Path, names: list[str]) -> None:
    there = tmp_path / "there"
    before = _files(_pack(there))
    archive = tmp_path / "bad.pack.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for name in names:
            z.writestr(name, json.dumps({"id": "family", "songs": []}))

    with pytest.raises(packs.PackError):
        packs.import_pack(archive, there)

    assert _files(there / "family") == before
    assert not (tmp_path / "escaped.txt").exists()
