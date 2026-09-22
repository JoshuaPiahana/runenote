"""Command line entry point: ``runenote <command>``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from runenote import __version__, bundle, source
from runenote.arrange import ArrangeError, arrange
from runenote.guard import check, find_repo_root
from runenote.tiers import load_tiers


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="runenote")
    parser.add_argument("--version", action="version", version=f"runenote {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    guard = sub.add_parser("guard", help="check the repository only holds content it may hold")
    guard.add_argument("--root", type=Path, help="repository root (default: found from cwd)")

    arr = sub.add_parser("arrange", help="arrange a source file into a song bundle")
    arr.add_argument("source", type=Path, help="a MusicXML file")
    arr.add_argument("--out", type=Path, required=True, help="bundle directory to write")
    arr.add_argument("--licence", required=True, help="licence of the source, e.g. public-domain")
    arr.add_argument(
        "--melody", type=int, help="1-based part that carries the melody; omit to see the parts"
    )
    arr.add_argument("--id", help="song id (default: from the title)")
    arr.add_argument("--title", help="override the title in the source")
    arr.add_argument("--composer", help="override the composer in the source")
    arr.add_argument("--origin", help="where the source came from")
    arr.add_argument("--tempo", type=float, help="beats per minute, if the source has none")
    arr.add_argument("--root", type=Path, help="repository root, for the schema")

    regen = sub.add_parser("regenerate", help="rebuild bundles from their sources")
    regen.add_argument("bundle", type=Path, nargs="+", help="bundle directories")
    regen.add_argument("--root", type=Path, help="repository root, for the schema")

    args = parser.parse_args(argv)
    try:
        if args.command == "guard":
            return _guard(args.root or find_repo_root(Path.cwd()))
        if args.command == "arrange":
            return _arrange(args)
        if args.command == "regenerate":
            return _regenerate(args)
    except (source.SourceError, ArrangeError, bundle.BundleError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
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


def _arrange(args: argparse.Namespace) -> int:
    src = source.load(args.source, tempo_bpm=args.tempo)
    if args.melody is None:
        return _ask_for_melody(src)

    choices = bundle.Choices(
        song_id=args.id or _slug(args.title or src.title),
        melody=args.melody,
        licence=args.licence,
        origin=args.origin,
        title=args.title,
        composer=args.composer,
        tempo_bpm=args.tempo,
    )
    arrangement = arrange(src, args.melody, load_tiers())
    root = args.root or find_repo_root(Path.cwd())
    song = bundle.write(arrangement, src, choices, args.out, schema_root=root)

    if src.tempo_is_default:
        print(f"note: the source states no tempo; guessed {src.tempo_bpm:g} bpm (see --tempo)")
    moved = f"transposed {arrangement.semitones:+d}" if arrangement.semitones else "as written"
    print(f"{song['id']}: {song['key']} ({moved}), {len(song['tiers'])} tiers -> {args.out}")
    if arrangement.backing is None:
        print(f"  no band: nothing to take a harmony from, or no style fits {src.time_signature}")
    else:
        roles = ", ".join(layer.role for layer in arrangement.backing.style.layers)
        print(f"  band: {arrangement.backing.style.name} ({roles})")
    for tier in arrangement.tiers:
        folded = f", {tier.folded} folded" if tier.folded else ""
        print(
            f"  tier {tier.tier.level} {tier.tier.name}: {tier.tier.hands} hand(s), "
            f"range {tier.low}-{tier.high}, difficulty {tier.difficulty}{folded}"
        )
    return 0


def _ask_for_melody(src: source.Source) -> int:
    suggested = src.suggested_melody()
    print(f"{src.path}: {src.title}, {src.key}, {src.time_signature}, {src.tempo_bpm:g} bpm")
    print("Which part is the melody? Re-run with --melody N.")
    for part in src.parts:
        mark = "  <- suggested" if part.index == suggested else ""
        print(f"  {part.index}. {part.name}: {part.notes} notes, {part.low}-{part.high}{mark}")
    return 2


def _regenerate(args: argparse.Namespace) -> int:
    root = args.root or find_repo_root(Path.cwd())
    for path in args.bundle:
        song = bundle.rebuild(path, schema_root=root)
        print(f"{song['id']}: rebuilt, {len(song['tiers'])} tiers")
    return 0


def _slug(title: str) -> str:
    words = "".join(c.lower() if c.isalnum() else " " for c in title).split()
    return "-".join(words) or "song"


if __name__ == "__main__":
    sys.exit(main())
