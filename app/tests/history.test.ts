// The run history is the one thing the app writes that later modes read, so
// the rules are: a run is appended, never lost to a bad write, and the end of
// run line points at the bar that really held the player up.

import { describe, expect, it } from "vitest";
import type { BarRecord } from "../src/follow";
import { loadRuns, type RunRecord, saveRun, summarise } from "../src/history";

function bar(n: number, over: Partial<BarRecord> = {}): BarRecord {
  return { bar: n, notes: 4, clean: 4, wrong: 0, waitedMs: 0, longestWaitMs: 0, ...over };
}

/** The browser's storage, minus the browser. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const RUN: RunRecord = {
  pack: "core",
  song: "ode-to-joy",
  level: 1,
  finished: "2026-09-24T09:00:00.000Z",
  mode: "wait",
  bars: [bar(1)],
};

describe("run history", () => {
  it("appends runs rather than replacing them", () => {
    const storage = memory();
    saveRun(RUN, storage);
    saveRun({ ...RUN, level: 2 }, storage);
    expect(loadRuns(storage).map((r) => r.level)).toEqual([1, 2]);
  });

  it("reads garbage as no history instead of failing", () => {
    const storage = memory();
    storage.setItem("runenote.runs.v1", "{not json");
    expect(loadRuns(storage)).toEqual([]);
  });
});

describe("summarise", () => {
  it("counts notes found first time across the run", () => {
    expect(summarise([bar(1), bar(2, { clean: 1 })])).toBe("5 of 8 notes first time.");
  });

  it("names the bar with the longest single wait, not the most waiting in total", () => {
    const bars = [
      bar(1, { waitedMs: 3000, longestWaitMs: 800 }),
      bar(2, { waitedMs: 2500, longestWaitMs: 2500 }),
    ];
    expect(summarise(bars)).toBe("8 of 8 notes first time. Bar 2 held you up most.");
  });

  it("names no bar when nothing held the player up", () => {
    expect(summarise([bar(1, { longestWaitMs: 600 })])).toBe("4 of 4 notes first time.");
  });
});

describe("a failed save", () => {
  it("is reported, not thrown: the player never sees storage trouble", () => {
    const full = {
      ...memory(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveRun(RUN, full)).toBe(false);
  });
});
