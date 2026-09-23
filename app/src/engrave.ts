// The scrolling view's notation, drawn by us, with space in proportion to time.
//
// OSMD spaces notes for reading a page: a barline takes room the beat does
// not, and a short note gets a minimum width. On a page nobody minds. On a
// line moving past a play line at the music's speed it is a stutter, because
// the sheet has to cover those extra pixels in no extra time. Measured on Ode
// to Joy, 33 of 60 note-to-note stretches changed speed by more than a quarter.
//
// So here one beat is always the same width. Every note sits exactly at
// `origin + start * pxPerQuarter`, the barline tucks in just before the
// downbeat rather than pushing it along, and the scroll is a constant speed
// with nothing to smooth. Rhythm becomes visible for free: a half note is
// followed by twice the space of a quarter, which is what it means.
//
// It draws the subset the pipeline writes, plus the things any other song
// will need first: key signatures and accidentals. Rests are not drawn yet;
// a silence still shows, as empty space of the right length.

export type Hand = "right" | "left";

type Clef = { sign: "G" | "F" | "C"; line: number };

interface Staff {
  hand: Hand;
  clef: Clef;
}

export interface EngravedNote {
  staff: number;
  hand: Hand;
  /** Quarter notes from the start. */
  start: number;
  /** Length in quarter notes, as written (ties are not joined here). */
  duration: number;
  /** The key to press. */
  midi: number;
  /** Diatonic steps from C0: the line or space the note sits on. */
  step: number;
  /** Accidental to print, if the key and the bar do not already imply it. */
  accidental?: "sharp" | "flat" | "natural" | "double-sharp" | "double-flat";
  type: string;
  dots: number;
  /** MusicXML beam state for the first beam, when the file groups notes. */
  beam?: "begin" | "continue" | "end";
  stem?: "up" | "down";
  chord: boolean;
}

export interface Engraving {
  staves: Staff[];
  notes: EngravedNote[];
  /** Start of each bar, in quarter notes. */
  bars: number[];
  /** End of the last bar, in quarter notes. */
  end: number;
  fifths: number;
  time?: { beats: number; beatType: number };
}

const STEP_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
/** Semitones above C of each diatonic step. */
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL_BY_ALTER: Record<number, EngravedNote["accidental"]> = {
  [-2]: "double-flat",
  [-1]: "flat",
  0: "natural",
  1: "sharp",
  2: "double-sharp",
};
/** Order sharps are added to a key signature; flats are the reverse. */
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];

function child(parent: Element, tag: string): Element | undefined {
  for (const node of parent.children) {
    if (node.tagName === tag) {
      return node;
    }
  }
  return undefined;
}

function text(parent: Element | undefined, tag: string): string | undefined {
  return parent?.getElementsByTagName(tag)[0]?.textContent ?? undefined;
}

function num(parent: Element | undefined, tag: string): number | undefined {
  const raw = parent ? child(parent, tag)?.textContent : undefined;
  const value = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** How the key signature alters each step name: F -> 1 in G major. */
function keyAlters(fifths: number): Map<string, number> {
  const alters = new Map<string, number>();
  const order = fifths >= 0 ? SHARP_ORDER : [...SHARP_ORDER].reverse();
  for (const name of order.slice(0, Math.min(Math.abs(fifths), 7))) {
    alters.set(name, fifths >= 0 ? 1 : -1);
  }
  return alters;
}

export function readEngraving(xml: string): Engraving {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const failure = doc.getElementsByTagName("parsererror")[0];
  if (failure) {
    throw new Error(`not valid MusicXML: ${failure.textContent ?? "unparseable"}`);
  }
  const hands = new Map<string, Hand>();
  for (const part of doc.getElementsByTagName("score-part")) {
    const id = part.getAttribute("id");
    if (id) {
      hands.set(id, /left/i.test(text(part, "part-name") ?? "") ? "left" : "right");
    }
  }

  const staves: Staff[] = [];
  const notes: EngravedNote[] = [];
  const bars = new Set<number>();
  let end = 0;
  let fifths = 0;
  let time: Engraving["time"];

  for (const part of doc.getElementsByTagName("part")) {
    const hand = hands.get(part.getAttribute("id") ?? "") ?? "right";
    const staffIndex = staves.length;
    const staff: Staff = {
      hand,
      clef: { sign: hand === "left" ? "F" : "G", line: hand === "left" ? 4 : 2 },
    };
    staves.push(staff);
    let divisions = 1;
    let cursor = 0;
    let chordStart = 0;
    let key = keyAlters(0);

    for (const measure of part.getElementsByTagName("measure")) {
      bars.add(cursor);
      const attributes = child(measure, "attributes");
      const declared = num(attributes, "divisions");
      if (declared && declared > 0) {
        divisions = declared;
      }
      const keyElement = attributes && child(attributes, "key");
      if (keyElement) {
        fifths = num(keyElement, "fifths") ?? 0;
        key = keyAlters(fifths);
      }
      const timeElement = attributes && child(attributes, "time");
      if (timeElement && !time) {
        const beats = num(timeElement, "beats");
        const beatType = num(timeElement, "beat-type");
        if (beats && beatType) {
          time = { beats, beatType };
        }
      }
      const clefElement = attributes && child(attributes, "clef");
      if (clefElement && staffIndex === staves.length - 1) {
        const sign = text(clefElement, "sign");
        const line = Number(text(clefElement, "line"));
        if ((sign === "G" || sign === "F" || sign === "C") && Number.isFinite(line)) {
          staff.clef = { sign, line };
        }
      }
      // What each line or space has been altered to so far in this bar: an
      // accidental lasts to the barline, so a second F# in the bar is bare.
      const inBar = new Map<number, number>();
      const barStart = cursor;

      for (const element of measure.children) {
        const beats = (num(element, "duration") ?? 0) / divisions;
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
        const chord = child(element, "chord") !== undefined;
        const start = chord ? chordStart : cursor;
        if (!chord) {
          chordStart = cursor;
          cursor += beats;
        }
        const pitch = child(element, "pitch");
        if (!pitch || child(element, "rest")) {
          continue;
        }
        const name = text(pitch, "step") ?? "";
        const octave = Number(text(pitch, "octave"));
        const index = STEP_INDEX[name];
        if (index === undefined || !Number.isFinite(octave)) {
          continue;
        }
        const step = octave * 7 + index;
        const alter = Number(text(pitch, "alter") ?? 0) || 0;
        const implied = inBar.get(step) ?? key.get(name) ?? 0;
        // The file's own <accidental> wins (it may be a courtesy one);
        // otherwise print one exactly when the pitch differs from what the
        // key and the bar so far would make it.
        const written = text(element, "accidental");
        const accidental =
          (written && (written as EngravedNote["accidental"])) ||
          (alter !== implied ? ACCIDENTAL_BY_ALTER[alter] : undefined);
        inBar.set(step, alter);

        const beamElement = element.getElementsByTagName("beam")[0];
        const beamText = beamElement?.textContent ?? "";
        const stemText = text(element, "stem");
        notes.push({
          staff: staffIndex,
          hand,
          start,
          duration: beats,
          midi: (octave + 1) * 12 + (SEMITONES[index] ?? 0) + alter,
          step,
          accidental,
          type: text(element, "type") ?? "quarter",
          dots: element.getElementsByTagName("dot").length,
          beam:
            beamText === "begin" || beamText === "continue" || beamText === "end"
              ? beamText
              : undefined,
          stem: stemText === "up" || stemText === "down" ? stemText : undefined,
          chord,
        });
      }
      // A bar's length is its furthest point, whichever voice reached it.
      end = Math.max(end, cursor, barStart);
    }
  }

  notes.sort((a, b) => a.start - b.start || a.staff - b.staff || a.step - b.step);
  return { staves, notes, bars: [...bars].sort((a, b) => a - b), end, fifths, time };
}

// --- layout ------------------------------------------------------------------

/** Distance between two stave lines, in pixels. Everything scales from it. */
export const SPACE = 16;
const HEAD_RX = SPACE * 0.62;
const HEAD_RY = SPACE * 0.45;
const STEM = SPACE * 3.4;
/** Room above the top stave and below the bottom one for ledger lines. */
const MARGIN = SPACE * 5;
/** Between the two staves of a grand staff, clear of middle C's ledger line. */
const STAFF_GAP = SPACE * 7;
/** Narrowest a beat may be, however long the notes. */
const MIN_QUARTER = SPACE * 4;
/** The least room a note gets before the next begins: two heads' width. */
const MIN_NOTE_ROOM = HEAD_RX * 4.2;

export interface Layout {
  width: number;
  height: number;
  /** Where quarter 0 is drawn. */
  origin: number;
  pxPerQuarter: number;
  /** Every notehead drawn. Its index is the `data-i` on its head and hold-bar
      in the SVG, which is how feedback finds a note to light up. */
  heads: { x: number; y: number; note: EngravedNote }[];
  barlines: number[];
  svg: string;
  /**
   * SVG for a note the player pressed that is not written: a ring where that
   * pitch sits on the stave, at the moment given, with ledger lines if it
   * needs them. Drawn where it was played so the player sees how far off it
   * was ("one line too high"), not just that it was wrong. A hand says whose
   * stave it belongs on; without one, middle C and up goes on the treble.
   */
  wrongNote(quarters: number, midi: number, hand: Hand | undefined, colour: string): string;
}

export interface Ink {
  right: string;
  left: string;
  /** Clefs, barlines, stems of nobody's notes. */
  music: string;
  /** The stave lines themselves: quieter than the notes on them. */
  lines: string;
}

/** Diatonic step of the bottom stave line for a clef. */
function bottomLine(clef: Clef): number {
  const anchor = clef.sign === "G" ? 4 * 7 + 4 : clef.sign === "F" ? 3 * 7 + 3 : 4 * 7;
  return anchor - 2 * (clef.line - 1);
}

/** The width of one beat, chosen so the shortest note still has room. */
export function quarterWidth(engraving: Engraving): number {
  const shortest = engraving.notes.reduce(
    (min, n) => (n.duration > 0 ? Math.min(min, n.duration) : min),
    1,
  );
  return Math.max(MIN_QUARTER, Math.ceil(MIN_NOTE_ROOM / shortest));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const f = (n: number) => Math.round(n * 10) / 10;

/**
 * The count-in, drawn in front of bar 1 so the line has music under it from
 * the first beat instead of gliding over nothing. Its bars are empty but for
 * one small note at the very start: the song's opening note, which is what
 * the player plays to begin, so their hand is already where the song wants it.
 */
export interface Lead {
  /** Where the count-in starts, in quarters before the song: negative. */
  from: number;
  /** Barlines inside the count-in and at its end. */
  barlines: number[];
  /** The opening note to show small, found among the song's first notes. */
  cue?: { midi: number; hand: Hand };
}

/** The cue is a reminder of where to put the hand, not a note of the song. */
const CUE_SCALE = 0.7;

export function layout(engraving: Engraving, ink: Ink, lead?: Lead): Layout {
  const { staves, notes, bars, fifths, time } = engraving;
  const W = quarterWidth(engraving);
  const tops = staves.map((_, i) => MARGIN + i * (SPACE * 4 + STAFF_GAP));
  const height = (tops.at(-1) ?? MARGIN) + SPACE * 4 + MARGIN;
  const yOf = (staff: number, step: number) => {
    const s = staves[staff];
    const top = tops[staff] ?? MARGIN;
    return top + SPACE * 4 - ((step - (s ? bottomLine(s.clef) : 30)) * SPACE) / 2;
  };
  /** Ledger lines from the stave out to a note beyond it. */
  const ledgers = (staff: number, step: number, x: number, stroke: string): string[] => {
    const s = staves[staff];
    const bottom = s ? bottomLine(s.clef) : 30;
    const out: string[] = [];
    const line = (at: number) => {
      const ly = yOf(staff, at);
      out.push(
        `<line x1="${f(x - HEAD_RX * 1.6)}" x2="${f(x + HEAD_RX * 1.6)}" y1="${f(ly)}" y2="${f(ly)}" stroke="${stroke}" stroke-width="1.4"/>`,
      );
    };
    for (let at = bottom - 2; at >= step; at -= 2) {
      line(at);
    }
    for (let at = bottom + 10; at <= step; at += 2) {
      line(at);
    }
    return out;
  };

  const back: string[] = [];
  const mid: string[] = [];
  const front: string[] = [];

  // Header: clef, key, time. Drawn once at the start; the line moves on.
  const clefX = SPACE * 0.8;
  const keyX = clefX + SPACE * 3.6;
  const keyCount = Math.min(Math.abs(fifths), 7);
  const timeX = keyX + keyCount * SPACE * 1.1 + (keyCount ? SPACE * 0.6 : 0);
  const headerEnd = timeX + (time ? SPACE * 2.6 : 0);
  // Quarter 0 moves right by the count-in, so the count-in starts where the
  // song would have: just after the header.
  const origin = headerEnd + SPACE * 2.5 - (lead?.from ?? 0) * W;
  const endX = origin + engraving.end * W;
  const width = endX + SPACE * 3;

  staves.forEach((staff, i) => {
    const top = tops[i] ?? MARGIN;
    for (let line = 0; line < 5; line += 1) {
      back.push(
        `<line x1="0" x2="${f(endX)}" y1="${f(top + line * SPACE)}" y2="${f(top + line * SPACE)}" stroke="${ink.lines}" stroke-width="1.2"/>`,
      );
    }
    // Clef glyphs sit on their line: G's curl wraps the second line, F's dots
    // straddle the fourth.
    const clefGlyph =
      staff.clef.sign === "G" ? "\u{1D11E}" : staff.clef.sign === "F" ? "\u{1D122}" : "\u{1D121}";
    const clefLineY = top + SPACE * 4 - (staff.clef.line - 1) * SPACE;
    // Sizes and offsets fitted by eye to Segoe UI Symbol; another font may sit
    // differently, which is the price of not shipping a music font yet.
    const clefSize = staff.clef.sign === "G" ? SPACE * 6.6 : SPACE * 4.2;
    const clefBaseline =
      staff.clef.sign === "G" ? clefLineY + SPACE * 1.6 : clefLineY + SPACE * 1.02;
    front.push(
      `<text x="${f(clefX)}" y="${f(clefBaseline)}" font-size="${f(clefSize)}" fill="${ink.music}" font-family="'Segoe UI Symbol','Noto Music','Bravura',serif">${clefGlyph}</text>`,
    );
    // Key signature at the conventional heights, shifted by whole octaves so
    // the bass clef's sharps sit where a pianist expects them.
    const shift = Math.round((bottomLine(staff.clef) - 30) / 7) * 7;
    const sharps = [38, 35, 39, 36, 33, 37, 34];
    const flats = [34, 37, 33, 36, 32, 35, 31];
    for (let k = 0; k < keyCount; k += 1) {
      const step = (fifths > 0 ? sharps : flats)[k] ?? 34;
      const y = yOf(i, step + shift);
      front.push(
        `<text x="${f(keyX + k * SPACE * 1.1)}" y="${f(y + SPACE * 0.55)}" font-size="${f(SPACE * 2.2)}" fill="${ink.music}">${fifths > 0 ? "♯" : "♭"}</text>`,
      );
    }
    if (time) {
      for (const [value, y] of [
        [time.beats, top + SPACE * 1.85],
        [time.beatType, top + SPACE * 3.85],
      ] as const) {
        front.push(
          `<text x="${f(timeX + SPACE * 1.1)}" y="${f(y)}" text-anchor="middle" font-size="${f(SPACE * 2.3)}" font-weight="800" font-family="Georgia,serif" fill="${ink.music}">${value}</text>`,
        );
      }
    }
  });

  // Barlines tuck in just before the downbeat: a notehead on beat one sits
  // against the line, as it does in Duolingo, so the bar costs no time.
  const barlineX = (q: number) => origin + q * W - HEAD_RX - SPACE * 0.45;
  const top0 = tops[0] ?? MARGIN;
  const bottomN = (tops.at(-1) ?? MARGIN) + SPACE * 4;
  const barlines: number[] = [];
  bars.forEach((q, index) => {
    if (q > 0) {
      const x = barlineX(q);
      barlines.push(x);
      back.push(
        `<line x1="${f(x)}" x2="${f(x)}" y1="${f(top0)}" y2="${f(bottomN)}" stroke="${ink.music}" stroke-width="1.4"/>`,
      );
    }
    // Bar numbers over the top stave, so "bar 12 again" can be found.
    back.push(
      `<text x="${f(q > 0 ? barlineX(q) : origin - HEAD_RX)}" y="${f(top0 - SPACE * 1.2)}" font-size="${f(SPACE * 1.1)}" fill="${ink.lines}" font-family="system-ui,sans-serif">${index + 1}</text>`,
    );
  });
  // Closing double bar, at the end of the last bar rather than the last note.
  const closeX = endX - SPACE * 0.4;
  back.push(
    `<line x1="${f(closeX - SPACE * 0.6)}" x2="${f(closeX - SPACE * 0.6)}" y1="${f(top0)}" y2="${f(bottomN)}" stroke="${ink.music}" stroke-width="1.2"/>`,
    `<rect x="${f(closeX - 2)}" y="${f(top0)}" width="4" height="${f(bottomN - top0)}" fill="${ink.music}"/>`,
  );
  // A grand staff is one instrument: its barlines join the staves, and a
  // brace would too; the brace is left to the traditional view.

  // The count-in's bars carry no numbers: bar 1 is still the song's first.
  for (const q of lead?.barlines ?? []) {
    const x = barlineX(q);
    barlines.push(x);
    back.push(
      `<line x1="${f(x)}" x2="${f(x)}" y1="${f(top0)}" y2="${f(bottomN)}" stroke="${ink.music}" stroke-width="1.4"/>`,
    );
  }
  const opening = notes[0]?.start;
  const cue =
    lead?.cue &&
    notes.find(
      (n) => n.start === opening && n.midi === lead.cue?.midi && n.hand === lead.cue?.hand,
    );
  if (lead && cue) {
    const x = origin + lead.from * W;
    const y = yOf(cue.staff, cue.step);
    const colour = cue.hand === "left" ? ink.left : ink.right;
    mid.push(...ledgers(cue.staff, cue.step, x, ink.music));
    front.push(
      `<ellipse class="cue" cx="${f(x)}" cy="${f(y)}" rx="${f(HEAD_RX * CUE_SCALE)}" ry="${f(HEAD_RY * CUE_SCALE)}" transform="rotate(-20 ${f(x)} ${f(y)})" fill="${colour}"/>`,
    );
    if (cue.accidental) {
      const glyph = {
        sharp: "♯",
        flat: "♭",
        natural: "♮",
        "double-sharp": "𝄪",
        "double-flat": "𝄫",
      }[cue.accidental];
      front.push(
        `<text x="${f(x - HEAD_RX * CUE_SCALE - SPACE * 0.3)}" y="${f(y + SPACE * 0.4)}" text-anchor="end" font-size="${f(SPACE * 2 * CUE_SCALE)}" fill="${colour}">${esc(glyph)}</text>`,
      );
    }
  }

  // Notes, one chord (same staff, same moment) at a time.
  const heads: Layout["heads"] = [];
  const colourOf = (hand: Hand) => (hand === "left" ? ink.left : ink.right);
  const groups = new Map<string, EngravedNote[]>();
  for (const note of notes) {
    const key = `${note.staff}@${note.start}`;
    const group = groups.get(key);
    if (group) {
      group.push(note);
    } else {
      groups.set(key, [note]);
    }
  }

  type Stem = {
    x: number;
    tipY: number;
    up: boolean;
    colour: string;
    beam?: EngravedNote["beam"];
    flags: number;
    staff: number;
  };
  const stems: Stem[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const staff = staves[first.staff];
    const bottom = staff ? bottomLine(staff.clef) : 30;
    const middle = bottom + 4;
    const x = origin + first.start * W;
    const colour = colourOf(first.hand);
    const ascending = [...group].sort((a, b) => a.step - b.step);
    const low = ascending[0] ?? first;
    const high = ascending.at(-1) ?? first;
    // The note furthest from the middle line decides, as engravers do; a
    // written <stem> overrides.
    const up = first.stem ? first.stem === "up" : middle - low.step >= high.step - middle;

    // Duration bars behind the heads: the note held, drawn as its length.
    // Heads are pushed below in this same order, so the indexes agree.
    group.forEach((note, k) => {
      const y = yOf(note.staff, note.step);
      const length = Math.max(note.duration * W - HEAD_RX * 0.8, HEAD_RX);
      back.push(
        `<rect data-i="${heads.length + k}" x="${f(x)}" y="${f(y - SPACE * 0.32)}" width="${f(length)}" height="${f(SPACE * 0.64)}" rx="${f(SPACE * 0.32)}" fill="${colour}" opacity="0.26"/>`,
      );
    });

    // Seconds in a chord cannot share a column: the upper one of each pair
    // goes the other side of the stem.
    const displaced = new Set<EngravedNote>();
    const walk = up ? ascending : [...ascending].reverse();
    walk.forEach((note, k) => {
      const previous = walk[k - 1];
      if (previous && Math.abs(note.step - previous.step) === 1 && !displaced.has(previous)) {
        displaced.add(note);
      }
    });

    for (const note of group) {
      const y = yOf(note.staff, note.step);
      const hx = displaced.has(note) ? x + (up ? 1 : -1) * (HEAD_RX * 2 - 1.5) : x;
      heads.push({ x: hx, y, note });
      mid.push(...ledgers(note.staff, note.step, hx, ink.music));
      const hollow = note.type === "half" || note.type === "whole" || note.type === "breve";
      front.push(
        `<ellipse data-i="${heads.length - 1}" cx="${f(hx)}" cy="${f(y)}" rx="${f(HEAD_RX)}" ry="${f(HEAD_RY)}" transform="rotate(-20 ${f(hx)} ${f(y)})" ${
          hollow
            ? `fill="none" stroke="${colour}" stroke-width="${f(SPACE * 0.24)}"`
            : `fill="${colour}"`
        }/>`,
      );
      if (note.accidental) {
        const glyph = {
          sharp: "♯",
          flat: "♭",
          natural: "♮",
          "double-sharp": "𝄪",
          "double-flat": "𝄫",
        }[note.accidental];
        front.push(
          `<text x="${f(hx - HEAD_RX - SPACE * 0.35)}" y="${f(y + SPACE * 0.55)}" text-anchor="end" font-size="${f(SPACE * 2)}" fill="${colour}">${esc(glyph)}</text>`,
        );
      }
      // A dot on a line moves up into the space, so it is not lost in the line.
      const onLine = (note.step - bottom) % 2 === 0;
      for (let d = 0; d < note.dots; d += 1) {
        front.push(
          `<circle cx="${f(hx + HEAD_RX + SPACE * (0.55 + d * 0.5))}" cy="${f(onLine ? y - SPACE / 2 : y)}" r="${f(SPACE * 0.17)}" fill="${colour}"/>`,
        );
      }
    }

    if (first.type !== "whole" && first.type !== "breve") {
      const stemX = up ? x + HEAD_RX - 0.8 : x - HEAD_RX + 0.8;
      const fromY = yOf(first.staff, up ? low.step : high.step);
      const endY = yOf(first.staff, up ? high.step : low.step) + (up ? -STEM : STEM);
      // Stems reach the middle line at least, so ledger notes still point home.
      const middleY = yOf(first.staff, middle);
      const tipY = up ? Math.min(endY, middleY) : Math.max(endY, middleY);
      front.push(
        `<line x1="${f(stemX)}" x2="${f(stemX)}" y1="${f(fromY)}" y2="${f(tipY)}" stroke="${colour}" stroke-width="1.3"/>`,
      );
      const flags = { eighth: 1, "16th": 2, "32nd": 3 }[first.type] ?? 0;
      stems.push({ x: stemX, tipY, up, colour, beam: first.beam, flags, staff: first.staff });
    }
  }

  // Beams join the groups the file marks; anything short and unbeamed gets
  // flags. Beams are flat for now, at the stem tip furthest from the heads.
  let open: Stem[] = [];
  const drawBeam = (group: Stem[]) => {
    const firstStem = group[0];
    const lastStem = group.at(-1);
    if (!firstStem || !lastStem || group.length < 2) {
      for (const s of group) {
        drawFlags(s);
      }
      return;
    }
    const up = firstStem.up;
    const y = up ? Math.min(...group.map((s) => s.tipY)) : Math.max(...group.map((s) => s.tipY));
    for (const s of group) {
      front.push(
        `<line x1="${f(s.x)}" x2="${f(s.x)}" y1="${f(s.tipY)}" y2="${f(y)}" stroke="${s.colour}" stroke-width="1.3"/>`,
      );
    }
    const levels = Math.max(1, Math.min(...group.map((s) => s.flags)));
    for (let level = 0; level < levels; level += 1) {
      const by = y + (up ? 1 : -1) * level * SPACE * 0.75;
      front.push(
        `<rect x="${f(firstStem.x - 0.6)}" y="${f(up ? by : by - SPACE * 0.45)}" width="${f(lastStem.x - firstStem.x + 1.2)}" height="${f(SPACE * 0.45)}" fill="${firstStem.colour}"/>`,
      );
    }
  };
  const drawFlags = (s: Stem) => {
    for (let k = 0; k < s.flags; k += 1) {
      const y0 = s.tipY + (s.up ? 1 : -1) * k * SPACE * 0.8;
      const dir = s.up ? 1 : -1;
      front.push(
        `<path d="M${f(s.x)} ${f(y0)} c ${f(SPACE * 0.2)} ${f(dir * SPACE * 0.9)} ${f(SPACE * 1.3)} ${f(dir * SPACE * 1.1)} ${f(SPACE * 0.9)} ${f(dir * SPACE * 2.4)}" fill="none" stroke="${s.colour}" stroke-width="${f(SPACE * 0.22)}" stroke-linecap="round"/>`,
      );
    }
  };
  for (const s of stems.sort((a, b) => a.staff - b.staff || a.x - b.x)) {
    if (s.beam === "begin" || (s.beam === "continue" && open.length)) {
      open.push(s);
    } else if (s.beam === "end" && open.length) {
      open.push(s);
      drawBeam(open);
      open = [];
    } else {
      if (open.length) {
        drawBeam(open);
        open = [];
      }
      drawFlags(s);
    }
  }
  if (open.length) {
    drawBeam(open);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${f(height)}" viewBox="0 0 ${f(width)} ${f(height)}">${back.join("")}${mid.join("")}${front.join("")}</svg>`;
  const wrongNote: Layout["wrongNote"] = (quarters, midi, hand, colour) => {
    const byHand = (h: Hand) => staves.findIndex((s) => s.hand === h);
    const guess = byHand(midi >= 60 ? "right" : "left");
    const own = hand === undefined ? -1 : byHand(hand);
    const staff = own !== -1 ? own : guess !== -1 ? guess : 0;
    // A black key is spelled the way the key signature leans: F# in a sharp
    // key, Gb in a flat one. The ring sits on that line or space.
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    let index = SEMITONES.indexOf(pc);
    let sign = "";
    if (index === -1) {
      index = fifths < 0 ? SEMITONES.indexOf(pc + 1) : SEMITONES.indexOf(pc - 1);
      sign = fifths < 0 ? "♭" : "♯";
    }
    const step = octave * 7 + index;
    const x = origin + quarters * W;
    const y = yOf(staff, step);
    return [
      ...ledgers(staff, step, x, colour),
      `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(HEAD_RX)}" ry="${f(HEAD_RY)}" transform="rotate(-20 ${f(x)} ${f(y)})" fill="none" stroke="${colour}" stroke-width="${f(SPACE * 0.2)}"/>`,
      sign
        ? `<text x="${f(x - HEAD_RX - SPACE * 0.35)}" y="${f(y + SPACE * 0.55)}" text-anchor="end" font-size="${f(SPACE * 2)}" fill="${colour}">${sign}</text>`
        : "",
    ].join("");
  };

  return { width, height, origin, pxPerQuarter: W, heads, barlines, svg, wrongNote };
}
