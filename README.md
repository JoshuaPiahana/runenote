# Runenote

A piano practice app for one family. Play the songs you actually want to play,
game and film themes included, on a real keyboard over MIDI, with lessons built
to maximise learning rather than engagement.

## Why it exists

The commercial apps are expensive, carry ads, and never have the songs you
want, because every song in them is individually licensed. This project sidesteps
that: songs are arranged automatically from MIDI or sheet music you supply, for
your own family's use, and the app itself is free and yours.

## Principles

1. **Maximise learning.** Every mechanic must earn its place by teaching
   something, not by keeping people tapping.
2. **Own reasons, not copies.** Duolingo Music is excellent and we borrow its
   structure freely, but every choice here has a stated reason in
   [`docs/DECISIONS.md`](docs/DECISIONS.md). "Duolingo does it" is not a reason.
3. **Packs are the unit of swap.** Music lives in content packs. The `core` pack
   in this repository is licence-clean and is all the built-in quests may use.
   Packs of copyrighted arrangements stay on your machine and are imported at
   runtime. CI enforces this.

## Shape

| Directory | What it is |
| --- | --- |
| `pipeline/` | Python. Imports MIDI or MusicXML, builds an internal model, arranges it into difficulty tiers, emits a song bundle. |
| `app/` | TypeScript web app. Web MIDI in, notation out, the band synthesised in the browser. |
| `content/schema/` | The JSON Schema contract between pipeline and app. Anything that validates, plays. |
| `content/packs/core/` | The built-in pack: public-domain compositions, our arrangements. |
| `quests/` | Learning paths. May only reference songs in `core`. |
| `docs/DECISIONS.md` | Why things are the way they are. |

## Running

Everything runs in Docker; no local Python or Node is needed.

```
./rune dev      # app on http://localhost:5173: pick a song and level, then play
./rune test     # pipeline and app tests
./rune lint     # ruff, mypy, biome, tsc
./rune guard    # the content rules CI enforces
```

## Adding a song

```
./rune arrange path/to/song.musicxml --out content/packs/core/<id> --licence public-domain
```

Run without `--melody` and it lists the parts with a suggestion; run again
with `--melody N` to confirm which one is the tune. That is the one human
step. The pipeline transposes to a friendlier key if the ladder needs it,
builds every level the melody can meet (see `pipeline/src/runenote/tiers.yaml`),
and writes a bundle: `song.json`, one MusicXML per level, a backing MIDI of
the band it generated from the song's harmony (see
`pipeline/src/runenote/styles.yaml`), and a copy of the source. Bundles are
never edited by hand; `./rune regen content/packs/core/<id>` makes them again.
Every song in `core` is public domain and transcribed as text, one module per
song in `pipeline/tests/fixtures/` (Ode to Joy in `ode_to_joy.py`, the rest
through `transcription.py`, which refuses a bar that does not add up). A test
keeps each committed source equal to its module, so fix a wrong note there.

## Moving a family pack to another machine

Family packs are never committed, so a fresh clone has only core. Carry one
across as a file:

```
./rune pack-export zelda-oot                  # here: writes zelda-oot.pack.zip
./rune pack-import zelda-oot.pack.zip         # there, from the repo root
```

Put the file in the repository root on the other machine before importing;
the pipeline container sees only the checkout. Re-import after any change.
Reload the app and the pack's songs appear.

## Licence

Code is MIT. The `core` content pack is CC BY-SA 4.0 (see
`content/packs/core/LICENSE`).
