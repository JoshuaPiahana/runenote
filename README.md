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
| `app/` | TypeScript web app. Web MIDI in, notation out, backing synthesised in the browser. |
| `content/schema/` | The JSON Schema contract between pipeline and app. Anything that validates, plays. |
| `content/packs/core/` | The built-in pack: public-domain compositions, our arrangements. |
| `quests/` | Learning paths. May only reference songs in `core`. |
| `docs/DECISIONS.md` | Why things are the way they are. |

## Running

Everything runs in Docker; no local Python or Node is needed.

```
./rune dev      # app on http://localhost:5173 (Web MIDI works on localhost)
./rune test     # pipeline and app tests
./rune lint     # ruff, mypy, biome, tsc
./rune guard    # the content rules CI enforces
```

## Licence

Code is MIT. The `core` content pack is CC BY-SA 4.0 (see
`content/packs/core/LICENSE`).
