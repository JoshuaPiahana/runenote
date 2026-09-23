// The scheduler is the part of the sound that can be wrong without being
// obviously wrong: a note scheduled twice is a flam, a note scheduled late is
// a rushed beat, and a note still scheduled after a pause plays into the
// silence. All of those are quiet mistakes, so they are the tested ones.
//
// None of this touches Web Audio, which is why it can be tested at all.

import { describe, expect, it } from "vitest";
import { rolesCovered, Scheduler } from "../src/audio";
import type { BackingNote } from "../src/smf";

const BPM = 120;
/** At 120 bpm a quarter note is half a second. */
const QUARTER = 0.5;
const LOOKAHEAD = 0.25;

function note(start: number, midi = 60, duration = 1): BackingNote {
  return { midi, start, duration, velocity: 100, channel: 0 };
}

interface Sounded {
  midi: number;
  start: number;
  delay: number;
  length: number;
}

function scheduler(notes: BackingNote[]): { it: Scheduler; heard: Sounded[] } {
  const heard: Sounded[] = [];
  const made = new Scheduler(
    (played, delay, length) =>
      heard.push({ midi: played.midi, start: played.start, delay, length }),
    LOOKAHEAD,
  );
  made.load(notes);
  return { it: made, heard };
}

describe("Scheduler", () => {
  it("hands over what falls inside the look-ahead and nothing beyond it", () => {
    const { it: sched, heard } = scheduler([note(0), note(0.4), note(1)]);
    // The look-ahead is a quarter of a second, which at 120 is half a beat.
    sched.follow(0, BPM);
    expect(heard.map((h) => h.start)).toEqual([0, 0.4]);
  });

  it("hands each note over exactly once as the playhead runs", () => {
    const { it: sched, heard } = scheduler([note(0), note(1), note(2), note(3)]);
    for (let quarters = 0; quarters <= 4; quarters += 0.05) {
      sched.follow(quarters, BPM);
    }
    expect(heard.map((h) => h.start)).toEqual([0, 1, 2, 3]);
  });

  it("converts to seconds with the tempo it is given", () => {
    const { it: sched, heard } = scheduler([note(0.25, 60, 2)]);
    sched.follow(0, BPM);
    expect(heard[0]).toMatchObject({ delay: 0.25 * QUARTER, length: 2 * QUARTER });
    const faster = scheduler([note(0.25, 60, 2)]);
    faster.it.follow(0, BPM * 2);
    expect(faster.heard[0]?.delay).toBeCloseTo(0.25 * QUARTER * 0.5);
  });

  it("starts again from the top when the playhead goes back", () => {
    const { it: sched, heard } = scheduler([note(0), note(1)]);
    sched.follow(0, BPM);
    sched.follow(1, BPM);
    expect(heard).toHaveLength(2);
    sched.follow(0, BPM);
    expect(heard.map((h) => h.start)).toEqual([0, 1, 0]);
  });

  it("does not rush through the song when the playhead is dragged forward", () => {
    // A seek is not the music running on: everything between is skipped
    // rather than fired off at once.
    const { it: sched, heard } = scheduler([note(0), note(1), note(2), note(8)]);
    sched.follow(0, BPM);
    sched.follow(8, BPM);
    expect(heard.map((h) => h.start)).toEqual([0, 8]);
  });

  it("hands over nothing more once the playhead is held", () => {
    const { it: sched, heard } = scheduler([note(0), note(1)]);
    sched.follow(0, BPM);
    const before = heard.length;
    sched.hold();
    expect(heard).toHaveLength(before);
    // Resuming picks up from where the playhead is, not from where it had
    // scheduled to, so nothing is skipped over the pause.
    sched.follow(1, BPM);
    expect(heard.map((h) => h.start)).toEqual([0, 1]);
  });

  it("waits with the player: nothing on the unplayed note goes early, and it comes in with them", () => {
    const { it: sched, heard } = scheduler([note(0.9), note(1), note(1.1)]);
    // The playhead is held just short of the note the player has not found.
    sched.follow(0.8, BPM, 1);
    sched.follow(1, BPM, 1);
    sched.follow(1, BPM, 1);
    expect(heard.map((h) => h.start)).toEqual([0.9]);
    // Found: the band's note on that beat sounds now, with theirs.
    sched.follow(1, BPM, 2);
    expect(heard.map((h) => h.start)).toEqual([0.9, 1, 1.1]);
    expect(heard[1]?.delay).toBe(0);
    expect(heard[2]?.delay).toBeCloseTo(0.05);
  });

  it("plays a note that sits exactly on the playhead", () => {
    const { it: sched, heard } = scheduler([note(4)]);
    sched.follow(4, BPM);
    expect(heard.map((h) => h.delay)).toEqual([0]);
  });
});

describe("rolesCovered", () => {
  it("stands the band down from whatever the player's own hands have", () => {
    expect(rolesCovered(["melody"])).toEqual([]);
    expect(rolesCovered(["melody", "bass"])).toEqual(["bass"]);
    expect(rolesCovered(["melody", "bass", "harmony"])).toEqual(["bass", "keys"]);
  });

  it("never stands down the drums, which no level asks the player to play", () => {
    for (const layers of [["melody"], ["melody", "bass"], ["melody", "bass", "harmony"]]) {
      expect(rolesCovered(layers)).not.toContain("drums");
    }
  });
});
