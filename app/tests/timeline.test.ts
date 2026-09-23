import { describe, expect, it } from "vitest";
import { type Point, Timeline } from "../src/timeline";

// Spacing like OSMD's round a dotted figure: a crotchet, a dotted crotchet
// squeezed up against its quaver, a barline's worth of padding, then minims.
const UNEVEN: Point[] = [
  { t: 0, x: 100 },
  { t: 1, x: 135 },
  { t: 2, x: 170 },
  { t: 3.5, x: 222 },
  { t: 4, x: 254 },
  { t: 6, x: 318 },
  { t: 8, x: 400 },
  { t: 9, x: 435 },
];
const END = 480;

/** Pixels per quarter over a sliver of time either side of a moment. */
function speeds(line: Timeline, t: number): { before: number; after: number } {
  const e = 1e-4;
  return {
    before: (line.positionAt(t) - line.positionAt(t - e)) / e,
    after: (line.positionAt(t + e) - line.positionAt(t)) / e,
  };
}

describe("Timeline", () => {
  const line = new Timeline(UNEVEN, END);

  it("puts every note on the play line at its own moment", () => {
    for (const { t, x } of UNEVEN) {
      expect(line.positionAt(t)).toBeCloseTo(x, 9);
    }
  });

  it("never moves the sheet backwards", () => {
    let previous = line.positionAt(-1);
    for (let t = -1; t <= 12; t += 0.01) {
      const x = line.positionAt(t);
      expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = x;
    }
  });

  it("changes speed gradually: no step at any note", () => {
    // The rule the straight-line version broke, 1.77x at its worst.
    for (const { t } of UNEVEN.slice(1, -1)) {
      const { before, after } = speeds(line, t);
      expect(after / before).toBeCloseTo(1, 2);
    }
  });

  it("keeps even spacing at an even speed", () => {
    // Smoothing must not invent motion where there was nothing to smooth.
    const even = new Timeline(
      [0, 1, 2, 3, 4].map((t) => ({ t, x: 10 + 30 * t })),
      200,
    );
    for (let t = 0; t <= 4; t += 0.05) {
      expect(even.positionAt(t)).toBeCloseTo(10 + 30 * t, 9);
    }
  });

  it("holds the first note on the line until the music starts", () => {
    expect(line.positionAt(-3)).toBe(100);
  });

  it("carries the last note through the line at the speed it arrived", () => {
    const { before, after } = speeds(line, 9);
    expect(after / before).toBeCloseTo(1, 2);
    expect(line.positionAt(1000)).toBe(END);
  });

  it("does not care what order the points come in", () => {
    const shuffled = new Timeline([...UNEVEN].reverse(), END);
    for (let t = 0; t <= 9; t += 0.25) {
      expect(shuffled.positionAt(t)).toBeCloseTo(line.positionAt(t), 9);
    }
  });

  it("stands still rather than failing with too few points to move between", () => {
    expect(new Timeline([], 0).positionAt(2)).toBe(0);
    expect(new Timeline([{ t: 0, x: 40 }], 100).positionAt(2)).toBe(40);
  });
});
