// The shell: three screens, driven by six commands, so a controller and a
// keyboard both reach everything. Nothing here needs a mouse.

import "./style.css";
import { loadPack, loadTier, type Song, type Tier } from "./bundle";
import { type Command, Gamepads, keyCommand } from "./gamepad";
import { standInNote } from "./keys";
import { connectMidi } from "./midi";
import { firstOnset, openingCue, type Piece, parseMusicXml, type TimedNote } from "./music";
import { midiToName } from "./notes";
import { Score, type ScoreView } from "./score";

const PACK_BASE = "/packs/core";
const VIEWS = ["scrolling", "traditional"] as const;
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
const transport = must("#transport");
const deviceLine = must("#device");
const errorLine = must("#error");
const sheet = must("#sheet");
const staff = must("#staff");
const playline = must("#playline");
const gate = must("#gate");

const score = new Score(staff);
const pads = new Gamepads();

let screen: ScreenName = "songs";
let songs: Song[] = [];
let song: Song | undefined;
let tier: Tier | undefined;
let piece: Piece | undefined;
let view: ScoreView = "scrolling";
/** Waiting for the opening note, running, or held. */
let state: "waiting" | "playing" | "paused" = "waiting";
let opening: TimedNote[] = [];
// The playhead is read from the clock, not accumulated a frame at a time: a
// dropped frame must lose a frame of animation, never a fraction of a beat,
// or the music quietly plays slower than the tempo it claims.
let heldAt = 0;
let startedAt = 0;
const pressed = new Set<number>();
/** Width of the sheet panel, read on layout rather than on every frame. */
let stageWidth = 0;

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
  songGrid.replaceChildren(
    ...songs.map((s) =>
      card(s.title, s.composer ?? "", () => {
        song = s;
        showLevels(s);
      }),
    ),
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

function armGate(): void {
  // Every run begins on the player's own note, including after a loop: the
  // music never starts without them, so there is nothing to catch up with.
  state = "waiting";
  heldAt = opening[0]?.start ?? 0;
  const cue = openingCue(opening);
  gate.textContent = cue ? `Play ${midiToName(cue.midi)} to start` : "";
  gate.hidden = !cue || !score.isScrolling;
  updateTransport();
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
    const xml = await loadTier(PACK_BASE, s, t);
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
  show("play");
  await draw();
}

function setView(next: ScoreView): void {
  view = next;
  viewName.textContent = next === "scrolling" ? "Scrolling" : "Traditional";
  screens.play.dataset.view = next;
  void draw();
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
      case "down":
        armGate();
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

  if (screen === "play" && piece && score.isScrolling) {
    const now = playhead();
    if (state === "playing" && now > piece.quarters + 2) {
      armGate();
    }
    // The sheet is moved rather than scrolled so the play line can stay put,
    // and the width comes from a variable rather than from the element so the
    // frame writes a style without also forcing a layout to read one back.
    staff.style.transform = `translateX(${stageWidth * PLAY_LINE - score.positionAt(now)}px)`;
  }
  requestAnimationFrame(frame);
}

// --- input ----------------------------------------------------------------

/** A note counts towards starting if it is one of the notes written there. */
function played(note: number): void {
  pressed.add(note);
  if (state === "waiting" && opening.some((wanted) => wanted.midi === note)) {
    release();
  }
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
      pressed.delete(note);
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

transport.onclick = togglePlay;
must("#back").onclick = () => run("back");
must("#view").onclick = () => run("right");

void connectMidi({
  onInputs(names) {
    deviceLine.textContent =
      names.length === 0 ? "No keyboard — type to play" : `Keyboard: ${names.join(", ")}`;
  },
  onNoteOn: played,
  onNoteOff(note) {
    pressed.delete(note);
  },
  onUnavailable() {
    deviceLine.textContent = "No Web MIDI — type to play";
  },
});

setView("scrolling");
void loadPack(PACK_BASE).then(({ songs: loaded }) => {
  songs = loaded;
  showSongs();
}, fail);
requestAnimationFrame(frame);
