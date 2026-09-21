// MIDI note numbers <-> scientific pitch names. Middle C is 60 and is "C4".
// Sharps only: this is for display and logging, not for notation, where the
// spelling depends on the key and comes from the MusicXML.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function midiToName(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new RangeError(`MIDI note out of range: ${midi}`);
  }
  const name = NAMES[midi % 12] ?? "?";
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function nameToMidi(name: string): number {
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!match) {
    throw new RangeError(`Not a pitch name: ${name}`);
  }
  const [, letter = "", accidental, octave = "0"] = match;
  const semitone = NAMES.indexOf(letter as (typeof NAMES)[number]);
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octave) + 1) * 12 + semitone + shift;
  if (midi < 0 || midi > 127) {
    throw new RangeError(`Pitch outside MIDI range: ${name}`);
  }
  return midi;
}
