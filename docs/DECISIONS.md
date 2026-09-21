# Decisions

Why Runenote is the way it is. One entry per mechanic or structural choice.
Nothing ships without an entry, and "Duolingo does it" is never the reason.

Each entry has three parts: **what** we do, the **reason** (tied to learning
where it can be), and what we deliberately **do not** do.

---

## Input is MIDI only. There is no microphone mode.

**Reason.** A MIDI keyboard reports exactly which key was pressed and when, so
feedback is instant and honest. Polyphonic pitch detection through a microphone
is the hardest thing the commercial apps attempt and even they get it wrong,
which teaches a child to distrust the feedback.

**Not doing.** Microphone input, even as a fallback. If the instrument has no
MIDI, the answer is a cheap USB keyboard next to it, not a worse app.

## Arrangements are generated, with one human touch.

**Reason.** Arranging by hand in MuseScore costs 30-60 minutes a song, and the
library needs to grow faster than that or the app becomes a jukebox of five
tunes. The one step where automation fails most is picking the melody track, so
the pipeline asks a human to confirm it: ten seconds, not an hour.

**Not doing.** Hand-arranged content, and fully unattended import.

## Simplify by removing layers, never by rewriting the melody's rhythm.

**Reason.** Duolingo reshapes tunes to fit the notes learned so far, which
teaches the wrong tune. A wrong tune sticks. Easier tiers drop the left hand,
drop ornaments, transpose to friendlier keys, and fold the range, but the
melody's rhythm is the melody. If a tune's rhythm exceeds a tier, that tier
simply does not exist for that song: its floor is higher.

**Not doing.** Rhythm simplification or note removal in famous songs. Drill
material, which is generated rather than famous, may be composed to the
vocabulary being taught.

## Difficulty tiers are our own data table, not a curriculum.

**Reason.** The generator needs a concrete target for "easier": key, hand span,
rhythm vocabulary, left-hand pattern. That table is data, so it can be re-tuned
or later aligned to a method book by editing a file, not code. The kids'
tutor's curriculum (Faber Piano Adventures) is a useful reference for where
tier 1 should sit, nothing more.

**Not doing.** Encoding any exam board or method book in the code.

## Content packs are the unit of swap. Quests may only use the `core` pack.

**Reason.** This repository is public. An arrangement of a copyrighted game
theme committed here is redistribution, whatever we intend. So the repo holds
only the `core` pack, public-domain compositions with our own arrangements,
and the built-in quests may reference only that. Family packs live outside the
repo and are imported at runtime. The pack format is a JSON Schema checked by
both sides, so anything that validates plays. CI enforces the licence allowlist
and the core-only rule; the tests encode the rule, not a single example.

**Not doing.** Committing fan arrangements to any branch, ever, including
private ones, because rules with exceptions eventually let the wrong file
through.

## Wait mode ("Fermata mode") is the default play-along. Tempo mode is opt-in.

**Reason.** A beginner's errors come from not yet knowing the next note, not
from being slow. Waiting on the correct note turns every mistake into an
immediate retrieval attempt instead of a missed note scrolling past. Tempo mode
is for when the notes are known and fluency is the goal.

**Not doing.** Scrolling notation at a fixed tempo as the primary mode. It
scores well and feels like a game, but at fixed tempo a beginner's failure mode
is to flail and wait for the song to end, which teaches nothing.

## Per-bar accuracy is recorded from the first version.

**Reason.** Every later mode consumes it: contextual tips ("bar 12 again, left
hand alone, half speed"), Survival's difficulty ramp, and Quests' revisit
steps. Retrofitting it later means the early practice data is lost.

**Not doing.** A global score only.

## Two importers, one internal model.

**Reason.** MIDI orchestrations (VGMusic and the like) give the backing track
for free and make the melody hard to find. Piano sheet music (NinSheetMusic,
MuseScore, IMSLP) gives the melody and a clean two-hand arrangement and no
backing. They are mirror images, so both feed one model of melody, chord track
and backing tracks, and everything downstream is shared.

**Not doing.** Treating either format as the canonical source.

## A web app, run locally. No deployment yet.

**Reason.** A static TypeScript app is the fastest thing for one person to
build, fits the Docker-only machine, and Web MIDI works on `localhost` without
certificates. Deploying (GitHub Pages is the obvious route, and it is HTTPS,
which Web MIDI needs) is a later decision once the app is worth putting on a
music stand.

**Not doing.** A native app, or CD before there is something to deploy.

## Modes, in order of arrival: Free Play, Quests, Survival, tips.

**Free Play** first because it carries intrinsic motivation and sight-reading
exposure, and because it generates the accuracy data everything else needs.
**Quests** are the Duolingo unit skeleton with our reasons: learn one thing,
prepare on the song's own hard bars, perform, revisit old material interleaved.
**Survival** is a mashup of phrases from different songs until too many
mistakes: with no tune to lean on it is pure sight-reading, the skill tutors
under-teach and kids avoid. **Tips** on pause screens, contextual to the
player's recent errors, are the explicit explanation Duolingo omits.

**Not doing.** Hearts, or rewarding streak length for its own sake. Rewards go
to behaviours that produce learning: slow accurate runs, attempting the next
tier, reading something new.
