// The note highway: notes fall onto a picture of the keyboard.
//
// The x-axis is the keyboard itself, so "where is this note" and "which key
// do I press" are the same question. The width shown is the tier's range from
// song.json, which means level 1 of a song draws exactly the five keys the
// hand sits on, and moving up a level visibly widens the instrument.

import { isBlackKey, type Piece, type TimedNote, whitesBelow } from "./music";

/** Seconds of music visible above the keyboard. Long enough to read ahead. */
const LEAD_SECONDS = 2.6;
const KEYBOARD_FRACTION = 0.19;
const MIN_NOTE_HEIGHT = 10;
/** A five-key level stretched over a wide screen reads as blocks, not as a
    keyboard, so keys have a real size and the board is centred. A level that
    uses more of the keyboard then visibly takes up more of the screen. */
const MAX_WHITE_KEY_PX = 76;

export interface Range {
  low: number;
  high: number;
}

interface Key {
  midi: number;
  x: number;
  width: number;
  black: boolean;
}

/** White keys are evenly spaced; black keys straddle the seam between them. */
export function keyboard({ low, high }: Range): Key[] {
  let first = low;
  let last = high;
  while (isBlackKey(first)) {
    first--;
  }
  while (isBlackKey(last)) {
    last++;
  }
  const whites = whitesBelow(last) - whitesBelow(first) + 1;
  const unit = 1 / whites;
  const keys: Key[] = [];
  for (let midi = first; midi <= last; midi++) {
    const offset = (whitesBelow(midi) - whitesBelow(first)) * unit;
    if (isBlackKey(midi)) {
      const width = unit * 0.62;
      keys.push({ midi, x: offset - width / 2, width, black: true });
    } else {
      keys.push({ midi, x: offset, width: unit, black: false });
    }
  }
  return keys;
}

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

function readStyle(element: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

export class Highway {
  private readonly ctx: CanvasRenderingContext2D;
  private keys: Key[] = [];
  private colours = { right: "#46d39a", left: "#7aa2ff", panel: "#161922", line: "#2b3142" };
  private piece: Piece = { notes: [], bars: [], quarters: 0 };
  private tempo = 120;
  private width = 0;
  private height = 0;
  /** Notes currently held down, however they arrived: MIDI, mouse or stand-in keys. */
  private pressed = new Set<number>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("this browser has no 2d canvas");
    }
    this.ctx = ctx;
  }

  load(piece: Piece, range: Range, tempoBpm: number): void {
    this.piece = piece;
    this.keys = keyboard(range);
    this.tempo = tempoBpm;
    // Colours live in the stylesheet so the theme has one home.
    this.colours = {
      right: readStyle(this.canvas, "--right", this.colours.right),
      left: readStyle(this.canvas, "--left", this.colours.left),
      panel: readStyle(this.canvas, "--panel-hi", this.colours.panel),
      line: readStyle(this.canvas, "--line", this.colours.line),
    };
  }

  setPressed(notes: Set<number>): void {
    this.pressed = notes;
  }

  /** Matches the backing store to the element's size in device pixels. */
  private resize(): void {
    const scale = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.canvas;
    this.width = clientWidth;
    this.height = clientHeight;
    const w = Math.round(clientWidth * scale);
    const h = Math.round(clientHeight * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  /** `now` is the playhead in quarter notes; notes at `now` sit on the hit line. */
  draw(now: number): void {
    this.resize();
    const { ctx, width, height } = this;
    if (width === 0 || height === 0) {
      return;
    }
    const keyboardTop = height * (1 - KEYBOARD_FRACTION);
    const leadQuarters = (LEAD_SECONDS * this.tempo) / 60;
    const pxPerQuarter = keyboardTop / leadQuarters;
    const whites = this.keys.reduce((n, key) => n + (key.black ? 0 : 1), 0);
    const board = Math.min(width, whites * MAX_WHITE_KEY_PX);
    const left = (width - board) / 2;

    ctx.clearRect(0, 0, width, height);
    this.drawBars(now, keyboardTop, pxPerQuarter, left, board);
    this.drawNotes(now, keyboardTop, pxPerQuarter, left, board);
    this.drawHitLine(keyboardTop, left, board);
    this.drawKeyboard(now, keyboardTop, height - keyboardTop, left, board);
  }

  private drawBars(
    now: number,
    keyboardTop: number,
    pxPerQuarter: number,
    left: number,
    board: number,
  ): void {
    const { ctx } = this;
    ctx.strokeStyle = this.colours.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const bar of this.piece.bars) {
      const y = keyboardTop - (bar - now) * pxPerQuarter;
      if (y >= 0 && y <= keyboardTop) {
        ctx.moveTo(left, Math.round(y) + 0.5);
        ctx.lineTo(left + board, Math.round(y) + 0.5);
      }
    }
    ctx.stroke();
  }

  private noteBox(note: TimedNote, now: number, keyboardTop: number, pxPerQuarter: number) {
    const key = this.keys.find((k) => k.midi === note.midi);
    if (!key) {
      return undefined;
    }
    const bottom = keyboardTop - (note.start - now) * pxPerQuarter;
    const top = keyboardTop - (note.start + note.duration - now) * pxPerQuarter;
    const height = Math.max(bottom - top, MIN_NOTE_HEIGHT);
    return { key, top: bottom - height, height };
  }

  private drawNotes(
    now: number,
    keyboardTop: number,
    pxPerQuarter: number,
    left: number,
    board: number,
  ): void {
    const { ctx } = this;
    for (const note of this.piece.notes) {
      const box = this.noteBox(note, now, keyboardTop, pxPerQuarter);
      if (!box || box.top > keyboardTop || box.top + box.height < 0) {
        continue;
      }
      const inset = box.key.black ? 0.14 : 0.1;
      const x = left + (box.key.x + box.key.width * inset) * board;
      const w = box.key.width * (1 - inset * 2) * board;
      const colour = note.hand === "left" ? this.colours.left : this.colours.right;
      // A note straddling the hit line is the one to play now, so it glows.
      const live = note.start <= now && now < note.start + note.duration;
      ctx.globalAlpha = live ? 1 : 0.9;
      ctx.shadowColor = colour;
      ctx.shadowBlur = live ? 24 : 8;
      ctx.fillStyle = colour;
      rounded(ctx, x, box.top, w, box.height, 7);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  private drawHitLine(keyboardTop: number, left: number, board: number): void {
    const { ctx } = this;
    const gradient = ctx.createLinearGradient(0, keyboardTop - 40, 0, keyboardTop);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(255,255,255,0.10)");
    ctx.fillStyle = gradient;
    ctx.fillRect(left, keyboardTop - 40, board, 40);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(left, keyboardTop - 2, board, 2);
  }

  private drawKeyboard(
    now: number,
    top: number,
    height: number,
    left: number,
    board: number,
  ): void {
    const { ctx } = this;
    // Sounding notes tint their key, so the eye can check hand against screen.
    const sounding = new Map<number, string>();
    for (const note of this.piece.notes) {
      if (note.start <= now && now < note.start + note.duration) {
        sounding.set(note.midi, note.hand === "left" ? this.colours.left : this.colours.right);
      }
    }
    for (const key of this.keys.filter((k) => !k.black)) {
      ctx.fillStyle = this.pressed.has(key.midi)
        ? "#ffffff"
        : (sounding.get(key.midi) ?? "rgba(236,240,247,0.86)");
      rounded(ctx, left + key.x * board + 1, top, key.width * board - 2, height, 6);
    }
    for (const key of this.keys.filter((k) => k.black)) {
      ctx.fillStyle = this.pressed.has(key.midi)
        ? "#ffffff"
        : (sounding.get(key.midi) ?? "#10131a");
      rounded(ctx, left + key.x * board, top, key.width * board, height * 0.62, 5);
    }
  }
}
