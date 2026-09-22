// MusicXML, as time rather than as glyphs.
//
// The notation renderer wants shapes on staves; the note highway wants "this
// pitch, at this moment, for this long". Both read the same tier file, so this
// module turns the pipeline's MusicXML into timed notes and nothing else.
//
// It handles the subset the pipeline emits (one voice per part, chords,
// dotted notes) plus ties and backup/forward, which it does not emit yet but
// will: a tied note drawn as two blocks would tell a player to strike twice.

export type Hand = "right" | "left";

export interface TimedNote {
  midi: number;
  /** Quarter notes from the start of the piece. */
  start: number;
  /** Length in quarter notes. */
  duration: number;
  hand: Hand;
}

export interface Piece {
  /** Sorted by start, then pitch. */
  notes: TimedNote[];
  /** Start of each bar, in quarter notes. Read from the score, so a pickup bar is honest. */
  bars: number[];
  /** Length in quarter notes. */
  quarters: number;
}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The notes that sound at the very start, which are the ones the player has
 * to find before anything moves. A melody-only level has one; a two-hand
 * level has the chord under it too.
 */
export function firstOnset(piece: Piece): TimedNote[] {
  const first = piece.notes[0];
  return first ? piece.notes.filter((note) => note.start === first.start) : [];
}

/**
 * The one note to ask for by name. Playing any of the opening notes starts
 * the song, but naming four at once reads as an instruction to play a chord,
 * so the prompt asks for the tune: the top of the right hand where there is
 * one, and otherwise the top note there is.
 */
export function openingCue(onset: TimedNote[]): TimedNote | undefined {
  const highest = (notes: TimedNote[]) =>
    notes.reduce<TimedNote | undefined>(
      (best, note) => (best && best.midi >= note.midi ? best : note),
      undefined,
    );
  return highest(onset.filter((note) => note.hand === "right")) ?? highest(onset);
}

function text(parent: Element, tag: string): string | undefined {
  return parent.getElementsByTagName(tag)[0]?.textContent ?? undefined;
}

/** Direct children only: a <duration> inside <backup> is not this note's. */
function child(parent: Element, tag: string): Element | undefined {
  for (const node of parent.children) {
    if (node.tagName === tag) {
      return node;
    }
  }
  return undefined;
}

function number(parent: Element, tag: string): number | undefined {
  const raw = child(parent, tag)?.textContent;
  const value = raw === undefined || raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function pitchToMidi(pitch: Element): number | undefined {
  const step = text(pitch, "step");
  const octave = Number(text(pitch, "octave"));
  const semitone = step === undefined ? undefined : STEPS[step];
  if (semitone === undefined || !Number.isFinite(octave)) {
    return undefined;
  }
  const alter = Number(text(pitch, "alter") ?? 0);
  return (octave + 1) * 12 + semitone + (Number.isFinite(alter) ? alter : 0);
}

function tieKind(note: Element, kind: string): boolean {
  for (const tie of note.getElementsByTagName("tie")) {
    if (tie.getAttribute("type") === kind) {
      return true;
    }
  }
  return false;
}

/** Maps part ids to a hand using the part names the arranger writes. */
function handsByPartId(score: Document): Map<string, Hand> {
  const hands = new Map<string, Hand>();
  for (const part of score.getElementsByTagName("score-part")) {
    const id = part.getAttribute("id");
    if (id) {
      hands.set(id, /left/i.test(text(part, "part-name") ?? "") ? "left" : "right");
    }
  }
  return hands;
}

export function parseMusicXml(xml: string): Piece {
  const score = new DOMParser().parseFromString(xml, "application/xml");
  const failure = score.getElementsByTagName("parsererror")[0];
  if (failure) {
    throw new Error(`not valid MusicXML: ${failure.textContent ?? "unparseable"}`);
  }
  const hands = handsByPartId(score);
  const notes: TimedNote[] = [];
  const barStarts = new Set<number>();

  for (const part of score.getElementsByTagName("part")) {
    const hand = hands.get(part.getAttribute("id") ?? "") ?? "right";
    // Ticks per quarter note. Declared in the first measure and may change,
    // which is why the cursor counts quarters and each duration is converted
    // as it is read rather than at the end.
    let divisions = 1;
    let cursor = 0;
    let chordStart = 0;
    // Notes waiting for a tie to close, by pitch.
    const tied = new Map<number, TimedNote>();

    for (const measure of part.getElementsByTagName("measure")) {
      barStarts.add(cursor);
      const declared = Number(text(measure, "divisions"));
      if (Number.isFinite(declared) && declared > 0) {
        divisions = declared;
      }

      for (const element of measure.children) {
        const beats = (number(element, "duration") ?? 0) / divisions;
        if (element.tagName === "backup") {
          cursor -= beats;
          continue;
        }
        if (element.tagName === "forward") {
          cursor += beats;
          continue;
        }
        if (element.tagName !== "note") {
          continue;
        }

        // A chord note sounds with the one before it, so time does not move.
        const inChord = child(element, "chord") !== undefined;
        const start = inChord ? chordStart : cursor;
        if (!inChord) {
          chordStart = cursor;
          cursor += beats;
        }
        const pitch = child(element, "pitch");
        if (!pitch || child(element, "rest")) {
          continue;
        }
        const midi = pitchToMidi(pitch);
        if (midi === undefined) {
          continue;
        }

        if (tieKind(element, "stop")) {
          const held = tied.get(midi);
          if (held) {
            held.duration = start + beats - held.start;
            if (!tieKind(element, "start")) {
              tied.delete(midi);
            }
            continue;
          }
        }
        const note: TimedNote = { midi, start, duration: beats, hand };
        notes.push(note);
        if (tieKind(element, "start")) {
          tied.set(midi, note);
        }
      }
    }
  }

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return {
    notes,
    bars: [...barStarts].sort((a, b) => a - b),
    quarters: notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0),
  };
}
