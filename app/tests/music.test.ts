// @vitest-environment happy-dom

// The screen shows what these functions return, so a mistake here is a
// mistake a child copies. The rules tested are the ones that would be wrong
// silently: chords stack, rests take time, ties join, the gate waits for the
// right note, and each hand keeps its colour.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { firstOnset, openingCue, parseMusicXml } from "../src/music";
import { colourNotesByHand } from "../src/score";

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

describe("firstOnset", () => {
  it("returns the whole opening chord, not just its lowest note", () => {
    const xml = score(
      `<part id="P2"><measure number="1">${ATTRS}${note("C", 3, 4)}${note("E", 3, 4, "<chord />")}${note("F", 3, 2)}</measure></part>`,
    );
    expect(firstOnset(parseMusicXml(xml)).map((n) => n.midi)).toEqual([48, 52]);
  });

  it("ignores notes that merely start early in the file but late in time", () => {
    const xml = score(
      `<part id="P1"><measure number="1">${ATTRS}<note><rest /><duration>2</duration></note>${note("G", 4, 2)}</measure></part>` +
        `<part id="P2"><measure number="1">${ATTRS}${note("C", 3, 2)}</measure></part>`,
    );
    expect(firstOnset(parseMusicXml(xml)).map((n) => n.midi)).toEqual([48]);
  });

  it("is empty for a piece with no notes, so the gate cannot lock", () => {
    expect(firstOnset({ notes: [], bars: [], quarters: 0 })).toEqual([]);
  });
});

describe("colourNotesByHand", () => {
  const xml = score(
    `<part id="P1"><measure number="1">${ATTRS}${note("C", 4, 2)}<note><rest /><duration>2</duration></note></measure></part>` +
      `<part id="P2"><measure number="1">${ATTRS}${note("C", 3, 2)}</measure></part>`,
  );
  const doc = new DOMParser().parseFromString(
    colourNotesByHand(xml, "#00ff00", "#0000ff"),
    "application/xml",
  );
  const coloursOf = (part: string) =>
    [...(doc?.querySelector(`part[id=${part}]`)?.getElementsByTagName("note") ?? [])].map((n) =>
      n.getAttribute("color"),
    );

  it("gives each hand its own colour", () => {
    expect(coloursOf("P1")[0]).toBe("#00ff00");
    expect(coloursOf("P2")[0]).toBe("#0000ff");
  });

  it("leaves rests uncoloured, because colour means 'you play this'", () => {
    expect(coloursOf("P1")[1]).toBeNull();
  });

  it("returns bad XML untouched, so OSMD reports the file and not us", () => {
    expect(colourNotesByHand("<part", "#000000", "#ffffff")).toBe("<part");
  });

  it("keeps the XML declaration, which is how OSMD tells music from a URL", () => {
    expect(colourNotesByHand(xml, "#00ff00", "#0000ff")).toMatch(/^<\?xml /);
  });

  // Both of these stopped the score loading at some point, so both are pinned.
  it("drops the DOCTYPE, whose DTD reference stops OSMD reading the score", () => {
    const withDoctype = xml.replace(
      "<score-partwise",
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise',
    );
    expect(colourNotesByHand(withDoctype, "#00ff00", "#0000ff")).not.toMatch(/DOCTYPE/);
  });

  it("still parses back to a partwise score, which is what OSMD looks for", () => {
    const again = new DOMParser().parseFromString(
      colourNotesByHand(xml, "#00ff00", "#0000ff"),
      "application/xml",
    );
    expect(again.documentElement.nodeName).toBe("score-partwise");
  });
});

describe("openingCue", () => {
  const piece = parseMusicXml(
    score(
      `<part id="P1"><measure number="1">${ATTRS}${note("E", 4, 2)}</measure></part>` +
        `<part id="P2"><measure number="1">${ATTRS}${note("C", 3, 2)}${note("E", 3, 2, "<chord />")}${note("G", 3, 2, "<chord />")}</measure></part>`,
    ),
  );

  it("asks for the tune, not the chord under it", () => {
    expect(openingCue(firstOnset(piece))?.midi).toBe(64);
  });

  it("falls back to the top note when the opening is left hand only", () => {
    const left = firstOnset(piece).filter((n) => n.hand === "left");
    expect(openingCue(left)?.midi).toBe(55);
  });

  it("has nothing to ask for in an empty piece", () => {
    expect(openingCue([])).toBeUndefined();
  });
});
