// The band arrives as bytes, and a wrong byte is a wrong note nobody can see
// on the screen to check. So these tests cover the parts of the format that
// go wrong silently: variable-length times, running status, note-off written
// as a note-on, and the same pitch struck twice before it is released.
//
// The last test reads the committed band itself, which is the one that would
// notice the pipeline and the app disagreeing about the file between them.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type BackingNote, parseMidiFile } from "../src/smf";

const BACKING = resolve(process.cwd(), "../content/packs/core/ode-to-joy/backing.mid");
/** Ticks per quarter note in the files built here. */
const DIVISION = 96;

function bytes(...values: (number | number[])[]): number[] {
  return values.flat();
}

/** A variable-length quantity, the format's way of writing a delta time. */
function varint(value: number): number[] {
  const out = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
}

function file(...tracks: number[][]): Uint8Array {
  const header = bytes(
    [0x4d, 0x54, 0x68, 0x64],
    [0, 0, 0, 6],
    [0, 1],
    [0, tracks.length],
    [(DIVISION >> 8) & 0xff, DIVISION & 0xff],
  );
  const body = tracks.flatMap((events) => {
    const withEnd = bytes(events, varint(0), [0xff, 0x2f, 0x00]);
    const length = withEnd.length;
    return bytes(
      [0x4d, 0x54, 0x72, 0x6b],
      [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff],
      withEnd,
    );
  });
  return Uint8Array.from([...header, ...body]);
}

function shape(notes: BackingNote[]): [number, number, number, number][] {
  return notes.map((n) => [n.start, n.midi, n.duration, n.channel]);
}

describe("parseMidiFile", () => {
  it("reads times in quarter notes, whatever the file's ticks are", () => {
    const track = bytes(
      varint(0),
      [0x90, 60, 100],
      varint(DIVISION * 2),
      [0x80, 60, 0],
      varint(DIVISION),
      [0x90, 67, 100],
      varint(DIVISION / 2),
      [0x80, 67, 0],
    );
    expect(shape(parseMidiFile(file(track)))).toEqual([
      [0, 60, 2, 0],
      [3, 67, 0.5, 0],
    ]);
  });

  it("reads a delta time that needs more than one byte", () => {
    // 8 quarter notes at 96 ticks is 768, which does not fit in seven bits.
    const track = bytes(varint(0), [0x90, 60, 100], varint(DIVISION * 8), [0x80, 60, 0]);
    expect(parseMidiFile(file(track))[0]?.duration).toBe(8);
  });

  it("takes a note-on of velocity zero as the note-off it means", () => {
    const track = bytes(varint(0), [0x90, 60, 100], varint(DIVISION), [0x90, 60, 0]);
    expect(shape(parseMidiFile(file(track)))).toEqual([[0, 60, 1, 0]]);
  });

  it("follows running status, where a message repeats the last one's kind", () => {
    const track = bytes(
      varint(0),
      [0x90, 60, 100],
      varint(DIVISION),
      [60, 0], // note-on, implied
      varint(0),
      [64, 100],
      varint(DIVISION),
      [64, 0],
    );
    expect(shape(parseMidiFile(file(track)))).toEqual([
      [0, 60, 1, 0],
      [1, 64, 1, 0],
    ]);
  });

  it("treats a pitch struck again before it is released as two notes", () => {
    const track = bytes(
      varint(0),
      [0x90, 60, 100],
      varint(DIVISION),
      [0x90, 60, 100],
      varint(DIVISION),
      [0x80, 60, 0],
    );
    expect(shape(parseMidiFile(file(track)))).toEqual([
      [0, 60, 1, 0],
      [1, 60, 1, 0],
    ]);
  });

  it("puts every track on one timeline and keeps each one's channel", () => {
    const bass = bytes(varint(0), [0x90, 36, 100], varint(DIVISION), [0x80, 36, 0]);
    const drums = bytes(varint(0), [0x99, 42, 80], varint(DIVISION / 2), [0x89, 42, 0]);
    expect(shape(parseMidiFile(file(bass, drums)))).toEqual([
      [0, 36, 1, 0],
      [0, 42, 0.5, 9],
    ]);
  });

  it("steps over the messages it has no use for", () => {
    const track = bytes(
      varint(0),
      [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20], // a tempo it must ignore: see smf.ts
      varint(0),
      [0xc0, 33], // program change: one data byte, not two
      varint(0),
      [0xb0, 7, 100], // controller: two
      varint(0),
      [0x90, 60, 100],
      varint(DIVISION),
      [0x80, 60, 0],
    );
    expect(shape(parseMidiFile(file(track)))).toEqual([[0, 60, 1, 0]]);
  });

  it("gives each note the instrument its channel was set to, whichever track set it", () => {
    const setup = bytes(varint(0), [0xc0, 46], varint(0), [0xc1, 48]); // harp, strings
    const harp = bytes(varint(0), [0x90, 60, 100], varint(DIVISION), [0x80, 60, 0]);
    const strings = bytes(
      varint(0),
      [0x91, 64, 100],
      varint(DIVISION),
      [0x81, 64, 0],
      varint(0),
      [0xc1, 40], // a violin from here on
      varint(0),
      [0x91, 67, 100],
      varint(DIVISION),
      [0x81, 67, 0],
    );
    const unset = bytes(varint(0), [0x92, 72, 100], varint(DIVISION), [0x82, 72, 0]);
    const programs = parseMidiFile(file(setup, harp, strings, unset)).map((n) => [
      n.midi,
      n.program,
    ]);
    expect(programs).toEqual([
      [60, 46],
      [64, 48],
      [72, undefined],
      [67, 40],
    ]);
  });

  it("holds a note the file never released open until the track ends", () => {
    const track = bytes(varint(0), [0x90, 60, 100], varint(DIVISION * 2), [0xb0, 7, 100]);
    expect(parseMidiFile(file(track))[0]?.duration).toBe(2);
  });

  it("refuses a file it would have to guess about", () => {
    expect(() => parseMidiFile(Uint8Array.from([1, 2, 3, 4]))).toThrow(/not a MIDI file/);
    const smpte = file(bytes(varint(0), [0x90, 60, 100]));
    smpte[12] = 0xe8; // a negative division means SMPTE frames, not beats
    expect(() => parseMidiFile(smpte)).toThrow(/SMPTE/);
    const format2 = file(bytes(varint(0), [0x90, 60, 100]));
    format2[9] = 2;
    expect(() => parseMidiFile(format2)).toThrow(/format 2/);
  });
});

describe("the committed band", () => {
  const notes = parseMidiFile(readFileSync(BACKING));

  it("plays on the channels song.json says it does", () => {
    expect(new Set(notes.map((n) => n.channel))).toEqual(new Set([0, 1, 9]));
  });

  it("starts on the downbeat and has a bass note under the first chord", () => {
    expect(notes[0]?.start).toBe(0);
    const opening = notes.filter((n) => n.start === 0);
    expect(opening.some((n) => n.channel === 0)).toBe(true);
    expect(opening.some((n) => n.channel === 9)).toBe(true);
  });

  it("never plays a note of zero length", () => {
    expect(notes.every((n) => n.duration > 0)).toBe(true);
  });
});
