"""Command line entry point: ``runenote <command>``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from runenote import __version__, bundle, packs, source, stems
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
    arr.add_argument(
        "--backing",
        choices=("band", "source"),
        default="band",
        help="band: generate one from the harmony (default). source: play the MIDI "
        "source's own parts, each given a role with --role; omit --role to see suggestions",
    )
    arr.add_argument(
        "--role",
        action="append",
        default=[],
        metavar="N=ROLE",
        help=f"role of part N in a source backing, one of {', '.join(stems.STEM_ROLES)}; "
        "repeat for every part but the melody",
    )

    regen = sub.add_parser("regenerate", help="rebuild bundles from their sources")
    regen.add_argument("bundle", type=Path, nargs="+", help="bundle directories")
    regen.add_argument("--root", type=Path, help="repository root, for the schema")

    export = sub.add_parser("pack-export", help="write a family pack to one file, to carry")
    export.add_argument("pack", help="pack id, a directory under content/packs")
    export.add_argument("--root", type=Path, help="repository root (default: found from cwd)")
    imp = sub.add_parser("pack-import", help="unpack a carried pack file into content/packs")
    imp.add_argument("file", type=Path, help=f"a <id>{packs.SUFFIX} from pack-export")
    imp.add_argument("--root", type=Path, help="repository root (default: found from cwd)")

    args = parser.parse_args(argv)
    try:
        if args.command == "guard":
            return _guard(args.root or find_repo_root(Path.cwd()))
        if args.command == "arrange":
            return _arrange(args)
        if args.command == "regenerate":
            return _regenerate(args)
        if args.command in ("pack-export", "pack-import"):
            return _carry(args)
    except (
        source.SourceError,
        ArrangeError,
        bundle.BundleError,
        stems.StemError,
        packs.PackError,
    ) as error:
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


def _carry(args: argparse.Namespace) -> int:
    root = args.root or find_repo_root(Path.cwd())
    if args.command == "pack-export":
        moved = packs.export_pack(root / "content" / "packs" / args.pack, root)
        print(f"{moved.pack_id}: {moved.songs} songs -> {moved.path.relative_to(root)}")
    else:
        moved = packs.import_pack(args.file, root / "content" / "packs")
        print(f"{moved.pack_id}: {moved.songs} songs -> {moved.path.relative_to(root)}")
        print("reload the app to see them")
    return 0


def _arrange(args: argparse.Namespace) -> int:
    src = source.load(args.source, tempo_bpm=args.tempo)
    if args.melody is None:
        return _ask_for_melody(src)
    roles: dict[int, str] | None = None
    if args.backing == "source":
        if not args.role:
            return _ask_for_roles(src, args.melody)
        roles = _parse_roles(args.role)
    elif args.role:
        print("error: --role only applies with --backing source", file=sys.stderr)
        return 2

    choices = bundle.Choices(
        song_id=args.id or _slug(args.title or src.title),
        melody=args.melody,
        licence=args.licence,
        origin=args.origin,
        title=args.title,
        composer=args.composer,
        tempo_bpm=args.tempo,
        roles=roles,
    )
    arrangement = arrange(src, args.melody, load_tiers(), roles=roles)
    root = args.root or find_repo_root(Path.cwd())
    song = bundle.write(arrangement, src, choices, args.out, schema_root=root)

    if src.tempo_is_default:
        print(f"note: the source states no tempo; guessed {src.tempo_bpm:g} bpm (see --tempo)")
    moved = f"transposed {arrangement.semitones:+d}" if arrangement.semitones else "as written"
    print(f"{song['id']}: {song['key']} ({moved}), {len(song['tiers'])} tiers -> {args.out}")
    if isinstance(arrangement.backing, stems.StemBacking):
        parts = ", ".join(f"{t.part}:{t.role}" for t in arrangement.backing.tracks)
        print(f"  backing: the source's own parts ({parts})")
    elif arrangement.backing is None:
        print(f"  no band: nothing to take a harmony from, or no style fits {src.time_signature}")
    else:
        played = ", ".join(layer.role for layer in arrangement.backing.style.layers)
        print(f"  band: {arrangement.backing.style.name} ({played})")
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


def _ask_for_roles(src: source.Source, melody: int) -> int:
    found = stems.read(src.path)
    suggested = stems.suggest(found, melody)
    print(f"{src.path}: part {melody} is the melody. What does each other part do?")
    print("  bass, keys: stand down when the player's own hands take them over")
    print("  drums, colour: always play (colour: echoes, counter-melodies, arpeggios)")
    print("  drop: left out of the backing")
    for stem in found:
        role = "melody" if stem.part == melody else suggested[stem.part]
        print(
            f"  {stem.part}. {stem.name}: GM {stem.program}, {stem.notes} notes, "
            f"mean pitch {stem.mean_pitch:.0f} -> {role}"
        )
    flags = " ".join(f"--role {part}={role}" for part, role in sorted(suggested.items()))
    print(f"Confirm or correct, then re-run with: --backing source {flags}")
    return 2


def _parse_roles(given: list[str]) -> dict[int, str]:
    roles: dict[int, str] = {}
    for item in given:
        number, _, role = item.partition("=")
        if not number.strip().isdigit() or not role:
            msg = f"--role {item!r}: expected N=ROLE, e.g. 4=bass"
            raise stems.StemError(msg)
        roles[int(number)] = role.strip()
    return roles


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
