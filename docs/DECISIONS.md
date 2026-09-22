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

## The player reads notation, and the notation moves.

**Reason.** What made the first screen tiring was never the stave, it was the
page: a wall of small black marks on white, sixteen bars at once, with nothing
saying where you are. So the fix is not to stop using notation, it is to stop
using the page. One line of music scrolls horizontally past a fixed play line,
dark, with the notes in the colour of the hand that plays them. There is one
thing to look at and it is always in the same place.

This matters more than it looks. A falling-note highway was tried here first
and dropped, and it is worth writing down why: a highway is the most reliable
way ever invented to produce a player who cannot read music. The eldest is
learning to read weekly from a method book with a tutor, and an app drilled
daily that bypasses reading competes with that for no gain the app needs. The
scrolling stave keeps every hour of practice pointed at the skill the tutor is
teaching, which is what maximising learning means here.

The **traditional** view — the printed page, wrapped systems, black on cream —
stays one press away, because that is what the music looks like everywhere
except in this app, and a player should never be surprised by it.

**Not doing.** A falling-note highway, a piano-roll, or any display that shows
which key to press without showing what is written. Also not colouring notes by
pitch: colour here means "this is your hand", which is structural and never has
to be unlearned, rather than a code for note names that eventually must be.

## A song starts when the player plays its first note.

**Reason.** Borrowed from Duolingo Music, and kept because it earns its place:
nothing moves until the opening note is played, so a run never begins with the
player already behind. It puts the first act of every session in the player's
hands rather than a countdown's, and it means the very first thing that happens
is a note read off the stave and found on the keyboard — the whole skill, in
miniature, before the song has started.

Any note of the opening counts, so a two-hand piece does not demand a four-note
chord be struck together to begin; the prompt names one note, the top of the
melody, because naming four reads as an instruction to play a chord. The gate
is re-armed after every run, so looping the song never scrolls past a player
who has stopped to think.

**Not doing.** A countdown, a metronome lead-in, or an automatic start. Also not
requiring the full opening chord, which punishes the beginner the gate exists
to help.

## The interface is built for a controller first.

**Reason.** The player's hands are on a piano, not a mouse, and the screen is
across the room on a music stand. A d-pad and two buttons reach everything: it
works from the keyboard bench, it works from the sofa, and designing for six
commands forces large targets and shallow menus, which is also what a seven
year old needs. A mouse still works; nothing depends on it.

**Not doing.** Hover-only affordances, small hit targets, typed input anywhere
in the practice flow, or a layout that assumes a pointer.

## Dark by default, and no theme switch.

**Reason.** The room is dim, the screen is close, and the coloured notes only
read against something near black. One theme is one thing to get right. Hands
are told apart by colour *and* by stave, so colour is never the only cue.

**Not doing.** A light theme for the moving view, until someone actually
practises in a bright room and says so. The traditional view is already light,
because a printed page is.
