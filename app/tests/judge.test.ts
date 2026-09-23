// Tempo play-along's rules. Each test is one rule a player would feel if it
// broke: a note in time counts, one out of time does not, a repeated pitch
// is claimed once per press, and a note let go by is a miss in its own bar.

import { describe, expect, it } from "vitest";
import { barOf, intendedHand, Judge, WINDOW_MS } from "../src/judge";
import type { Piece, TimedNote } from "../src/music";

function n(midi: number, start: number, hand: TimedNote["hand"] = "right"): TimedNote {
  return { midi, start, duration: 1, hand };
}

/** At 120 bpm a quarter is 500 ms, so the window is this many quarters. */
const BPM = 120;
const W = WINDOW_MS / 500;

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

describe("Judge", () => {
  it("counts a press inside the window as a hit and keeps how late it was", () => {
    const judge = new Judge(PIECE, BPM);
    const judgement = judge.play(64, 0.1);
    expect(judgement).toMatchObject({ kind: "hit", note: n(64, 0) });
    expect(judgement.kind === "hit" && judgement.offsetMs).toBeCloseTo(50);
  });

  it("counts the right pitch outside the window as wrong", () => {
    const judge = new Judge(PIECE, BPM);
    expect(judge.play(65, 2 - W - 0.05).kind).toBe("wrong");
    expect(judge.play(65, 2 + W + 0.05).kind).toBe("wrong");
  });

  it("gives a repeated pitch to the nearest unclaimed note, once per press", () => {
    const judge = new Judge(PIECE, BPM);
    judge.play(64, 0);
    // Late for the first E, which is already claimed: the second takes it.
    expect(judge.play(64, 0.7)).toMatchObject({ kind: "hit", note: n(64, 1) });
    expect(judge.play(64, 1).kind).toBe("wrong");
  });

  it("takes a chord's notes in any order", () => {
    const judge = new Judge(PIECE, BPM);
    for (const midi of [67, 48, 52]) {
      expect(judge.play(midi, 4.02).kind).toBe("hit");
    }
  });

  it("misses a note only once the play line has carried it past its window", () => {
    const judge = new Judge(PIECE, BPM);
    expect(judge.sweep(W - 0.01)).toEqual([]);
    expect(judge.sweep(W + 0.01)).toEqual([n(64, 0)]);
    // And it cannot be hit afterwards.
    expect(judge.play(64, 0.2).kind).toBe("wrong");
  });

  it("keeps each bar's own count: hits, misses and wrong notes land where they happened", () => {
    const judge = new Judge(PIECE, BPM);
    judge.play(64, 0);
    judge.play(64, 1);
    judge.play(66, 2); // wrong, in bar 1
    judge.play(65, 2);
    judge.play(67, 4); // G in time, chord under it let go
    judge.sweep(8);
    expect(judge.barRecords).toEqual([
      { bar: 1, notes: 4, hit: 3, missed: 1, wrong: 1, offsetsMs: [0, 0, 0] },
      { bar: 2, notes: 4, hit: 1, missed: 3, wrong: 0, offsetsMs: [0] },
    ]);
    expect(judge.done).toBe(true);
  });

  it("counts a pitch both hands play at once as one key", () => {
    const piece: Piece = { notes: [n(60, 0, "left"), n(60, 0)], bars: [0], quarters: 1 };
    expect(new Judge(piece, BPM).barRecords[0]?.notes).toBe(1);
  });

  it("says which notes a wrong press was near, so it can be drawn on the right stave", () => {
    const judge = new Judge(PIECE, BPM);
    const judgement = judge.play(50, 4);
    expect(judgement.kind === "wrong" && intendedHand(judgement.near)).toBeUndefined();
    const left: Piece = { ...PIECE, notes: [n(48, 0, "left"), n(52, 0, "left")] };
    const lefty = new Judge(left, BPM).play(50, 0);
    expect(lefty.kind === "wrong" && intendedHand(lefty.near)).toBe("left");
  });
});

describe("barOf", () => {
  it("numbers bars from the score's own bar starts, so a pickup is bar 1", () => {
    expect([0, 1, 2.5].map((q) => barOf([0, 1, 4], q))).toEqual([1, 2, 2]);
  });
});
