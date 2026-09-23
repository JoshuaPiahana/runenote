// Song bundles and packs, as the app sees them.
//
// The JSON Schemas in content/schema are the contract between the pipeline
// and the app: anything that validates, plays. So the app checks every bundle
// against the same schema the pipeline's guard uses, and refuses anything
// else with a message that names the field. The interfaces below mirror the
// schemas by hand; the schema is the source of truth, and a test loads the
// core pack through this module so the two cannot drift unnoticed.

import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import packSchema from "../../content/schema/pack.schema.json";
import songSchema from "../../content/schema/song.schema.json";
import { type BackingNote, parseMidiFile } from "./smf";

export type Hands = "right" | "left" | "both";
export type Layer = "melody" | "bass" | "harmony";

export interface Tier {
  /** 1 is easiest. A song whose melody exceeds a tier has no entry for it. */
  level: number;
  /** MusicXML for this tier, relative to the bundle. */
  file: string;
  hands: Hands;
  /** What the player's own hands cover; the band stands down from these. */
  layers: Layer[];
  difficulty: number;
  range: { low: number; high: number };
}

/** What the band plays. The player always has the melody, so there is no
    melody role: the band is only ever the part that is missing. Drums and
    colour (a source's echoes, counter-melodies, arpeggios) are never the
    player's, so they always play. */
export type Role = "bass" | "keys" | "drums" | "colour";

export interface BackingTrack {
  role: Role;
  /** The MIDI channel this role was written on, so the app never has to
      guess a role from the order the tracks happen to be in. */
  channel: number;
  /** General MIDI program, when the pipeline knows it (a source backing). */
  program?: number;
  /** The source part a source backing's track was copied from. */
  part?: number;
}

export interface Backing {
  /** The band's MIDI, relative to the bundle. */
  file: string;
  /** The style row it was generated from. */
  /** Generated from the harmony ("band", the default), or the source's own
      parts by role ("source"). */
  from?: "band" | "source";
  /** The style row a generated band came from; absent for a source backing. */
  style?: string;
  tracks: BackingTrack[];
}

export interface Song {
  id: string;
  title: string;
  composer?: string;
  source: {
    kind: "midi" | "musicxml";
    licence: string;
    origin?: string;
    file?: string;
    melody?: number;
    roles?: Record<string, "bass" | "keys" | "drums" | "colour" | "drop">;
  };
  key?: string;
  time_signature: string;
  tempo_bpm: number;
  /** The band, absent when the song had no harmony or no style fits it. */
  backing?: Backing;
  /** Sorted by level, easiest first. */
  tiers: Tier[];
}

export interface Pack {
  id: string;
  name: string;
  version: string;
  licence: string;
  songs: string[];
}

export class BundleError extends Error {
  constructor(where: string, errors: ErrorObject[] | null | undefined) {
    const detail = (errors ?? [])
      .map((e) => {
        // Ajv says "must NOT have additional properties" and puts the name
        // in params; the name is the useful part.
        const extra = "additionalProperty" in e.params ? ` (${e.params.additionalProperty})` : "";
        return `${e.instancePath || "/"} ${e.message ?? "is invalid"}${extra}`;
      })
      .join("; ");
    super(`${where} does not match the schema: ${detail}`);
    this.name = "BundleError";
  }
}

const ajv = new Ajv2020({ allErrors: true });
const validPack = ajv.compile<Pack>(packSchema);
const validSong = ajv.compile<Song>(songSchema);

export function parsePack(data: unknown, where = "pack.json"): Pack {
  if (!validPack(data)) {
    throw new BundleError(where, validPack.errors);
  }
  return data;
}

export function parseSong(data: unknown, where = "song.json"): Song {
  if (!validSong(data)) {
    throw new BundleError(where, validSong.errors);
  }
  // The schema does not order tiers; everyone downstream wants easiest first.
  return { ...data, tiers: [...data.tiers].sort((a, b) => a.level - b.level) };
}

// --- URLs -----------------------------------------------------------------
// A pack is a directory served as-is, so every path is a join. Kept in one
// place so the layout (pack/song/file) is written down once.

export function songUrl(packBase: string, songId: string): string {
  return `${packBase}/${songId}/song.json`;
}

export function tierUrl(packBase: string, song: Song, tier: Tier): string {
  return `${packBase}/${song.id}/${tier.file}`;
}

export function backingUrl(packBase: string, song: Song, backing: Backing): string {
  return `${packBase}/${song.id}/${backing.file}`;
}

// --- Loading --------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url));
}

export interface LoadedPack {
  pack: Pack;
  songs: Song[];
  /** The pack's URL, which every file in it is fetched relative to. */
  base: string;
}

export interface LoadedPacks {
  packs: LoadedPack[];
  /** One line per pack that would not load. */
  problems: string[];
}

/** Loads every pack the server lists. A broken family pack is reported and
    skipped rather than taking the others down with it: core must always
    play, whatever has been dropped in beside it. */
export async function loadPacks(root = "/packs"): Promise<LoadedPacks> {
  const indexUrl = `${root}/index.json`;
  const ids = await fetchJson(indexUrl);
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error(`${indexUrl}: expected a list of pack ids`);
  }
  const settled = await Promise.allSettled(ids.map((id) => loadPack(`${root}/${id}`)));
  const packs: LoadedPack[] = [];
  const problems: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      packs.push(result.value);
    } else {
      problems.push(
        `${ids[i]}: ${String(result.reason instanceof Error ? result.reason.message : result.reason)}`,
      );
    }
  });
  return { packs, problems };
}

/** Loads a pack and every song it lists. `packBase` is the pack's URL, no trailing slash. */
export async function loadPack(packBase: string): Promise<LoadedPack> {
  const packJson = `${packBase}/pack.json`;
  const pack = parsePack(await fetchJson(packJson), packJson);
  const songs = await Promise.all(
    pack.songs.map(async (id) => {
      const url = songUrl(packBase, id);
      const song = parseSong(await fetchJson(url), url);
      if (song.id !== id) {
        throw new Error(`${url}: song id is "${song.id}" but the pack lists it as "${id}"`);
      }
      return song;
    }),
  );
  return { pack, songs, base: packBase };
}

export function loadTier(packBase: string, song: Song, tier: Tier): Promise<string> {
  return fetchText(tierUrl(packBase, song, tier));
}

export async function loadBacking(packBase: string, song: Song): Promise<BackingNote[]> {
  if (!song.backing) {
    return [];
  }
  const url = backingUrl(packBase, song, song.backing);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return parseMidiFile(await response.arrayBuffer());
}
