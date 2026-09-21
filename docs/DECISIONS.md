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

## A stray note may be folded. A tune may not.

**Reason.** The bottom of the ladder is a five-finger hand position, and
many tunes leave it for one note: Ode to Joy drops to the low dominant once
in sixteen bars. Moving that one note up an octave keeps the song available
at the stage where a child cannot yet shift their hand, and the rhythm and
every other note stay where they were. But folding is also the fastest way to
teach a different tune, so the table caps how many notes it may touch (a tenth
of them) and allows it only at the lowest level. Past the cap, the level does
not exist for that song.

**Not doing.** Folding at any other level, or folding more than a few notes.
A melody that needs more has a higher floor.

## One key per song. Every level and the backing share it.

**Reason.** There is one backing track, and a child moving up a level should
hear and play the same song, not a transposed cousin of it. So the song is
transposed once, to the nearest key friendly enough for the easiest level it
reaches (Ode to Joy: D major to C major, two semitones down), and every level
is written in that key. Ties in "nearest" go downward, which is a guess: it
keeps a right-hand melody nearer middle C more often than not.

**Not doing.** Per-level keys, or leaving the top level in the original key
while the rest move. When the app can play a song in more than one key, that
is a transposition feature in the app, not a second bundle.

## A bundle carries its source and the choices that made it. It is never edited by hand.

**Reason.** Arrangements are generated, so a bundle is a build product. If it
were touched by hand, the next pipeline improvement would silently miss it,
and nobody would know which bundles were still honest. So each bundle holds
its source file and `song.json` records the one human decision (which part is
the melody) along with the licence and origin, which is enough to make the
bundle again. A test regenerates every core bundle and expects no change: a
diff means the pipeline changed (regenerate and commit) or someone edited a
bundle (do not).

**Not doing.** Hand corrections to a tier file. Fix the source, or the
pipeline, and regenerate.

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
