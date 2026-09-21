"""The content rules this repository enforces on itself.

The repository is public, so it may only hold music it is allowed to
redistribute. Two rules follow, and CI runs both on every push:

1. Every song in the ``core`` pack carries an open licence for its source,
   and its files are all present.
2. Built-in quests reference songs in ``core`` only, and those songs exist.

Family packs of copyrighted arrangements never enter the repository at all;
that is the job of ``.gitignore``. This module makes sure that nothing which
does get in is the wrong thing.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

CORE_PACK = "core"

# Licences the core pack accepts for a song's source. SPDX identifiers where
# they exist; "public-domain" for compositions old enough to have none.
OPEN_LICENCES = frozenset({"public-domain", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"})


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)
    songs_checked: int = 0
    quests_checked: int = 0

    @property
    def ok(self) -> bool:
        return not self.problems


def find_repo_root(start: Path) -> Path:
    """Walk upwards until the directory that holds the content schemas."""
    for candidate in (start, *start.parents):
        if (candidate / "content" / "schema").is_dir():
            return candidate
    msg = f"no repository root above {start}"
    raise FileNotFoundError(msg)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validator(root: Path, schema_name: str) -> Draft202012Validator:
    return Draft202012Validator(_load_json(root / "content" / "schema" / schema_name))


def _schema_problems(validator: Draft202012Validator, doc: Any, label: str) -> Iterable[str]:
    for error in validator.iter_errors(doc):
        where = "/".join(str(p) for p in error.absolute_path) or "(top level)"
        yield f"{label}: {where}: {error.message}"


def check(root: Path) -> Report:
    report = Report()
    core_dir = root / "content" / "packs" / CORE_PACK
    core_songs = _check_core_pack(root, core_dir, report)
    _check_quests(root, core_songs, report)
    return report


def _check_core_pack(root: Path, core_dir: Path, report: Report) -> set[str]:
    manifest_path = core_dir / "pack.json"
    if not manifest_path.is_file():
        report.problems.append(f"{manifest_path}: missing")
        return set()

    pack = _load_json(manifest_path)
    report.problems.extend(
        _schema_problems(_validator(root, "pack.schema.json"), pack, "pack.json")
    )
    if pack.get("id") != CORE_PACK:
        report.problems.append(f"pack.json: id must be {CORE_PACK!r}, got {pack.get('id')!r}")

    listed = set(pack.get("songs", []))
    present = {p.name for p in core_dir.iterdir() if p.is_dir()}
    for song_id in sorted(listed - present):
        report.problems.append(f"pack.json lists {song_id!r} but no such directory exists")
    for song_id in sorted(present - listed):
        report.problems.append(f"directory {song_id!r} is not listed in pack.json")

    song_validator = _validator(root, "song.schema.json")
    for song_id in sorted(listed & present):
        _check_song(core_dir / song_id, song_id, song_validator, report)
        report.songs_checked += 1
    return listed & present


def _check_song(
    bundle: Path, song_id: str, validator: Draft202012Validator, report: Report
) -> None:
    label = f"{CORE_PACK}/{song_id}"
    song_path = bundle / "song.json"
    if not song_path.is_file():
        report.problems.append(f"{label}: song.json missing")
        return

    song = _load_json(song_path)
    report.problems.extend(_schema_problems(validator, song, label))
    if song.get("id") != song_id:
        report.problems.append(f"{label}: id {song.get('id')!r} does not match directory")

    licence = song.get("source", {}).get("licence")
    if licence not in OPEN_LICENCES:
        allowed = ", ".join(sorted(OPEN_LICENCES))
        report.problems.append(
            f"{label}: source licence {licence!r} is not open; core accepts only {allowed}"
        )

    files = [tier.get("file") for tier in song.get("tiers", [])]
    if "backing" in song:
        files.append(song["backing"])
    for rel in files:
        if isinstance(rel, str) and not (bundle / rel).is_file():
            report.problems.append(f"{label}: referenced file {rel!r} is missing")


def _check_quests(root: Path, core_songs: set[str], report: Report) -> None:
    quests_dir = root / "quests"
    if not quests_dir.is_dir():
        return
    validator = _validator(root, "quest.schema.json")
    for quest_path in sorted(quests_dir.glob("*.yaml")):
        label = f"quests/{quest_path.name}"
        quest = yaml.safe_load(quest_path.read_text(encoding="utf-8"))
        report.problems.extend(_schema_problems(validator, quest, label))
        for step in (quest or {}).get("steps", []):
            ref = step.get("song") if isinstance(step, dict) else None
            if ref is None:
                continue
            pack_id, _, song_id = ref.partition("/")
            if pack_id != CORE_PACK:
                report.problems.append(
                    f"{label}: references {ref!r}; built-in quests may only use the "
                    f"{CORE_PACK!r} pack"
                )
            elif song_id not in core_songs:
                report.problems.append(f"{label}: references {ref!r}, which is not in core")
        report.quests_checked += 1
