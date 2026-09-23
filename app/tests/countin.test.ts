// The count-in's rules: it is the band's own opening bar, it ends exactly
// where the song begins, it keeps the beat grid through a pickup, and it
// never rings on into the song.

import { describe, expect, it } from "vitest";
import { barQuarters, countInNotes, countInStart } from "../src/countin";
import type { BackingNote } from "../src/smf";

function b(start: number, duration = 1, channel = 0): BackingNote {
  return { midi: 36, start, duration, velocity: 100, channel };
}

describe("barQuarters", () => {
  it("reads a bar's length from the time signature", () => {
    expect(["4/4", "3/4", "6/8", "2/2"].map(barQuarters)).toEqual([4, 3, 3, 4]);
  });
});

describe("countInStart", () => {
  it("starts two whole bars before the song", () => {
    expect(countInStart([0, 4, 8], 4)).toBe(-8);
    expect(countInStart([0, 3, 6], 3)).toBe(-6);
  });

  it("keeps the downbeat on the count's grid when the song opens with a pickup", () => {
    // One-beat pickup in 4/4: the first downbeat is at quarter 1, so the
    // count-in ends at -3 and the pickup fills the last beat of that bar.
    expect(countInStart([0, 1, 5], 4)).toBe(-11);
  });
});

describe("countInNotes", () => {
  it("plays the band's first bar twice, ending where the song starts", () => {
    const backing = [b(0), b(2), b(4), b(6)];
    expect(countInNotes(backing, [0, 4, 8], 4).map((n) => n.start)).toEqual([-8, -6, -4, -2]);
  });

  it("cuts a note at the barline so nothing rings into the song", () => {
    const notes = countInNotes([b(3, 3)], [0, 4], 4);
    expect(notes.map((n) => [n.start, n.duration])).toEqual([
      [-5, 1],
      [-1, 1],
    ]);
  });

  it("keeps each note's channel, so the band stands down from the same roles", () => {
    const notes = countInNotes([b(0, 1, 9), b(0, 1, 1)], [0, 4], 4);
    expect(new Set(notes.map((n) => n.channel))).toEqual(new Set([9, 1]));
  });

  it("borrows the first whole bar after a pickup, not the pickup", () => {
    const notes = countInNotes([b(0), b(1), b(3)], [0, 1, 5], 4);
    expect(notes.map((n) => n.start)).toEqual([-11, -9, -7, -5]);
  });
});
