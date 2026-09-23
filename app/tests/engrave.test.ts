// @vitest-environment happy-dom

// The scrolling line is only smooth if space is time, and only readable if
// the notes land on the right lines. These are the rules that would break
// silently: nothing errors when a barline nudges a note along, the sheet just
// stutters again.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Engraving, layout, quarterWidth, readEngraving, SPACE } from "../src/engrave";

const TIER_4 = resolve(process.cwd(), "../content/packs/core/ode-to-joy/tier-4.musicxml");
const INK = { right: "#0f0", left: "#00f", music: "#888", lines: "#444" };

function score(measures: string, attributes = "<divisions>2</divisions>"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Right hand</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes>${attributes}<clef><sign>G</sign><line>2</line></clef></attributes>${measures}</measure></part>
</score-partwise>`;
}

function note(step: string, octave: number, duration: number, alter = 0, extra = ""): string {
  const a = alter ? `<alter>${alter}</alter>` : "";
  return `<note>${extra}<pitch><step>${step}</step>${a}<octave>${octave}</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`;
}

/** Bottom line of the first stave, where layout puts E4 in treble clef. */
const BOTTOM_LINE = SPACE * 5 + SPACE * 4;

describe("space is time", () => {
  const engraving = readEngraving(readFileSync(TIER_4, "utf8"));
  const drawn = layout(engraving, INK);

  it("puts every note at origin + start x a fixed width, barlines or not", () => {
    // Chord seconds step aside from the stem; everything else is on the grid.
    const onGrid = drawn.heads.filter(
      (h) => Math.abs(h.x - (drawn.origin + h.note.start * drawn.pxPerQuarter)) < 0.01,
    );
    expect(onGrid.length).toBeGreaterThan(drawn.heads.length * 0.95);
    for (const head of drawn.heads) {
      const gridX = drawn.origin + head.note.start * drawn.pxPerQuarter;
      expect(Math.abs(head.x - gridX)).toBeLessThan(SPACE * 1.3);
    }
  });

  it("tucks each barline in before its downbeat without moving it", () => {
    for (const [i, x] of drawn.barlines.entries()) {
      const downbeat = drawn.origin + (engraving.bars[i + 1] ?? 0) * drawn.pxPerQuarter;
      expect(x).toBeLessThan(downbeat);
      // Close enough to read as "this note starts the bar".
      expect(downbeat - x).toBeLessThan(SPACE * 1.5);
    }
  });

  it("gives the shortest note room for two noteheads", () => {
    const shortest = Math.min(...engraving.notes.map((n) => n.duration));
    expect(shortest * quarterWidth(engraving)).toBeGreaterThanOrEqual(SPACE * 2.5);
  });

  it("keeps a beat readable even when every note is long", () => {
    const slow: Engraving = {
      ...engraving,
      notes: engraving.notes.map((n) => ({ ...n, duration: 4 })),
    };
    expect(quarterWidth(slow)).toBeGreaterThanOrEqual(SPACE * 4);
  });
});

describe("where notes sit", () => {
  const headsOf = (xml: string) => layout(readEngraving(xml), INK).heads;

  it("puts E4 on the bottom treble line and middle C on the ledger line below", () => {
    const [e, c] = headsOf(score(note("E", 4, 2) + note("C", 4, 2)));
    expect(e?.y).toBeCloseTo(BOTTOM_LINE);
    expect(c?.y).toBeCloseTo(BOTTOM_LINE + SPACE);
  });

  it("draws a ledger line for middle C and none for E4", () => {
    const withC = layout(readEngraving(score(note("C", 4, 2))), INK).svg;
    const withE = layout(readEngraving(score(note("E", 4, 2))), INK).svg;
    const ledger = `y1="${BOTTOM_LINE + SPACE}"`;
    expect(withC).toContain(ledger);
    expect(withE).not.toContain(ledger);
  });

  it("puts the two notes of a second either side of the stem", () => {
    const [low, high] = headsOf(score(note("C", 5, 2) + note("D", 5, 2, 0, "<chord/>")));
    expect(low && high && high.x !== low.x).toBe(true);
  });
});

describe("accidentals", () => {
  const marks = (xml: string) => readEngraving(xml).notes.map((n) => n.accidental ?? "-");

  it("leaves what the key signature already says unmarked", () => {
    const g = "<divisions>2</divisions><key><fifths>1</fifths></key>";
    expect(marks(score(note("F", 4, 2, 1), g))).toEqual(["-"]);
  });

  it("marks a departure from the key, and it lasts to the barline", () => {
    const g = "<divisions>2</divisions><key><fifths>1</fifths></key>";
    expect(marks(score(note("F", 4, 2) + note("F", 4, 2) + note("F", 4, 2, 1), g))).toEqual([
      "natural",
      "-",
      "sharp",
    ]);
  });

  it("marks a sharp in C major", () => {
    expect(marks(score(note("C", 4, 2, 1)))).toEqual(["sharp"]);
  });
});

describe("feedback", () => {
  it("reads the key to press, accidentals and key included", () => {
    const g = "<divisions>2</divisions><key><fifths>1</fifths></key>";
    const pitches = readEngraving(
      score(note("C", 4, 2) + note("F", 4, 2, 1) + note("B", 3, 2, -1), g),
    );
    expect(pitches.notes.map((n) => n.midi)).toEqual([60, 66, 58]);
  });

  it("tags each head and its hold-bar with the head's index, so one note can be lit", () => {
    const drawn = layout(
      readEngraving(score(note("C", 5, 2) + note("E", 5, 2, 0, "<chord/>") + note("G", 4, 2))),
      INK,
    );
    const doc = new DOMParser().parseFromString(drawn.svg, "image/svg+xml");
    drawn.heads.forEach((head, i) => {
      const tagged = [...doc.querySelectorAll(`[data-i="${i}"]`)];
      expect(tagged.map((el) => el.tagName).sort()).toEqual(["ellipse", "rect"]);
      expect(Number(tagged.find((el) => el.tagName === "ellipse")?.getAttribute("cy"))).toBeCloseTo(
        head.y,
        0,
      );
    });
  });

  it("draws a wrong note on the line of the pitch played, so the distance shows", () => {
    const drawn = layout(readEngraving(score(note("E", 4, 2))), INK);
    // F4 is the first space: half a space above E4 on the bottom line.
    expect(drawn.wrongNote(0, 65, "right", "red")).toContain(`cy="${BOTTOM_LINE - SPACE / 2}"`);
    // Middle C gets its ledger line, in the wrong note's colour.
    expect(drawn.wrongNote(0, 60, "right", "red")).toMatch(/<line[^>]*stroke="red"/);
    // A black key is spelled as the key leans, and says so: C# in C major.
    const sharp = drawn.wrongNote(0, 61, "right", "red");
    expect(sharp).toContain(`cy="${BOTTOM_LINE + SPACE}"`);
    expect(sharp).toContain("♯");
  });
});
