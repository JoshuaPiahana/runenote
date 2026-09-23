// The count-in: two bars of the song's own band before the song.
//
// The player's start note is a trigger, not the song's first note. Playing
// it starts the band on its opening bar, twice over, and the music proper
// comes in after, so the tempo is in the player's ears before the first note
// is wanted (DECISIONS: "A song starts when the player plays its start note").
//
// It lives here in the app, not as a bar written into the bundle. A bar 0 in
// the score would renumber every bar after it, which breaks per-bar records
// and "bar 12 again", and would write a bar the composer did not.

import type { BackingNote } from "./smf";

/** How many bars the band plays before the song. */
export const COUNT_IN_BARS = 2;

/** Quarter notes in one bar of a time signature such as "3/4" or "6/8". */
export function barQuarters(timeSignature: string): number {
  const [beats, unit] = timeSignature.split("/").map(Number);
  return beats && unit ? (beats * 4) / unit : 4;
}

/**
 * The first bar that is a whole bar long, and where the count-in must end so
 * that bar's downbeat stays on the count's grid. Without a pickup that is
 * the start of the song. With one, the count-in ends a whole bar before the
 * first downbeat, and the pickup notes fall into the rest of that bar as
 * written.
 */
function anchor(bars: readonly number[], length: number): { first: number; end: number } {
  const whole = bars.findIndex((start, i) => {
    const next = bars[i + 1];
    return next === undefined || next - start >= length - 1e-6;
  });
  const first = bars[whole] ?? 0;
  return { first, end: first - Math.ceil(first / length - 1e-6) * length };
}

/** Where the playhead starts: this many quarters before the song, so negative. */
export function countInStart(
  bars: readonly number[],
  length: number,
  count = COUNT_IN_BARS,
): number {
  return anchor(bars, length).end - count * length;
}

/**
 * The band's first whole bar, played `count` times just before the song. Its
 * notes are cut at the barline so nothing rings on into the song itself.
 * Every note keeps its channel, so the band stands down from the same roles
 * in the count-in as in the song.
 */
export function countInNotes(
  backing: readonly BackingNote[],
  bars: readonly number[],
  length: number,
  count = COUNT_IN_BARS,
): BackingNote[] {
  const { first, end } = anchor(bars, length);
  const source = backing.filter((n) => n.start >= first - 1e-6 && n.start < first + length - 1e-6);
  const out: BackingNote[] = [];
  for (let k = 0; k < count; k += 1) {
    const shift = end - (count - k) * length - first;
    for (const note of source) {
      out.push({
        ...note,
        start: note.start + shift,
        duration: Math.min(note.duration, first + length - note.start),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Where the count-in's barlines are drawn: between its bars and at its end,
 * on the grid the band plays, so the line crosses a barline as the band turns
 * the bar. The start needs none: the clef stands there.
 */
export function countInBarlines(
  bars: readonly number[],
  length: number,
  count = COUNT_IN_BARS,
): number[] {
  const start = countInStart(bars, length, count);
  return Array.from({ length: count }, (_, k) => start + (k + 1) * length);
}
