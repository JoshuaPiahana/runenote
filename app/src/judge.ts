// Playing along at tempo: every key pressed is judged against what is
// written near the play line at that moment.
//
// A press is a hit when a written note of that pitch starts within the
// window either side of the playhead and has not been claimed yet; the
// nearest one is claimed. Any other press is a wrong note. A written note
// the play line has carried past the window without a press is a miss.
//
// Each hit keeps how early or late it was. Those offsets are not scored
// yet: they are the raw material for the tap-along calibration, since the
// median offset of a steady player is mostly the delay of the machine.
//
// This module keeps the score. It owns no clock and draws nothing, so the
// rules can be tested as rules.

import type { Hand, Piece, TimedNote } from "./music";

/**
 * How far either side of a note's start a press still counts, in ms. A
 * guess, generous because it has to cover a beginner and an uncalibrated
 * machine at once. Revisit with the offsets real runs record.
 */
export const WINDOW_MS = 200;

/**
 * One bar of one run. These are the numbers the later modes are built on
 * (DECISIONS: "Per-bar accuracy is recorded from the first version"), so
 * each says what the player did rather than a grade someone chose.
 */
export interface BarRecord {
  bar: number;
  /** Notes written in the bar, counting each pitch at each moment once. */
  notes: number;
  hit: number;
  missed: number;
  /** Keys pressed near this bar's notes that matched nothing. */
  wrong: number;
  /** Each hit's timing in ms, negative for early. Raw, for calibration. */
  offsetsMs: number[];
}

export type Judgement =
  | { kind: "hit"; note: TimedNote; offsetMs: number }
  | { kind: "wrong"; midi: number; near: TimedNote[] };

/** A written note and whether it has been claimed by a press. */
interface Target {
  note: TimedNote;
  bar: number;
  state: "open" | "hit" | "missed";
}

/** Bar number as printed, counting from 1, of a moment in quarters. */
export function barOf(bars: readonly number[], start: number): number {
  let bar = 1;
  bars.forEach((barStart, index) => {
    if (barStart <= start + 1e-6) {
      bar = index + 1;
    }
  });
  return bar;
}

export class Judge {
  private readonly targets: Target[] = [];
  private readonly records = new Map<number, BarRecord>();
  /** Every target before this index is settled, so sweeps start here. */
  private settled = 0;
  private readonly msPerQuarter: number;
  private readonly bars: readonly number[];

  constructor(piece: Piece, bpm: number) {
    this.msPerQuarter = 60000 / Math.max(bpm, 1);
    this.bars = piece.bars;
    for (const note of piece.notes) {
      // A pitch written twice at one moment (both hands in unison) is one
      // key to press, so it is one target.
      const twin = this.targets.find(
        (t) => t.note.midi === note.midi && Math.abs(t.note.start - note.start) < 1e-6,
      );
      if (twin) {
        continue;
      }
      const bar = barOf(piece.bars, note.start);
      this.targets.push({ note, bar, state: "open" });
      this.recordFor(bar).notes += 1;
    }
  }

  /** A key pressed with the playhead at `at` quarters. */
  play(midi: number, at: number): Judgement {
    const windowQ = WINDOW_MS / this.msPerQuarter;
    let best: Target | undefined;
    for (let i = this.settled; i < this.targets.length; i += 1) {
      const target = this.targets[i];
      if (!target || target.note.start > at + windowQ) {
        break;
      }
      if (
        target.state === "open" &&
        target.note.midi === midi &&
        Math.abs(target.note.start - at) <= windowQ &&
        (!best || Math.abs(target.note.start - at) < Math.abs(best.note.start - at))
      ) {
        best = target;
      }
    }
    if (best) {
      best.state = "hit";
      const offsetMs = (at - best.note.start) * this.msPerQuarter;
      const record = this.recordFor(best.bar);
      record.hit += 1;
      record.offsetsMs.push(Math.round(offsetMs));
      return { kind: "hit", note: best.note, offsetMs };
    }
    this.recordFor(barOf(this.bars, at)).wrong += 1;
    return { kind: "wrong", midi, near: this.near(at) };
  }

  /** Marks as missed every open note the playhead has carried past its
      window, and returns them. Call once a frame. */
  sweep(at: number): TimedNote[] {
    const windowQ = WINDOW_MS / this.msPerQuarter;
    const missed: TimedNote[] = [];
    while (this.settled < this.targets.length) {
      const target = this.targets[this.settled];
      if (!target || target.note.start + windowQ >= at) {
        break;
      }
      if (target.state === "open") {
        target.state = "missed";
        this.recordFor(target.bar).missed += 1;
        missed.push(target.note);
      }
      this.settled += 1;
    }
    return missed;
  }

  /** The earliest moment a press can count for anything. Before it, during
      the count-in, keys are not judged: there is nothing to play yet. */
  get opensAt(): number {
    const first = this.targets[0];
    return first ? first.note.start - WINDOW_MS / this.msPerQuarter : 0;
  }

  /** Every note has been hit or missed. */
  get done(): boolean {
    return this.settled >= this.targets.length;
  }

  /** Every bar that has notes, in order. */
  get barRecords(): BarRecord[] {
    return [...this.records.values()].sort((a, b) => a.bar - b.bar);
  }

  /** The written notes the player was most likely reaching for: those at the
      nearest moment to the playhead, played or not. */
  private near(at: number): TimedNote[] {
    let nearest = Number.POSITIVE_INFINITY;
    for (const t of this.targets) {
      nearest = Math.min(nearest, Math.abs(t.note.start - at));
    }
    return this.targets
      .filter((t) => Math.abs(Math.abs(t.note.start - at) - nearest) < 1e-6)
      .map((t) => t.note);
  }

  private recordFor(bar: number): BarRecord {
    let record = this.records.get(bar);
    if (!record) {
      record = { bar, notes: 0, hit: 0, missed: 0, wrong: 0, offsetsMs: [] };
      this.records.set(bar, record);
    }
    return record;
  }
}

/** Which hand a wrong note was most likely meant for: the hand of the notes
    it was near, when they are all one hand's. */
export function intendedHand(near: readonly TimedNote[]): Hand | undefined {
  const hands = new Set(near.map((n) => n.hand));
  return hands.size === 1 ? [...hands][0] : undefined;
}
