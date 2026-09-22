// The shell: three screens, driven by six commands, so a controller and a
// keyboard both reach everything. Nothing here needs a mouse.

import "./style.css";
import { loadPack, loadTier, type Song, type Tier } from "./bundle";
import { type Command, Gamepads, keyCommand } from "./gamepad";
import { Highway } from "./highway";
import { standInNote } from "./keys";
import { connectMidi } from "./midi";
import { type Piece, parseMusicXml } from "./music";
import { midiToName } from "./notes";
import { Score } from "./score";

const PACK_BASE = "/packs/core";
/** Highway, both, notation: reading is a rung on a ladder, not a switch. */
const VIEWS = ["highway", "both", "notation"] as const;
type View = (typeof VIEWS)[number];

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
const canvas = must<HTMLCanvasElement>("#highway");
const sheet = must("#sheet");

const highway = new Highway(canvas);
const score = new Score(sheet);
const pads = new Gamepads();

let screen: ScreenName = "songs";
let songs: Song[] = [];
let song: Song | undefined;
let tier: Tier | undefined;
let piece: Piece | undefined;
let view: View = "highway";
let playing = false;
/** Playhead, in quarter notes from the start. */
let now = 0;
const pressed = new Set<number>();

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

function setView(next: View): void {
  view = next;
  viewName.textContent = next === "both" ? "Both" : next === "highway" ? "Highway" : "Notation";
  screens.play.dataset.view = next;
  // The sheet panel has just changed size, and OSMD measures its container
  // when it draws, so the layout it has is the one for the old size.
  if (next !== "highway") {
    requestAnimationFrame(() => score.redraw());
  }
}

function updateTransport(): void {
  transport.textContent = playing ? "Pause" : "Play";
}

async function startPlaying(s: Song, t: Tier): Promise<void> {
  errorLine.hidden = true;
  song = s;
  tier = t;
  now = 0;
  playing = false;
  updateTransport();
  playTitle.textContent = s.title;
  playSub.textContent = `Level ${t.level} · ${describeTier(t)} · ♩ = ${s.tempo_bpm}`;
  show("play");
  try {
    const xml = await loadTier(PACK_BASE, s, t);
    piece = parseMusicXml(xml);
    highway.load(piece, t.range, s.tempo_bpm);
    await score.show(xml);
    playing = true;
    updateTransport();
  } catch (error) {
    fail(error);
  }
}

function togglePlay(): void {
  playing = !playing;
  updateTransport();
}

// --- commands -------------------------------------------------------------

function run(command: Command): void {
  if (screen === "play") {
    switch (command) {
      case "back":
        playing = false;
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
        setView(VIEWS[(VIEWS.indexOf(view) + step) % VIEWS.length] ?? "highway");
        break;
      }
      case "up":
      case "down":
        now = 0;
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
// One animation frame drives the gamepad and the highway: the Gamepad API has
// no events, so something has to poll, and this is the thing already running.

let last = performance.now();

function frame(time: number): void {
  const elapsed = Math.min((time - last) / 1000, 0.1);
  last = time;
  pads.poll(run);

  if (screen === "play" && piece) {
    if (playing) {
      now += (elapsed * (song?.tempo_bpm ?? 120)) / 60;
      // Loops with a bar's rest, so the tune repeats while someone is still
      // deciding whether they like the look of it.
      if (now > piece.quarters + 4) {
        now = 0;
      }
    }
    if (view !== "notation") {
      highway.setPressed(pressed);
      highway.draw(now);
    }
  }
  requestAnimationFrame(frame);
}

// --- input ----------------------------------------------------------------

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
      pressed.add(note);
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

transport.onclick = togglePlay;
must("#back").onclick = () => run("back");
must("#view").onclick = () => run("right");

void connectMidi({
  onInputs(names) {
    deviceLine.textContent =
      names.length === 0 ? "No keyboard — type to play" : `Keyboard: ${names.join(", ")}`;
  },
  onNoteOn(note) {
    pressed.add(note);
  },
  onNoteOff(note) {
    pressed.delete(note);
  },
  onUnavailable() {
    deviceLine.textContent = "No Web MIDI — type to play";
  },
});

setView("highway");
void loadPack(PACK_BASE).then(({ songs: loaded }) => {
  songs = loaded;
  showSongs();
}, fail);
requestAnimationFrame(frame);
