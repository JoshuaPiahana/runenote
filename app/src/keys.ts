// The computer keyboard standing in for the piano, until a MIDI cable exists.
//
// Deliberately crude: three rows read bottom to top as one chromatic run from
// the bottom of the tier's range. It is for trying the app out, not for
// practising, so it makes no attempt to imitate a piano's black-key geometry.

const ROWS = "zxcvbnm,./asdfghjkl;qwertyuiop";

export function standInNote(key: string, low: number): number | undefined {
  const index = ROWS.indexOf(key.toLowerCase());
  return index === -1 ? undefined : low + index;
}
