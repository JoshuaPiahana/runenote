// Standard MIDI Files, as time rather than as bytes.
//
// The band arrives as `backing.mid` because that is the format that also
// plays in everything else, which is how the arrangement gets checked by ear
// outside this app. What the app wants out of it is what music.ts wants out
// of MusicXML: this pitch, at this moment, for this long.
//
// The file's own tempo is deliberately not read. The playhead is the app's
// clock and it counts quarter notes; a tempo inside the file would be a
// second clock, and two clocks drift. The bundle states one tempo and
// everything uses it.

export interface BackingNote {
  midi: number;
  /** Quarter notes from the start of the piece. */
  start: number;
  /** Length in quarter notes. */
  duration: number;
  /** 1-127, as played. The mix scales it; it is not scaled here. */
  velocity: number;
  /** 0-15. Which role this is comes from the bundle, which names the channel. */
  channel: number;
  /** The General MIDI program in force on the channel when the note began,
      which is to say its instrument. Absent when the file never set one. */
  program?: number;
}

const MTHD = 0x4d546864;
const MTRK = 0x4d54726b;
const META = 0xff;
const SYSEX = 0xf0;
const SYSEX_ESCAPE = 0xf7;
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const PROGRAM = 0xc0;
const CHANNEL_PRESSURE = 0xd0;

class Reader {
  constructor(
    private readonly view: DataView,
    public at: number,
  ) {}

  u8(): number {
    return this.view.getUint8(this.at++);
  }

  u16(): number {
    const value = this.view.getUint16(this.at);
    this.at += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.at);
    this.at += 4;
    return value;
  }

  /** A variable-length quantity: seven bits a byte, high bit means more. */
  varint(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw new Error("malformed MIDI file: a length ran past four bytes");
  }

  skip(count: number): void {
    this.at += count;
  }
}

/**
 * Every note in a MIDI file, on one timeline, in quarter notes.
 *
 * Tracks are read onto that one timeline because that is what the file
 * means: a format 1 file is one piece of music written on several staves.
 */
export function parseMidiFile(data: ArrayBuffer | Uint8Array): BackingNote[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const file = new Reader(view, 0);

  if (bytes.byteLength < 14 || file.u32() !== MTHD) {
    throw new Error("not a MIDI file: it does not start with MThd");
  }
  const headerLength = file.u32();
  const format = file.u16();
  const trackCount = file.u16();
  const division = file.u16();
  if (format === 2) {
    // Format 2's tracks are separate pieces one after another, not staves of
    // one piece, so laying them on a single timeline would stack them.
    throw new Error("this MIDI file is format 2, whose tracks are separate pieces");
  }
  if ((division & 0x8000) !== 0 || division === 0) {
    throw new Error("this MIDI file is timed in SMPTE frames, not in beats");
  }
  // The standard says the header is six bytes and allows it to be longer.
  file.at = 8 + headerLength;

  const notes: BackingNote[] = [];
  // A channel's program belongs to the file, not to the track that set it:
  // some writers set every instrument from the first track.
  const programs = new Map<number, number>();
  for (let track = 0; track < trackCount; track++) {
    if (file.at + 8 > bytes.byteLength) {
      break;
    }
    if (file.u32() !== MTRK) {
      throw new Error(`malformed MIDI file: track ${track + 1} does not start with MTrk`);
    }
    const length = file.u32();
    readTrack(new Reader(view, file.at), file.at + length, division, notes, programs);
    file.at += length;
  }
  notes.sort((a, b) => a.start - b.start || a.channel - b.channel || a.midi - b.midi);
  return notes;
}

function readTrack(
  track: Reader,
  end: number,
  division: number,
  into: BackingNote[],
  programs: Map<number, number>,
): void {
  let ticks = 0;
  let status = 0;
  /** Notes waiting to be released, by channel and pitch. */
  const open = new Map<number, BackingNote>();

  while (track.at < end) {
    ticks += track.varint();
    const now = ticks / division;
    const byte = track.u8();
    if (byte < 0x80) {
      // Running status: a message with no status byte repeats the last one.
      // Its first data byte is the one just read, so give it back.
      track.at--;
    } else {
      status = byte;
    }

    if (status === META) {
      track.u8();
      track.skip(track.varint());
      status = 0;
      continue;
    }
    if (status === SYSEX || status === SYSEX_ESCAPE) {
      track.skip(track.varint());
      status = 0;
      continue;
    }

    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (kind === NOTE_ON || kind === NOTE_OFF) {
      const midi = track.u8();
      const velocity = track.u8();
      const key = (channel << 8) | midi;
      // Many writers send a note-off as a note-on of velocity zero.
      release(open, key, now, into);
      if (kind === NOTE_ON && velocity > 0) {
        const program = programs.get(channel);
        const held: BackingNote = { midi, start: now, duration: 0, velocity, channel };
        if (program !== undefined) {
          held.program = program;
        }
        open.set(key, held);
      }
    } else if (kind === PROGRAM) {
      programs.set(channel, track.u8());
    } else if (kind === CHANNEL_PRESSURE) {
      track.u8();
    } else {
      track.skip(2);
    }
  }

  // A note the file never released lasts to the end of its track rather than
  // being dropped: a missing note-off is a bad file, not a silent note.
  for (const key of [...open.keys()]) {
    release(open, key, ticks / division, into);
  }
}

function release(
  open: Map<number, BackingNote>,
  key: number,
  now: number,
  into: BackingNote[],
): void {
  const note = open.get(key);
  if (!note) {
    return;
  }
  note.duration = Math.max(now - note.start, 0);
  open.delete(key);
  into.push(note);
}
