// The shell: three screens, driven by six commands, so a controller and a
// keyboard both reach everything. Nothing here needs a mouse.

import "./style.css";
import { Band, rolesCovered } from "./audio";
import { type LoadedPack, loadBacking, loadPacks, loadTier, type Song, type Tier } from "./bundle";
import { type Command, Gamepads, keyCommand } from "./gamepad";
import { saveRun, summarise } from "./history";
import { intendedHand, Judge } from "./judge";
import { standInNote } from "./keys";
import { connectMidi } from "./midi";
import { firstOnset, openingCue, type Piece, parseMusicXml, type TimedNote } from "./music";
import { midiToName } from "./notes";
import { Score, type ScoreView } from "./score";

const VIEWS = ["scrolling", "traditional"] as const;
/** What makes a sound. The band alone is the default because a MIDI piano
    already sounds its own notes, and hearing each one twice a few
    milliseconds apart is worse than the app being quiet. */
const SOUNDS = [
  { id: "band", label: "Band", band: true, you: false },
  { id: "both", label: "Band + you", band: true, you: true },
  { id: "off", label: "Off", band: false, you: false },
] as const;
/** Where the play line sits, as a fraction of the sheet's width. Left of
    centre, because what is coming matters more than what has gone. */
const PLAY_LINE = 0.3;

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`page has no ${selector} element`);
  }
  return element;
}

const screens = {
  songs: must("#songs"),
  levels: must("#levels"),
  play: must("#play"),
};
type ScreenName = keyof typeof screens;

const songGrid = must("#song-grid");
const levelGrid = must("#level-grid");
const levelTitle = must("#level-title");
const playTitle = must("#play-title");
const playSub = must("#play-sub");
const viewName = must("#view-name");
const soundName = must("#sound-name");
const transport = must("#transport");
const deviceLine = must("#device");
const errorLine = must("#error");
const sheet = must("#sheet");
const staff = must("#staff");
const playline = must("#playline");
const gate = must("#gate");

const score = new Score(staff);
const pads = new Gamepads();
const band = new Band();

let screen: ScreenName = "songs";
let packs: LoadedPack[] = [];
/** The URL of the pack the chosen song came from. */
let packBase = "";
let packId = "";
let song: Song | undefined;
let tier: Tier | undefined;
let piece: Piece | undefined;
let view: ScoreView = "scrolling";
let sound: (typeof SOUNDS)[number] = SOUNDS[0];
/** Waiting for the opening note, running, or held. */
let state: "waiting" | "playing" | "paused" = "waiting";
let opening: TimedNote[] = [];
/** Keeps the score of the run in progress. */
let judge: Judge | undefined;
// The playhead is read from the clock, not accumulated a frame at a time: a
// dropped frame must lose a frame of animation, never a fraction of a beat,
// or the music quietly plays slower than the tempo it claims.
let heldAt = 0;
let startedAt = 0;
const pressed = new Set<number>();
/** Width of the sheet panel, read on layout rather than on every frame. */
let stageWidth = 0;
/** Which song's band is loaded, so switching levels does not fetch it again. */
let bandFor: string | undefined;

/** The playhead, in quarter notes from the start of the piece. */
function playhead(): number {
  if (state !== "playing") {
    return heldAt;
  }
  const minute = 60000;
  return heldAt + ((performance.now() - startedAt) * (song?.tempo_bpm ?? 120)) / minute;
}

// --- focus ----------------------------------------------------------------
// One list per screen, and every direction moves by one. With a handful of
// large cards that is predictable and can never strand the cursor.

function cards(): HTMLElement[] {
  return [...screens[screen].querySelectorAll<HTMLElement>(".card")];
}

function focusAt(index: number): void {
  const list = cards();
  if (list.length === 0) {
    return;
  }
  list[((index % list.length) + list.length) % list.length]?.focus();
}

function moveFocus(step: number): void {
  const list = cards();
  const current = list.indexOf(document.activeElement as HTMLElement);
  focusAt((current === -1 ? 0 : current) + step);
}

function show(name: ScreenName): void {
  screen = name;
  for (const [key, element] of Object.entries(screens)) {
    element.hidden = key !== name;
  }
  focusAt(0);
}

function fail(error: unknown): void {
  errorLine.textContent = error instanceof Error ? error.message : String(error);
  errorLine.hidden = false;
}

// --- cards ----------------------------------------------------------------

function heading(text: string): HTMLElement {
  const element = document.createElement("h2");
  element.className = "shelf";
  element.textContent = text;
  return element;
}

function card(title: string, subtitle: string, onPick: () => void): HTMLElement {
  const element = document.createElement("button");
  element.className = "card";
  element.type = "button";
  const titleNode = document.createElement("span");
  titleNode.className = "card-title";
  titleNode.textContent = title;
  const subNode = document.createElement("span");
  subNode.className = "card-sub";
  subNode.textContent = subtitle;
  element.append(titleNode, subNode);
  element.onclick = onPick;
  return element;
}

function describeTier(t: Tier): string {
  const hands = t.hands === "both" ? "Both hands" : `${t.hands === "left" ? "Left" : "Right"} hand`;
  return `${hands} · ${midiToName(t.range.low)}–${midiToName(t.range.high)}`;
}

function showSongs(): void {
  // A heading per pack once there is more than one, so a family pack reads
  // as its own shelf rather than songs mixed in among core's.
  songGrid.replaceChildren(
    ...packs.flatMap((p) => [
      ...(packs.length > 1 ? [heading(p.pack.name)] : []),
      ...p.songs.map((s) =>
        card(s.title, s.composer ?? "", () => {
          song = s;
          packBase = p.base;
          packId = p.pack.id;
          showLevels(s);
        }),
      ),
    ]),
  );
  show("songs");
}

function showLevels(s: Song): void {
  levelTitle.textContent = s.title;
  levelGrid.replaceChildren(
    ...s.tiers.map((t) => card(`Level ${t.level}`, describeTier(t), () => void startPlaying(s, t))),
  );
  show("levels");
}

// --- play -----------------------------------------------------------------

function colour(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** Sets up a fresh run. `result` is how the last one went, if it finished. */
function armGate(result?: string): void {
  // Every run begins on the player's own note, including after a loop: the
  // music never starts without them, so there is nothing to catch up with.
  state = "waiting";
  heldAt = opening[0]?.start ?? 0;
  judge = piece && song ? new Judge(piece, song.tempo_bpm) : undefined;
  score.clearFeedback();
  const cue = openingCue(opening);
  const prompt = cue ? `Play ${midiToName(cue.midi)} to ${result ? "go again" : "start"}` : "";
  gate.textContent = result ? `${result} ${prompt}` : prompt;
  gate.hidden = !cue || !score.isScrolling;
  updateTransport();
}

/** The last note has been played and has crossed the line: keep the record,
    tell the player how it went, and wait for them to go again. */
function finishRun(): void {
  if (judge && song && tier) {
    const bars = judge.barRecords;
    saveRun({
      pack: packId,
      song: song.id,
      level: tier.level,
      finished: new Date().toISOString(),
      mode: "tempo",
      bars,
    });
    armGate(summarise(bars));
  } else {
    armGate();
  }
}

function updateTransport(): void {
  transport.textContent = state === "playing" ? "Pause" : "Play";
}

/** The opening note has been found, so the music moves. */
function release(): void {
  if (state === "waiting") {
    startedAt = performance.now();
    state = "playing";
    gate.hidden = true;
    updateTransport();
  }
}

async function draw(): Promise<void> {
  const t = tier;
  const s = song;
  if (!t || !s) {
    return;
  }
  playline.hidden = !score.isScrolling;
  try {
    const xml = await loadTier(packBase, s, t);
    piece = parseMusicXml(xml);
    opening = firstOnset(piece);
    // The traditional view is the printed copy, and print is black: colour is
    // what the moving view adds, not something the notation carries around.
    const ink = view === "traditional" ? "#1a1a1a" : undefined;
    await score.show(
      xml,
      view,
      ink ?? colour("--right", "#3ee08a"),
      ink ?? colour("--left", "#6aa8ff"),
    );
    playline.hidden = !score.isScrolling;
    if (!score.isScrolling) {
      // The traditional view is a page, scrolled by the reader, not by us.
      staff.style.transform = "";
    }
    stageWidth = sheet.clientWidth;
    armGate();
  } catch (error) {
    fail(error);
  }
}

async function startPlaying(s: Song, t: Tier): Promise<void> {
  errorLine.hidden = true;
  song = s;
  tier = t;
  playTitle.textContent = s.title;
  playSub.textContent = `Level ${t.level} · ${describeTier(t)} · ♩ = ${s.tempo_bpm}`;
  // The band stands down from whatever this level puts in the player's own
  // hands, so it is never playing their part back at them.
  band.standDown(rolesCovered(t.layers));
  show("play");
  await Promise.all([draw(), loadBand(s)]);
}

/** The band for a song, fetched once and kept until another song is chosen. */
async function loadBand(s: Song): Promise<void> {
  const which = `${packBase}/${s.id}`;
  if (which === bandFor) {
    return;
  }
  try {
    band.load(await loadBacking(packBase, s), s.backing?.tracks ?? []);
    bandFor = which;
  } catch (error) {
    // A song with no band is quiet, not broken: the notation still plays.
    band.load([], []);
    bandFor = which;
    fail(error);
  }
}

function setView(next: ScoreView): void {
  view = next;
  viewName.textContent = next === "scrolling" ? "Scrolling" : "Traditional";
  screens.play.dataset.view = next;
  void draw();
}

function setSound(next: (typeof SOUNDS)[number]): void {
  sound = next;
  soundName.textContent = next.label;
  if (!next.band) {
    band.hold();
  }
}

function togglePlay(): void {
  if (state === "playing") {
    heldAt = playhead();
    state = "paused";
  } else if (state === "paused") {
    startedAt = performance.now();
    state = "playing";
  } else {
    // Starting from the button rather than the keyboard is allowed: the gate
    // is there to begin on your own note, not to lock anyone out.
    release();
  }
  updateTransport();
}

// --- commands -------------------------------------------------------------

function run(command: Command): void {
  if (screen === "play") {
    switch (command) {
      case "back":
        heldAt = playhead();
        state = "paused";
        if (song) {
          showLevels(song);
        }
        break;
      case "start":
      case "confirm":
        togglePlay();
        break;
      case "left":
      case "right": {
        const step = command === "right" ? 1 : VIEWS.length - 1;
        setView(VIEWS[(VIEWS.indexOf(view) + step) % VIEWS.length] ?? "scrolling");
        break;
      }
      case "up":
        armGate();
        break;
      case "down":
        setSound(SOUNDS[(SOUNDS.indexOf(sound) + 1) % SOUNDS.length] ?? SOUNDS[0]);
        break;
    }
    return;
  }
  switch (command) {
    case "up":
    case "left":
      moveFocus(-1);
      break;
    case "down":
    case "right":
      moveFocus(1);
      break;
    case "confirm":
      (document.activeElement as HTMLElement | null)?.click();
      break;
    case "back":
      if (screen === "levels") {
        showSongs();
      }
      break;
    case "start":
      break;
  }
}

// --- loop -----------------------------------------------------------------
// One animation frame drives the gamepad and the scroll: the Gamepad API has
// no events, so something has to poll, and this is the thing already running.

function frame(): void {
  pads.poll(run);

  // The band is driven from the playhead rather than started and left to run,
  // because the playhead stops: see audio.ts. Both views get it — the view is
  // how the music is drawn, not whether it is playing.
  if (screen === "play" && song && state === "playing" && sound.band) {
    band.follow(playhead(), song.tempo_bpm);
  } else {
    band.hold();
  }

  // Notes the line has carried past unplayed are misses; once every note is
  // settled and the last has crossed the line, the run is over.
  if (screen === "play" && piece && state === "playing" && judge) {
    const now = playhead();
    judge.sweep(now);
    if (judge.done && now > piece.quarters + 2) {
      finishRun();
    }
  }

  if (screen === "play" && piece && score.isScrolling) {
    const now = playhead();
    score.follow(now);
    // The sheet is moved rather than scrolled so the play line can stay put,
    // and the width comes from a variable rather than from the element so the
    // frame writes a style without also forcing a layout to read one back.
    staff.style.transform = `translateX(${stageWidth * PLAY_LINE - score.positionAt(now)}px)`;
  }
  requestAnimationFrame(frame);
}

// --- input ----------------------------------------------------------------

/**
 * A note counts towards starting if it is one of the notes written there;
 * once running, every note is judged against what is written at the play
 * line. Before the start and while paused nothing is judged: noodling about
 * on the keys is not a wrong note.
 */
function played(note: number, velocity = 90): void {
  pressed.add(note);
  if (sound.you) {
    band.pluck(note, velocity);
  }
  if (state === "waiting" && opening.some((wanted) => wanted.midi === note)) {
    release();
  }
  if (state !== "playing" || !judge) {
    return;
  }
  const now = playhead();
  const judgement = judge.play(note, now);
  if (judgement.kind === "hit") {
    score.hit(judgement.note);
  } else {
    score.wrong(now, note, intendedHand(judgement.near), colour("--wrong", "#ff7a6b"));
  }
}

function lifted(note: number): void {
  pressed.delete(note);
  score.release(note);
}

window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  const command = keyCommand(event);
  if (command) {
    event.preventDefault();
    run(command);
    return;
  }
  if (screen === "play" && tier) {
    const note = standInNote(event.key, tier.range.low);
    if (note !== undefined) {
      played(note);
    }
  }
});

window.addEventListener("keyup", (event) => {
  if (tier) {
    const note = standInNote(event.key, tier.range.low);
    if (note !== undefined) {
      lifted(note);
    }
  }
});

// OSMD lays out for the width it had, so a resized window means drawing the
// sheet again; the time-to-pixel map is rebuilt with it.
let resizing: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
  if (screen !== "play") {
    return;
  }
  clearTimeout(resizing);
  resizing = setTimeout(() => void draw(), 200);
});

// Browsers only start an audio clock from a real user gesture, and neither a
// MIDI note nor a gamepad button is one as far as the page is concerned. A
// key or a pointer is, and one of those always opens the page, so by the time
// the band is wanted the clock is awake; resuming one already running costs
// nothing. A session driven from the pad alone, from the first frame, would
// stay silent, and there is nothing the page can do about that from here.
for (const gesture of ["pointerdown", "keydown"] as const) {
  window.addEventListener(gesture, () => band.wake());
}

transport.onclick = togglePlay;
must("#back").onclick = () => run("back");
must("#view").onclick = () => run("right");
must("#sound").onclick = () => run("down");

void connectMidi({
  onInputs(names) {
    deviceLine.textContent =
      names.length === 0 ? "No keyboard — type to play" : `Keyboard: ${names.join(", ")}`;
  },
  onNoteOn: played,
  onNoteOff(note) {
    lifted(note);
  },
  onUnavailable() {
    deviceLine.textContent = "No Web MIDI — type to play";
  },
});

setView("scrolling");
setSound(SOUNDS[0]);
void loadPacks().then((loaded) => {
  packs = loaded.packs;
  if (loaded.problems.length > 0) {
    fail(new Error(`Skipped a pack: ${loaded.problems.join("; ")}`));
  }
  showSongs();
}, fail);
requestAnimationFrame(frame);
