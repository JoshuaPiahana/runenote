// The schemas are the contract between pipeline and app. These tests hold
// the app to it: the committed core pack must load, and anything that does
// not validate must be refused with a message a person can act on.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BundleError, parsePack, parseSong, songUrl, tierUrl } from "../src/bundle";

const CORE = fileURLToPath(new URL("../../content/packs/core", import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("the core pack", () => {
  const pack = parsePack(readJson(join(CORE, "pack.json")));

  it("lists at least one song", () => {
    expect(pack.songs.length).toBeGreaterThan(0);
  });

  it.each(pack.songs)("song %s validates and every file it names exists", (id) => {
    const dir = join(CORE, id);
    const song = parseSong(readJson(join(dir, "song.json")), `${id}/song.json`);
    expect(song.id).toBe(id);
    const files = [
      ...song.tiers.map((t) => t.file),
      ...(song.backing ? [song.backing] : []),
      ...(song.source.file ? [song.source.file] : []),
    ];
    for (const file of files) {
      expect(existsSync(join(dir, file)), `${id}/${file}`).toBe(true);
    }
  });
});

describe("parseSong", () => {
  const valid = {
    id: "tune",
    title: "Tune",
    source: { kind: "musicxml", licence: "public-domain" },
    time_signature: "4/4",
    tempo_bpm: 100,
    tiers: [
      {
        level: 3,
        file: "tier-3.musicxml",
        hands: "both",
        difficulty: 50,
        range: { low: 40, high: 70 },
      },
      {
        level: 1,
        file: "tier-1.musicxml",
        hands: "right",
        difficulty: 20,
        range: { low: 60, high: 67 },
      },
    ],
  };

  it("returns tiers easiest first whatever the file order", () => {
    expect(parseSong(valid).tiers.map((t) => t.level)).toEqual([1, 3]);
  });

  it("refuses a bundle with a message that names the field", () => {
    const broken = { ...valid, tiers: [{ ...valid.tiers[0], hands: "feet" }] };
    expect(() => parseSong(broken, "tune/song.json")).toThrow(BundleError);
    expect(() => parseSong(broken, "tune/song.json")).toThrow(
      /tune\/song\.json.*\/tiers\/0\/hands/,
    );
  });

  it("refuses fields the schema does not know, so typos cannot hide", () => {
    expect(() => parseSong({ ...valid, tempo: 100 })).toThrow(/tempo/);
  });
});

describe("urls", () => {
  it("join pack, song and file", () => {
    const song = parseSong({
      id: "tune",
      title: "Tune",
      source: { kind: "midi", licence: "public-domain" },
      time_signature: "3/4",
      tempo_bpm: 90,
      tiers: [
        {
          level: 2,
          file: "tier-2.musicxml",
          hands: "right",
          difficulty: 1,
          range: { low: 60, high: 72 },
        },
      ],
    });
    expect(songUrl("/packs/core", "tune")).toBe("/packs/core/tune/song.json");
    const [tier] = song.tiers;
    expect(tier && tierUrl("/packs/core", song, tier)).toBe("/packs/core/tune/tier-2.musicxml");
  });
});
