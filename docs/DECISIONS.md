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

## The backing is a band, and it plays the parts you are not playing.

The backing is not the parts the arranger had left over. It is generated: the
accompaniment is read for its *harmony*, and a bass, something comping the
chords and a drum kit are built from it, following a groove taken from a style
table (`pipeline/src/runenote/styles.yaml`) chosen by the song's time
signature. The app mutes whichever of those roles the player's own level asks
their hands to play.

**Reason.** Playing along with a band is what turns a line of notes into
music, and it teaches something a metronome cannot: pulse you have to stay
with. You can drift away from a click and not notice. You cannot drift away
from a bass and a drummer.

Shipping the leftover parts instead would be less work and would actively do
harm. On piano sheet music the leftovers are the left hand — exactly what the
player takes over at level 3 — so the app would be playing the player's own
part back at them, correctly, over the top of their mistakes. That is the same
dishonest feedback the microphone decision exists to avoid, arriving by a
different door.

Muting by role is the other half of it, and it makes the ladder mean something
on the way up: at the lower levels the band plays bass, keys and kit behind
your right hand. At level 3 your left hand takes the bass, so the bassist
stops. At level 4 you have the chords too, and it is just you and a drummer.
The band hands you its job one piece at a time, and the thinning is the point
rather than a fault.

**Not doing.** Shipping the source's leftover parts as the backing. One
backing file per tier: there is one file, and the app mutes what the level
covers. Inventing harmony where the song rests — the band's harmonic layers
rest with the accompaniment, though the kit keeps the pulse. Putting a style
under a time signature it does not name: 6/8 and 3/4 fill the same three
quarter notes and could not feel less alike, so a song in a signature no style
claims gets no band rather than the wrong one.

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

"Outside the repo" means outside git, not outside the checkout: a family pack
is a directory beside core, `content/packs/<id>/`, which `.gitignore` already
refuses. The dev server lists every directory there holding a `pack.json`
(`/packs/index.json`), so a pack appears on reload without any code naming it.
It sits in the checkout because that is the one place the pipeline and app
containers can both already see; a second mount for a folder elsewhere would
be one more path for Git Bash to mangle. A pack that fails to load is shown as
an error and skipped, and core still plays.

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

**As built.** The line runs up to the next moment with an unplayed note and
stands there. A chord wants every note, in any order. The right pitch counts
whenever it comes, early included, because rushing is a rhythm fault and
rhythm is tempo mode's to judge. A wrong note is drawn as a ring on the line
or space of the key pressed, so the player sees how far off it was, not just
that it was wrong. The band holds back its notes on the waiting beat and comes
in with the player. Wait mode is also why output latency does not matter yet:
nothing here is judged against a clock. It will matter for tempo mode, which
needs the tap-along calibration first.

## Per-bar accuracy is recorded from the first version.

**Reason.** Every later mode consumes it: contextual tips ("bar 12 again, left
hand alone, half speed"), Survival's difficulty ramp, and Quests' revisit
steps. Retrofitting it later means the early practice data is lost.

**As built.** Each finished run appends one record per bar: notes written,
notes found before any wrong note at that moment, wrong notes, total waiting,
and the longest single wait. That last one is how wait mode reveals a note the
player did not know, which a wrong-note count cannot see, since they could
simply stop and look. The records are kept raw, and grading them is left to
whoever reads them. They live in the browser's local storage, which is fine for
one family on one machine but easy to lose. A run abandoned with restart is
not recorded.

**Not doing.** A global score only.

## Two importers, one internal model.

**Reason.** MIDI orchestrations (VGMusic and the like) give the backing track
for free and make the melody hard to find. Piano sheet music (NinSheetMusic,
MuseScore, IMSLP) gives the melody and a clean two-hand arrangement and no
backing. They are mirror images, so both feed one model of melody, chord track
and backing tracks, and everything downstream is shared.

Since the band became generated, the backing no longer comes from any source,
so what matters in a MIDI file is the same as in MusicXML: a melody part and
some harmony. The MIDI door is therefore just a second way to read piano sheet
music, because MIDI is the format NinSheetMusic reliably offers beside the
PDF; its notation source files, where present, are not MusicXML. It is quantised to sixteenths and eighth-note triplets on the way
in. A test holds the rule that a MIDI export of a score arranges to exactly
the notes the score does.

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

In the moving line, **space is time**: one beat is always the same width, and
the barline tucks in before the downbeat instead of taking room of its own.
Printed music spaces for reading, and a line spaced that way cannot move at a
constant speed: measured, a third of the note-to-note stretches changed speed
by over a quarter, and the eye reads that as a stutter. So the moving line is
drawn by us, not by the page engraver. It also makes rhythm visible — a half
note is followed by twice the room of a quarter — and each note carries a
faint bar the length it is held. That bar is help printed music does not
give, so it is a candidate to fade as a player improves, as the correct-note
cue will be.

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

## The playhead is the clock. The band is scheduled from it, never started and left to run.

Every frame, the app works out which of the band's notes fall in the next
tenth of a second of *playhead* time and hands those to the audio clock with
exact times. Nothing is ever simply started and left playing.

**Reason.** The playhead is not wall-clock time. It stops when the player
pauses, jumps back when a run restarts, and in wait mode — the default
play-along — it stops dead until the player finds the next note. A backing
running on its own clock would come apart the first time a seven year old
hesitated, and the first thing they would learn is that the app's timing is
not to be trusted.

Scheduling from the playhead also puts the two clocks where each is good.
Frames are jittery and timers are coarse, so neither can place a note on a
beat; but neither has to, because they only decide *what*. The audio clock,
which is accurate to the sample, decides *when*. The look-ahead is short on
purpose: everything handed over is going to be heard, so a generous one would
keep the band playing for a moment after the player stopped, which in wait
mode is precisely the wrong moment.

The instruments are synthesised rather than sampled. A sampled band would
sound better and would be tens of megabytes of someone else's recordings,
which is the licence question this repository exists to avoid. When a sampled
kit earns its place it belongs in a content pack, as an asset with a licence,
not in the code. The voices decay rather than sustain, which is also a
learning choice: a pad held under a beginner covers their timing, and a
plucked note does not.

The app does not sound the player's own notes unless asked. A MIDI piano
already makes its own sound, and hearing every note twice a few milliseconds
apart is worse than the app being quiet; a keyboard with no speakers is the
case the setting exists for.

**Not doing.** An audio element, or a MIDI player running at its own tempo.
Reading the tempo out of `backing.mid`: the bundle states one tempo and the
playhead counts quarter notes, and two clocks drift. A sustained pad. A
metronome, which is a separate decision and has to earn its own place.
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
