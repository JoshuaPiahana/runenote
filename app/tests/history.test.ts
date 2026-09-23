// The run history is the one thing the app writes that later modes read, so
// the rules are: a run is appended, never lost to a bad write, and the end of
// run line points at the bar that really held the player up.

import { describe, expect, it } from "vitest";
import { loadRuns, type RunRecord, saveRun, summarise } from "../src/history";
import type { BarRecord } from "../src/judge";

function bar(n: number, over: Partial<BarRecord> = {}): BarRecord {
  return { bar: n, notes: 4, hit: 4, missed: 0, wrong: 0, offsetsMs: [], ...over };
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
  mode: "tempo",
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
  it("counts notes hit across the run", () => {
    expect(summarise([bar(1), bar(2, { hit: 1, missed: 3 })])).toMatch(/^5 of 8 notes hit./);
  });

  it("points at the bar with the most missed and wrong notes together", () => {
    const bars = [bar(1, { missed: 2 }), bar(2, { missed: 1, wrong: 2 })];
    expect(summarise(bars)).toBe("8 of 8 notes hit. Bar 2 is the one to practise.");
  });

  it("names no bar when nothing went wrong", () => {
    expect(summarise([bar(1)])).toBe("4 of 4 notes hit.");
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
