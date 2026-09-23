// Wait mode: the music follows the player.
//
// The piece is a list of onsets, the moments where something new is written.
// The next onset still wanting notes is the wait point: the playhead may run
// up to it and no further, so a player who does not yet know the next note
// is given time to find it rather than watching it scroll past (DECISIONS:
// "Wait mode is the default play-along").
//
// Every note played is judged against that one onset and nothing else. The
// right pitch counts whenever it arrives, early included: rushing is a
// rhythm fault, and rhythm is tempo mode's to judge, not this one's. Anything
// else is a wrong note, charged to the bar the player was trying to play.
//
// This module keeps the score. It owns no clock and draws nothing, so the
// rules can be tested as rules.

import type { Hand, Piece, TimedNote } from "./music";

export interface Onset {
  start: number;
  /** Bar number as printed, counting from 1. */
  bar: number;
  notes: TimedNote[];
}

/**
 * One bar of one run. These are the numbers the later modes are built on
 * (DECISIONS: "Per-bar accuracy is recorded from the first version"), so
 * each says what the player did rather than a grade someone chose.
 */
export interface BarRecord {
  bar: number;
  /** Notes written in the bar, counting each pitch at each moment once. */
  notes: number;
  /** Notes found before any wrong note at that moment. */
  clean: number;
  /** Wrong notes played while this bar's notes were wanted. */
  wrong: number;
  /** How long the music stood waiting in this bar, all notes together. */
  waitedMs: number;
  /** The longest the music stood at any one note in the bar. A long single
      wait marks a note not known; many short ones are just reading time. */
  longestWaitMs: number;
}

export type Judgement =
  | { kind: "hit"; note: TimedNote; onsetDone: boolean }
  | { kind: "wrong"; midi: number; wanted: TimedNote[] }
  /** Nothing left to play: the piece is over. */
  | { kind: "ignored" };

/** Groups a piece's notes by moment. A pitch written twice at one moment
    (both hands in unison) is one key to press, so it is kept once. */
export function onsets(piece: Piece): Onset[] {
  const out: Onset[] = [];
  for (const note of piece.notes) {
    const last = out.at(-1);
    if (last && Math.abs(last.start - note.start) < 1e-6) {
      if (!last.notes.some((n) => n.midi === note.midi)) {
        last.notes.push(note);
      }
    } else {
      out.push({ start: note.start, bar: barOf(piece.bars, note.start), notes: [note] });
    }
  }
  return out;
}

function barOf(bars: number[], start: number): number {
  let bar = 1;
  bars.forEach((barStart, index) => {
    if (barStart <= start + 1e-6) {
      bar = index + 1;
    }
  });
  return bar;
}

export class Follower {
  private readonly onsets: Onset[];
  private index = 0;
  /** Pitches of the current onset not yet played. */
  private remaining: TimedNote[] = [];
  /** A wrong note has been played at the current onset. */
  private fumbled = false;
  /** How long the music has stood at the current onset. */
  private stood = 0;
  private readonly records = new Map<number, BarRecord>();

  constructor(piece: Piece) {
    this.onsets = onsets(piece);
    for (const onset of this.onsets) {
      const record = this.recordFor(onset.bar);
      record.notes += onset.notes.length;
    }
    this.enter();
  }

  /** The onset the player is on, or undefined once the piece is played. */
  get current(): Onset | undefined {
    return this.onsets[this.index];
  }

  /** Where the playhead must stop. Infinity once there is nothing to wait for. */
  get waitingAt(): number {
    return this.current?.start ?? Number.POSITIVE_INFINITY;
  }

  get done(): boolean {
    return this.index >= this.onsets.length;
  }

  /** Notes of the current onset still to be played. */
  get wanted(): readonly TimedNote[] {
    return this.remaining;
  }

  play(midi: number): Judgement {
    const onset = this.current;
    if (!onset) {
      return { kind: "ignored" };
    }
    const found = this.remaining.findIndex((n) => n.midi === midi);
    const note = this.remaining[found];
    if (!note) {
      this.fumbled = true;
      this.recordFor(onset.bar).wrong += 1;
      return { kind: "wrong", midi, wanted: [...this.remaining] };
    }
    this.remaining.splice(found, 1);
    if (!this.fumbled) {
      this.recordFor(onset.bar).clean += 1;
    }
    const onsetDone = this.remaining.length === 0;
    if (onsetDone) {
      this.index += 1;
      this.enter();
    }
    return { kind: "hit", note, onsetDone };
  }

  /** The music stood still for this long waiting on the current onset. */
  waited(ms: number): void {
    const onset = this.current;
    if (onset && ms > 0) {
      const record = this.recordFor(onset.bar);
      record.waitedMs += ms;
      this.stood += ms;
      record.longestWaitMs = Math.max(record.longestWaitMs, this.stood);
    }
  }

  /** Every bar that has notes, in order. */
  get bars(): BarRecord[] {
    return [...this.records.values()].sort((a, b) => a.bar - b.bar);
  }

  private enter(): void {
    this.remaining = [...(this.current?.notes ?? [])];
    this.fumbled = false;
    this.stood = 0;
  }

  private recordFor(bar: number): BarRecord {
    let record = this.records.get(bar);
    if (!record) {
      record = { bar, notes: 0, clean: 0, wrong: 0, waitedMs: 0, longestWaitMs: 0 };
      this.records.set(bar, record);
    }
    return record;
  }
}

/** Which hand a wrong note was most likely meant for: the hand of the notes
    that were wanted, when they are all one hand's. */
export function intendedHand(wanted: readonly TimedNote[]): Hand | undefined {
  const hands = new Set(wanted.map((n) => n.hand));
  return hands.size === 1 ? [...hands][0] : undefined;
}
