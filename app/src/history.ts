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

import type { BarRecord } from "./judge";

export interface RunRecord {
  pack: string;
  song: string;
  level: number;
  /** When the run finished, as an ISO timestamp. */
  finished: string;
  mode: "tempo";
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
 * One line for the end of a run: how many notes were hit, and the bar with
 * the most notes missed or fumbled, which is the one to practise.
 */
export function summarise(bars: BarRecord[]): string {
  const notes = bars.reduce((sum, b) => sum + b.notes, 0);
  const hit = bars.reduce((sum, b) => sum + b.hit, 0);
  const trouble = (b: BarRecord) => b.missed + b.wrong;
  const worst = bars.reduce<BarRecord | undefined>(
    (w, b) => (w && trouble(w) >= trouble(b) ? w : b),
    undefined,
  );
  const found = `${hit} of ${notes} notes hit.`;
  return worst && trouble(worst) > 0 ? `${found} Bar ${worst.bar} is the one to practise.` : found;
}
