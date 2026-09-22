// What the band does to Web Audio, against a stand-in for it.
//
// The scheduler's tests cover what should sound and when; these cover the
// step after, where a note becomes nodes. They exist because that step fails
// quietly: a role the bundle never named, or a channel nothing maps to, ends
// in an early return and a silent app, which looks exactly like an app whose
// volume is down.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Band } from "../src/audio";
import type { BackingTrack } from "../src/bundle";
import type { BackingNote } from "../src/smf";

const TRACKS: BackingTrack[] = [
  { role: "bass", channel: 0 },
  { role: "keys", channel: 1 },
  { role: "drums", channel: 9 },
];

function note(channel: number, midi: number, start = 0): BackingNote {
  return { midi, start, duration: 1, velocity: 100, channel };
}

/** Just enough Web Audio to record what was asked for. */
class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  oscillators: { type: string; frequency: { value: number }; started: number }[] = [];
  buffers: { started: number }[] = [];
  resume = vi.fn(async () => undefined);

  private param() {
    return {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    };
  }

  private node<T extends object>(extra: T) {
    return { connect: vi.fn((to: unknown) => to), disconnect: vi.fn(), ...extra };
  }

  createGain() {
    return this.node({ gain: this.param() });
  }

  createBiquadFilter() {
    return this.node({ type: "", frequency: this.param(), Q: this.param() });
  }

  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }

  createOscillator() {
    const record = { type: "", frequency: this.param(), started: -1 };
    this.oscillators.push(record);
    return this.node({
      ...record,
      start: vi.fn((at: number) => {
        record.started = at;
      }),
      stop: vi.fn(),
      set onended(_: unknown) {},
    });
  }

  createBufferSource() {
    const record = { started: -1 };
    this.buffers.push(record);
    return this.node({
      buffer: null,
      loop: false,
      start: vi.fn((at: number) => {
        record.started = at;
      }),
      stop: vi.fn(),
      set onended(_: unknown) {},
    });
  }

  get destination() {
    return {};
  }
}

let context: FakeContext;

beforeEach(() => {
  context = new FakeContext();
  vi.stubGlobal(
    "AudioContext",
    vi.fn(() => context),
  );
});

function playing(notes: BackingNote[], tracks = TRACKS): Band {
  const band = new Band();
  band.wake();
  band.load(notes, tracks);
  return band;
}

describe("Band", () => {
  it("sounds a pitched role as a tone at the note's own frequency", () => {
    const band = playing([note(0, 69)]);
    band.follow(0, 120);
    // A4 is 440Hz, which is the one frequency worth writing down.
    expect(context.oscillators.map((o) => o.frequency.value)).toEqual([440]);
    expect(context.buffers).toHaveLength(0);
  });

  it("sounds a drum from noise, not from a pitch", () => {
    const band = playing([note(9, 42)]); // closed hi-hat
    band.follow(0, 120);
    expect(context.buffers).toHaveLength(1);
    expect(context.oscillators).toHaveLength(0);
  });

  it("gives the kick a pitch, because the drop in it is what reads as a kick", () => {
    const band = playing([note(9, 36)]);
    band.follow(0, 120);
    expect(context.oscillators).toHaveLength(1);
  });

  it("says nothing for a role the player's own level has taken over", () => {
    const band = playing([note(0, 48), note(1, 60)]);
    band.standDown(["bass"]);
    band.follow(0, 120);
    expect(context.oscillators.map((o) => o.frequency.value)).toEqual([
      440 * 2 ** ((60 - 69) / 12),
    ]);
  });

  it("says nothing for a channel the bundle never named", () => {
    const band = playing([note(5, 60)]);
    band.follow(0, 120);
    expect(context.oscillators).toHaveLength(0);
  });

  it("places a note ahead of the playhead at its own moment on the audio clock", () => {
    context.currentTime = 10;
    const band = playing([note(0, 48, 0.2)]);
    band.follow(0, 120);
    // A fifth of a quarter note at 120bpm is a tenth of a second.
    expect(context.oscillators[0]?.started).toBeCloseTo(10.1);
  });

  it("makes no sound at all before the audio clock has been started", () => {
    const band = new Band();
    band.load([note(0, 48)], TRACKS);
    band.follow(0, 120);
    expect(context.oscillators).toHaveLength(0);
  });
});
