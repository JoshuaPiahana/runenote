// Wait mode's rules. Each test is one rule a player would feel if it broke:
// the music never runs past a note nobody has played, a chord wants all of
// itself, a wrong note costs the bar it happened in and not the next one,
// and the per-bar numbers add up to what was written.

import { describe, expect, it } from "vitest";
import { Follower, intendedHand, onsets } from "../src/follow";
import type { Piece, TimedNote } from "../src/music";

function n(midi: number, start: number, hand: TimedNote["hand"] = "right"): TimedNote {
  return { midi, start, duration: 1, hand };
}

// Two bars of 4/4: E E F G | C-major chord under G, then E.
const PIECE: Piece = {
  notes: [
    n(64, 0),
    n(64, 1),
    n(65, 2),
    n(67, 3),
    n(48, 4, "left"),
    n(52, 4, "left"),
    n(67, 4),
    n(64, 5),
  ],
  bars: [0, 4],
  quarters: 8,
};

describe("Follower", () => {
  it("waits at the first note nobody has played yet", () => {
    const f = new Follower(PIECE);
    expect(f.waitingAt).toBe(0);
    f.play(64);
    expect(f.waitingAt).toBe(1);
  });

  it("treats a repeated pitch as a new note that needs a new press", () => {
    const f = new Follower(PIECE);
    expect(f.play(64)).toMatchObject({ kind: "hit", onsetDone: true });
    expect(f.waitingAt).toBe(1);
    expect(f.play(64)).toMatchObject({ kind: "hit" });
    expect(f.waitingAt).toBe(2);
  });

  it("wants every note of a chord, in any order, before moving on", () => {
    const f = new Follower(PIECE);
    for (const midi of [64, 64, 65, 67]) {
      f.play(midi);
    }
    expect(f.play(52)).toMatchObject({ kind: "hit", onsetDone: false });
    expect(f.play(67)).toMatchObject({ kind: "hit", onsetDone: false });
    expect(f.waitingAt).toBe(4);
    expect(f.play(48)).toMatchObject({ kind: "hit", onsetDone: true });
    expect(f.waitingAt).toBe(5);
  });

  it("does not move on for a wrong note, and says what was wanted", () => {
    const f = new Follower(PIECE);
    const judgement = f.play(62);
    expect(judgement).toEqual({ kind: "wrong", midi: 62, wanted: [n(64, 0)] });
    expect(f.waitingAt).toBe(0);
  });

  it("does not accept the note after next, even if it is right later", () => {
    const f = new Follower(PIECE);
    expect(f.play(65).kind).toBe("wrong");
  });

  it("charges a wrong note to the bar being played and stops that moment counting as clean", () => {
    const f = new Follower(PIECE);
    for (const midi of [64, 64, 65, 67]) {
      f.play(midi);
    }
    f.play(48); // clean: before the slip
    f.play(50); // wrong
    f.play(52);
    f.play(67);
    f.play(64); // a new moment, clean again
    expect(f.bars).toEqual([
      { bar: 1, notes: 4, clean: 4, wrong: 0, waitedMs: 0, longestWaitMs: 0 },
      { bar: 2, notes: 4, clean: 2, wrong: 1, waitedMs: 0, longestWaitMs: 0 },
    ]);
  });

  it("puts waiting time on the bar of the note being waited for", () => {
    const f = new Follower(PIECE);
    f.waited(300);
    for (const midi of [64, 64, 65, 67]) {
      f.play(midi);
    }
    f.waited(1200);
    for (const midi of [48, 52, 67]) {
      f.play(midi);
    }
    f.waited(100);
    expect(f.bars.map((b) => b.waitedMs)).toEqual([300, 1300]);
    // The long wait was one note, the short one another: each is its own.
    expect(f.bars.map((b) => b.longestWaitMs)).toEqual([300, 1200]);
  });

  it("stops waiting once the piece is played, and ignores anything after", () => {
    const f = new Follower(PIECE);
    for (const midi of [64, 64, 65, 67, 48, 52, 67, 64]) {
      f.play(midi);
    }
    expect(f.done).toBe(true);
    expect(f.waitingAt).toBe(Number.POSITIVE_INFINITY);
    expect(f.play(60)).toEqual({ kind: "ignored" });
    expect(f.bars.reduce((sum, b) => sum + b.wrong, 0)).toBe(0);
  });
});

describe("onsets", () => {
  it("counts a pitch both hands play at once as one key", () => {
    const piece: Piece = { notes: [n(60, 0, "left"), n(60, 0)], bars: [0], quarters: 1 };
    expect(onsets(piece)[0]?.notes).toHaveLength(1);
  });

  it("numbers bars from the score's own bar starts, so a pickup is bar 1", () => {
    const piece: Piece = { notes: [n(67, 0), n(72, 1), n(71, 2.5)], bars: [0, 1, 4], quarters: 5 };
    expect(onsets(piece).map((o) => o.bar)).toEqual([1, 2, 2]);
  });
});

describe("intendedHand", () => {
  it("is the hand of the wanted notes when there is only one", () => {
    expect(intendedHand([n(48, 0, "left"), n(52, 0, "left")])).toBe("left");
    expect(intendedHand([n(48, 0, "left"), n(67, 0)])).toBeUndefined();
  });
});
