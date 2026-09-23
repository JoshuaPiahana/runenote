"""Carry a family pack between machines as one file.

Family packs never go in the repository, so a clone of it on another machine
has only core. A pack is exported as one zip holding `pack.json` and the song
bundles it lists, and imported by unpacking it beside core, which is all the
app needs to find it. Working files beside the bundles (`incoming/`) stay
behind: every bundle carries its own source, so nothing is lost.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

SUFFIX = ".pack.zip"


class PackError(Exception):
    """A pack that cannot be exported or imported as asked."""


@dataclass(frozen=True)
class Moved:
    pack_id: str
    songs: int
    path: Path


def export_pack(pack_dir: Path, out_dir: Path) -> Moved:
    """Write `out_dir/<id>.pack.zip`."""
    manifest = _manifest(pack_dir / "pack.json")
    pack_id = manifest["id"]
    if pack_id == "core":
        raise PackError("core comes with the repository; there is nothing to carry")
    songs = manifest.get("songs", [])
    for song in songs:
        if not (pack_dir / song / "song.json").is_file():
            raise PackError(f"{pack_dir}/pack.json lists {song!r}, but it has no song.json")
    out = out_dir / f"{pack_id}{SUFFIX}"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(pack_dir / "pack.json", f"{pack_id}/pack.json")
        for song in songs:
            for file in sorted((pack_dir / song).rglob("*")):
                if file.is_file():
                    archive.write(file, f"{pack_id}/{file.relative_to(pack_dir).as_posix()}")
    return Moved(pack_id, len(songs), out)


def import_pack(archive_path: Path, packs_dir: Path) -> Moved:
    """Unpack into `packs_dir/<id>`, replacing an earlier copy of the same pack."""
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        tops = {PurePosixPath(name).parts[0] for name in names if name.strip("/")}
        if len(tops) != 1:
            raise PackError(f"{archive_path} should hold one pack directory, found {sorted(tops)}")
        pack_id = tops.pop()
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise PackError(f"{archive_path} holds an unsafe path: {name}")
        try:
            manifest = json.loads(archive.read(f"{pack_id}/pack.json"))
        except KeyError:
            raise PackError(f"{archive_path} has no {pack_id}/pack.json") from None
        if manifest.get("id") != pack_id:
            raise PackError(f"{archive_path}: directory {pack_id} holds pack {manifest.get('id')}")
        if pack_id == "core":
            raise PackError("core comes with the repository and is never imported over")
        # Unpack beside the target first, so a failed import leaves the old copy.
        with tempfile.TemporaryDirectory(dir=packs_dir) as staging:
            archive.extractall(staging)
            target = packs_dir / pack_id
            # The working files are not in the archive; keep them.
            incoming = target / "incoming"
            if incoming.is_dir():
                shutil.move(incoming, Path(staging) / pack_id / "incoming")
            if target.exists():
                shutil.rmtree(target)
            shutil.move(Path(staging) / pack_id, target)
    return Moved(pack_id, len(manifest.get("songs", [])), packs_dir / pack_id)


def _manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise PackError(f"no pack here: {path} is missing") from None
    if not isinstance(data, dict) or not isinstance(data.get("id"), str):
        raise PackError(f"{path} has no pack id")
    return data
