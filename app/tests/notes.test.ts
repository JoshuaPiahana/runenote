import { describe, expect, it } from "vitest";
import { midiToName, nameToMidi } from "../src/notes";

describe("midiToName", () => {
  it("calls middle C 'C4', the convention notation software uses", () => {
    expect(midiToName(60)).toBe("C4");
  });

  it("puts A440 at 69", () => {
    expect(midiToName(69)).toBe("A4");
  });

  it("spans the whole MIDI range", () => {
    expect(midiToName(0)).toBe("C-1");
    expect(midiToName(127)).toBe("G9");
  });

  it("rejects anything that is not a MIDI note", () => {
    expect(() => midiToName(128)).toThrow(RangeError);
    expect(() => midiToName(-1)).toThrow(RangeError);
    expect(() => midiToName(60.5)).toThrow(RangeError);
  });
});

describe("nameToMidi", () => {
  it("round-trips every note", () => {
    for (let midi = 0; midi <= 127; midi += 1) {
      expect(nameToMidi(midiToName(midi))).toBe(midi);
    }
  });

  it("accepts flats as the enharmonic sharp", () => {
    expect(nameToMidi("Bb3")).toBe(nameToMidi("A#3"));
    expect(nameToMidi("Cb4")).toBe(nameToMidi("B3"));
  });

  it("rejects things that are not pitch names", () => {
    expect(() => nameToMidi("H4")).toThrow(RangeError);
    expect(() => nameToMidi("C")).toThrow(RangeError);
  });
});
