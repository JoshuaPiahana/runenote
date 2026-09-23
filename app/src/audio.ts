// The band, made audible.
//
// The playhead is the clock, and it is not wall-clock time: it stops at a
// pause, jumps back when a run restarts, and in wait mode it will stop dead
// until the player finds the next note. So the backing cannot be started and
// left to run. It has to be scheduled *from* the playhead, a fraction of a
// second at a time.
//
// That is the usual two-clocks arrangement. The animation frame, which is
// already running, works out what falls in the next slice of playhead time;
// the audio clock, which is accurate to the sample, is told exactly when to
// sound each note. Timers are far too coarse to place a note on a beat, and
// the frame is far too jittery, but neither has to be: they only decide
// *what*, and the audio clock decides *when*.
//
// The look-ahead is deliberately short, because everything handed over is
// going to be heard. A generous one would keep the band playing for a moment
// after the player stopped, which in wait mode is exactly the wrong moment.

import type { BackingTrack, Role } from "./bundle";
import type { BackingNote } from "./smf";

/** How far ahead of the playhead notes are handed to the audio clock. */
const LOOKAHEAD_SECONDS = 0.12;
/** A playhead that moves further than this in one frame has jumped, not run. */
const JUMP_QUARTERS = 1;

/** Handed each note to sound, with when and how long, both in seconds. */
export type Play = (note: BackingNote, delay: number, length: number) => void;

/**
 * Decides what to sound and when. Knows nothing about Web Audio, which is
 * the point: the part that is easy to get wrong is the part that can be
 * tested without a sound card.
 */
export class Scheduler {
  private notes: BackingNote[] = [];
  private cursor = 0;
  /** Where the playhead was last seen, or NaN when it is not running. */
  private at = Number.NaN;
  /** Quarter notes already handed over. */
  private upTo = 0;

  constructor(
    private readonly play: Play,
    private readonly lookahead = LOOKAHEAD_SECONDS,
  ) {}

  load(notes: BackingNote[]): void {
    this.notes = [...notes].sort((a, b) => a.start - b.start);
    this.hold();
  }

  /** The playhead is not running: nothing more is handed over until it is. */
  hold(): void {
    this.at = Number.NaN;
  }

  /**
   * Call once a frame while the playhead is moving. Nothing at or after
   * `until` is handed over: in wait mode that is the note the player has not
   * found yet, and the band comes in with them, not ahead of them.
   */
  follow(quarters: number, bpm: number, until = Number.POSITIVE_INFINITY): void {
    const secondsPerQuarter = 60 / Math.max(bpm, 1);
    // A playhead that went backwards, or forwards further than a beat in one
    // frame, is a restart or a seek rather than the music running on, so what
    // was already scheduled no longer applies.
    if (!Number.isFinite(this.at) || quarters < this.at || quarters > this.at + JUMP_QUARTERS) {
      this.rewind(quarters);
    }
    this.at = quarters;

    const horizon = Math.min(quarters + this.lookahead / secondsPerQuarter, until);
    const from = Math.max(this.upTo, quarters);
    while (this.cursor < this.notes.length) {
      const note = this.notes[this.cursor];
      if (!note || note.start >= horizon) {
        break;
      }
      this.cursor++;
      if (note.start < from) {
        continue;
      }
      this.play(
        note,
        (note.start - quarters) * secondsPerQuarter,
        note.duration * secondsPerQuarter,
      );
    }
    this.upTo = horizon;
  }

  private rewind(quarters: number): void {
    this.upTo = quarters;
    this.cursor = this.notes.findIndex((note) => note.start >= quarters);
    if (this.cursor === -1) {
      this.cursor = this.notes.length;
    }
  }
}

/**
 * Which of the band's roles a level's own layers take over. The player always
 * has the melody and the band never plays it, so these two are the only
 * places the two can collide.
 */
export function rolesCovered(layers: readonly string[]): Role[] {
  const covers: Record<string, Role> = { bass: "bass", harmony: "keys" };
  return layers.flatMap((layer) => {
    const role = covers[layer];
    return role ? [role] : [];
  });
}

// --- the voices -----------------------------------------------------------
// Synthesised rather than sampled. A sampled band would sound better and
// would be tens of megabytes of someone else's recordings, which is a licence
// question this repository exists to avoid having. When a sampled kit earns
// its place it belongs in a content pack, as an asset with a licence, not in
// the code. The levels below were set by eye against the velocities the style
// table writes, and want a pass by ear.

const LEVEL: Record<Role, number> = { bass: 0.5, keys: 0.22, drums: 0.3 };
/** The player's own notes, for a keyboard that makes no sound of its own. */
const PLAYER_LEVEL = 0.5;
/** General MIDI percussion. Anything else the table grows gets the tick. */
const KICK = 36;
const SNARE = 38;

interface Voice {
  source: AudioScheduledSourceNode;
  gain: GainNode;
}

export class Band {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private voices: Voice[] = [];
  private roles = new Map<number, Role>();
  private standingDown = new Set<Role>();
  private readonly scheduler = new Scheduler((note, delay, length) =>
    this.sound(note, delay, length),
  );

  /**
   * Start or resume the audio clock. Browsers only allow this from a real
   * user gesture, and a MIDI note is not one — but choosing a level is, and
   * that always happens first, so by the time the band is wanted the context
   * is awake.
   */
  wake(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.noise = whiteNoise(this.ctx);
    }
    void this.ctx.resume();
  }

  load(notes: BackingNote[], tracks: readonly BackingTrack[]): void {
    this.roles = new Map(tracks.map((track) => [track.channel, track.role]));
    this.scheduler.load(notes);
  }

  /** The roles the player's own hands cover; the band leaves those to them. */
  standDown(roles: readonly Role[]): void {
    this.standingDown = new Set(roles);
  }

  follow(quarters: number, bpm: number, until?: number): void {
    this.scheduler.follow(quarters, bpm, until);
  }

  /** The playhead has stopped, so the band stops with it. */
  hold(): void {
    this.scheduler.hold();
    this.silence();
  }

  /**
   * Sound a note the player just played. For a keyboard with no speakers of
   * its own; a digital piano already does this, and hearing the same note
   * twice a few milliseconds apart is worse than not hearing the app at all.
   *
   * It decays on its own rather than waiting for the key to come up, which
   * is what an undamped piano string does anyway.
   */
  pluck(midi: number, velocity = 90): void {
    this.tone(
      "keys",
      midi,
      (this.ctx?.currentTime ?? 0) + 0.001,
      1.4,
      (PLAYER_LEVEL * velocity) / 127,
    );
  }

  private sound(note: BackingNote, delay: number, length: number): void {
    const ctx = this.ctx;
    const role = this.roles.get(note.channel);
    if (!ctx || !role || this.standingDown.has(role)) {
      return;
    }
    const at = ctx.currentTime + Math.max(delay, 0);
    const level = (note.velocity / 127) * LEVEL[role];
    if (role === "drums") {
      this.hit(note.midi, at, level);
    } else {
      this.tone(role, note.midi, at, Math.max(length, 0.08), level);
    }
  }

  private tone(role: Role, midi: number, at: number, length: number, level: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || level <= 0) {
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = role === "bass" ? "triangle" : "sawtooth";
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = role === "bass" ? 600 : 2400;
    filter.Q.value = 0.7;
    const env = ctx.createGain();
    // Struck or plucked, not blown: no attack to speak of, then a decay that
    // carries on under the held note. A sustained pad behind a beginner's
    // playing masks their timing; something that decays does not.
    const peak = at + 0.006;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(level, peak);
    env.gain.exponentialRampToValueAtTime(level * 0.3, peak + 0.2);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.15);
    osc.connect(filter).connect(env).connect(master);
    osc.start(at);
    osc.stop(at + length + 0.25);
    this.keep(osc, env);
  }

  private hit(drum: number, at: number, level: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) {
      return;
    }
    if (drum === KICK) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      // The drop in pitch is most of what makes a kick read as a kick.
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.09);
      const env = ctx.createGain();
      env.gain.setValueAtTime(level * 1.4, at);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      osc.connect(env).connect(master);
      osc.start(at);
      osc.stop(at + 0.3);
      this.keep(osc, env);
      return;
    }
    const snare = drum === SNARE;
    const source = ctx.createBufferSource();
    source.buffer = this.noise ?? null;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = snare ? "bandpass" : "highpass";
    filter.frequency.value = snare ? 1900 : 7500;
    filter.Q.value = snare ? 0.8 : 0.7;
    const env = ctx.createGain();
    const length = snare ? 0.16 : 0.05;
    env.gain.setValueAtTime(level * (snare ? 0.9 : 0.5), at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(env).connect(master);
    source.start(at);
    source.stop(at + length + 0.02);
    this.keep(source, env);
  }

  private keep(source: AudioScheduledSourceNode, gain: GainNode): void {
    const voice: Voice = { source, gain };
    this.voices.push(voice);
    source.onended = () => {
      this.voices = this.voices.filter((other) => other !== voice);
    };
  }

  /**
   * Stop what is already scheduled. Up to a look-ahead of notes have been
   * committed to the audio clock by now, so they are faded rather than cut,
   * which is the difference between a stop and a click.
   */
  private silence(): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const now = ctx.currentTime;
    for (const { gain, source } of this.voices) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        source.stop(now + 0.05);
      } catch {
        // Already stopped: nothing to stop twice.
      }
    }
    this.voices = [];
  }
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.random() * 2 - 1;
  }
  return buffer;
}
