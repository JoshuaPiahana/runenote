// @vitest-environment happy-dom

// The highway shows what these functions return, so a mistake here is a
// mistake a child copies. The rules tested are the ones that would be wrong
// silently: chords stack, rests take time, ties join, and the keyboard's
// x-axis is a real keyboard.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { keyboard } from "../src/highway";
import { isBlackKey, parseMusicXml, whitesBelow } from "../src/music";

// Resolved from the vitest root (app/) rather than import.meta.url, which
// under the happy-dom environment is a document URL, not a file one.
const TIER_4 = resolve(process.cwd(), "../content/packs/core/ode-to-joy/tier-4.musicxml");

function score(parts: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Right hand</part-name></score-part>
    <score-part id="P2"><part-name>Left hand</part-name></score-part>
  </part-list>
  ${parts}
</score-partwise>`;
}

function note(step: string, octave: number, duration: number, extra = ""): string {
  return `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration></note>`;
}

const ATTRS = "<attributes><divisions>2</divisions></attributes>";

describe("parseMusicXml", () => {
  it("advances time by each note's duration", () => {
    const xml = score(
      `<part id="P1"><measure number="1">${ATTRS}${note("C", 4, 2)}${note("D", 4, 4)}</measure></part>`,
    );
    expect(parseMusicXml(xml).notes).toEqual([
      { midi: 60, start: 0, duration: 1, hand: "right" },
      { midi: 62, start: 1, duration: 2, hand: "right" },
    ]);
  });

  it("stacks a chord on the note before it instead of advancing", () => {
    const xml = score(
      `<part id="P2"><measure number="1">${ATTRS}${note("C", 3, 4)}${note("E", 3, 4, "<chord />")}${note("G", 3, 4, "<chord />")}${note("F", 3, 2)}</measure></part>`,
    );
    const piece = parseMusicXml(xml);
    expect(piece.notes.map((n) => [n.midi, n.start])).toEqual([
      [48, 0],
      [52, 0],
      [55, 0],
      [53, 2],
    ]);
    expect(piece.notes.every((n) => n.hand === "left")).toBe(true);
  });

  it("gives a rest its time but no note", () => {
    const xml = score(
      `<part id="P1"><measure number="1">${ATTRS}<note><rest /><duration>2</duration></note>${note("C", 4, 2)}</measure></part>`,
    );
    expect(parseMusicXml(xml).notes).toEqual([{ midi: 60, start: 1, duration: 1, hand: "right" }]);
  });

  it("joins a tied note into one block, so it is struck once", () => {
    const xml = score(
      `<part id="P1"><measure number="1">${ATTRS}${note("C", 4, 4, '<tie type="start" />')}</measure>` +
        `<measure number="2">${note("C", 4, 4, '<tie type="stop" />')}</measure></part>`,
    );
    expect(parseMusicXml(xml).notes).toEqual([{ midi: 60, start: 0, duration: 4, hand: "right" }]);
  });

  it("reads accidentals from alter", () => {
    const xml = score(
      `<part id="P1"><measure number="1">${ATTRS}<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>2</duration></note></measure></part>`,
    );
    expect(parseMusicXml(xml).notes[0]?.midi).toBe(58);
  });

  it("records where each bar starts, not where one is assumed to", () => {
    const xml = score(
      `<part id="P1"><measure number="1">${ATTRS}${note("C", 4, 2)}</measure>` +
        `<measure number="2">${note("D", 4, 8)}</measure></part>`,
    );
    expect(parseMusicXml(xml).bars).toEqual([0, 1]);
  });

  it("refuses something that is not MusicXML rather than returning nothing", () => {
    expect(() => parseMusicXml("<score-partwise><part")).toThrow(/MusicXML/);
  });
});

describe("the committed Ode to Joy", () => {
  const piece = parseMusicXml(readFileSync(TIER_4, "utf8"));

  it("has both hands", () => {
    expect(new Set(piece.notes.map((n) => n.hand))).toEqual(new Set(["right", "left"]));
  });

  it("is sixteen bars of 4/4", () => {
    expect(piece.bars).toHaveLength(16);
    expect(piece.quarters).toBe(64);
  });

  it("opens on the E above middle C, which is the tune", () => {
    expect(piece.notes.find((n) => n.hand === "right")?.midi).toBe(64);
  });
});

describe("keyboard layout", () => {
  it("counts the white keys below a note", () => {
    expect(whitesBelow(60)).toBe(35); // C4: five octaves of seven
    expect(whitesBelow(62) - whitesBelow(60)).toBe(1); // C to D
    expect(whitesBelow(61)).toBe(whitesBelow(62)); // C# sits between them
  });

  it("knows the black keys", () => {
    expect([61, 63, 66, 68, 70].every(isBlackKey)).toBe(true);
    expect([60, 62, 64, 65, 67, 69, 71].some(isBlackKey)).toBe(false);
  });

  it("fills the width with the five keys of a five-finger level", () => {
    const keys = keyboard({ low: 60, high: 67 });
    const whites = keys.filter((k) => !k.black);
    expect(whites).toHaveLength(5); // C D E F G
    expect(whites[0]?.x).toBe(0);
    const last = whites[whites.length - 1];
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeCloseTo(1);
  });

  it("straddles black keys across the seam between white keys", () => {
    const keys = keyboard({ low: 60, high: 67 });
    const cSharp = keys.find((k) => k.midi === 61);
    const d = keys.find((k) => k.midi === 62);
    expect(cSharp?.black).toBe(true);
    // Centre of C# is the left edge of D, which is where a piano puts it.
    expect((cSharp?.x ?? 0) + (cSharp?.width ?? 0) / 2).toBeCloseTo(d?.x ?? 0);
  });

  it("widens the range out to whole white keys when a tier ends on a black one", () => {
    const keys = keyboard({ low: 61, high: 66 });
    expect(keys[0]?.midi).toBe(60);
    expect(keys[keys.length - 1]?.midi).toBe(67);
  });
});
