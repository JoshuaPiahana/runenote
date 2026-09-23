// What the player has done, kept in the browser.
//
// One record per finished run, appended and never rewritten. The later modes
// read this (DECISIONS: "Per-bar accuracy is recorded from the first
// version"), so it stores what happened in each bar and leaves the grading
// to whoever reads it.
//
// The browser's storage is enough while the app runs on one machine for one
// family. It is also the easiest to lose, so nothing here is the only copy
// of anything the app cannot do without: a run that fails to save is a run
// not remembered, never an error in the player's face.

import type { BarRecord } from "./follow";

export interface RunRecord {
  pack: string;
  song: string;
  level: number;
  /** When the run finished, as an ISO timestamp. */
  finished: string;
  mode: "wait";
  bars: BarRecord[];
}

const KEY = "runenote.runs.v1";

export function loadRuns(storage: Storage | undefined = globalThis.localStorage): RunRecord[] {
  try {
    const raw = storage?.getItem(KEY);
    const runs: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(runs) ? (runs as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveRun(
  run: RunRecord,
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  try {
    storage?.setItem(KEY, JSON.stringify([...loadRuns(storage), run]));
    return storage !== undefined;
  } catch {
    return false;
  }
}

/**
 * One line for the end of a run: how many notes were found first time, and
 * the bar that held the player up longest, which is the one to practise.
 * Waiting is the measure rather than wrong notes because wait mode lets a
 * player who does not know a note simply stop, and a count of wrong notes
 * never sees that.
 */
export function summarise(bars: BarRecord[]): string {
  const notes = bars.reduce((sum, b) => sum + b.notes, 0);
  const clean = bars.reduce((sum, b) => sum + b.clean, 0);
  const slowest = bars.reduce<BarRecord | undefined>(
    (worst, b) => (worst && worst.longestWaitMs >= b.longestWaitMs ? worst : b),
    undefined,
  );
  const found = `${clean} of ${notes} notes first time.`;
  // Under a second at one note is reading, not being stuck. A guess at the
  // line, not measured: revisit once there are real runs to look at.
  return slowest && slowest.longestWaitMs >= 1000
    ? `${found} Bar ${slowest.bar} held you up most.`
    : found;
}
