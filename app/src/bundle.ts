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

export type Hands = "right" | "left" | "both";

export interface Tier {
  /** 1 is easiest. A song whose melody exceeds a tier has no entry for it. */
  level: number;
  /** MusicXML for this tier, relative to the bundle. */
  file: string;
  hands: Hands;
  difficulty: number;
  range: { low: number; high: number };
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
  };
  key?: string;
  time_signature: string;
  tempo_bpm: number;
  /** Backing MIDI, relative to the bundle: everything except the player's part. */
  backing?: string;
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
  return { pack, songs };
}

export function loadTier(packBase: string, song: Song, tier: Tier): Promise<string> {
  return fetchText(tierUrl(packBase, song, tier));
}
