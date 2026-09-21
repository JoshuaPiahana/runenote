"""Command line entry point: ``runenote <command>``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from runenote import __version__
from runenote.guard import check, find_repo_root


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="runenote")
    parser.add_argument("--version", action="version", version=f"runenote {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    guard = sub.add_parser("guard", help="check the repository only holds content it may hold")
    guard.add_argument("--root", type=Path, help="repository root (default: found from cwd)")

    args = parser.parse_args(argv)
    if args.command == "guard":
        return _guard(args.root or find_repo_root(Path.cwd()))
    return 2


def _guard(root: Path) -> int:
    report = check(root)
    for problem in report.problems:
        print(f"problem: {problem}")
    print(
        f"guard: {report.songs_checked} core songs, {report.quests_checked} quests, "
        f"{len(report.problems)} problems"
    )
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
