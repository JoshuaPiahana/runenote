// Where the sheet is at a given moment. OSMD spaces notes for reading, not in
// proportion to time: a dotted figure, an accidental or a barline each take
// room the beat does not. So between two notes the sheet has to cover a
// distance that has nothing to do with how long the gap lasts, and the speed
// cannot be constant if every note is to cross the play line on its beat.
//
// It can be continuous, though. Joining the notes with straight lines, as this
// used to, gives a speed that steps at every note — measured on Ode to Joy, a
// 1.77x lurch into the dotted figure and a 0.51x brake out of it — and the eye
// reads a step as a stutter. A monotone cubic still passes through every note
// exactly, never runs backwards, and changes speed gradually instead.

/** A moment in the music and the pixel it was drawn at. */
export interface Point {
  /** Quarter notes from the start. */
  t: number;
  x: number;
}

export class Timeline {
  private readonly t: number[];
  private readonly x: number[];
  /** Pixels per quarter at each point: the curve's slope as it passes. */
  private readonly m: number[];
  private readonly end: number;

  /**
   * @param points one per moment something is written, in any order.
   * @param end the sheet's right edge, where scrolling stops.
   */
  constructor(points: readonly Point[], end: number) {
    const sorted = [...points].sort((a, b) => a.t - b.t);
    this.t = sorted.map((p) => p.t);
    this.x = sorted.map((p) => p.x);
    this.m = tangents(this.t, this.x);
    this.end = end;
  }

  /** Pixel x of a moment, in the rendered sheet's own coordinates. */
  positionAt(quarters: number): number {
    const { t, x, m } = this;
    const n = t.length;
    if (n < 2) {
      return x[0] ?? 0;
    }
    const first = t[0] as number;
    const last = t[n - 1] as number;
    if (quarters <= first) {
      return x[0] as number;
    }
    // Past the last onset the final note still has to travel through the play
    // line, so carry on at the speed the curve arrived with rather than
    // stopping on it, and stop at the edge of the sheet.
    if (quarters >= last) {
      const at = (x[n - 1] as number) + (m[n - 1] as number) * (quarters - last);
      return Math.max(Math.min(at, this.end), x[n - 1] as number);
    }
    let low = 0;
    let high = n - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if ((t[mid] as number) <= quarters) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const t0 = t[low] as number;
    const h = (t[high] as number) - t0;
    const s = (quarters - t0) / h;
    // Cubic Hermite: the two ends and the slopes at them fix the curve.
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * (x[low] as number) +
      (s3 - 2 * s2 + s) * h * (m[low] as number) +
      (-2 * s3 + 3 * s2) * (x[high] as number) +
      (s3 - s2) * h * (m[high] as number)
    );
  }
}

/**
 * The slope at each point, chosen so the curve never overshoots: a weighted
 * harmonic mean of the straight-line speeds either side (Fritsch & Butland,
 * 1984). A harmonic mean leans towards the slower side, which is what keeps
 * the curve between its neighbours, and it is zero if either side is still,
 * so a sheet that pauses does not creep backwards on the way in or out.
 */
function tangents(t: readonly number[], x: readonly number[]): number[] {
  const n = t.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k += 1) {
    h.push((t[k + 1] as number) - (t[k] as number));
    d.push(((x[k + 1] as number) - (x[k] as number)) / (h[k] as number));
  }
  const m: number[] = [];
  for (let k = 0; k < n; k += 1) {
    if (k === 0) {
      m.push(d[0] ?? 0);
    } else if (k === n - 1) {
      m.push(d[n - 2] ?? 0);
    } else {
      const d0 = d[k - 1] as number;
      const d1 = d[k] as number;
      const h0 = h[k - 1] as number;
      const h1 = h[k] as number;
      m.push(d0 * d1 <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1));
    }
  }
  return m;
}
