// Family packs sit beside core under content/packs, ignored by git, and the
// app finds them through the server's index. The rules: core comes first,
// only a directory with a pack.json is a pack, and one broken pack never
// stops the others from loading.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPacks } from "../src/bundle";
import { listPacks } from "../vite.config";

const CONTENT = fileURLToPath(new URL("../../content", import.meta.url));

describe("listPacks", () => {
  function packsDir(dirs: Record<string, boolean>): string {
    const root = mkdtempSync(join(tmpdir(), "packs-"));
    for (const [name, hasManifest] of Object.entries(dirs)) {
      mkdirSync(join(root, name));
      if (hasManifest) {
        writeFileSync(join(root, name, "pack.json"), "{}");
      }
    }
    return root;
  }

  it("puts core first, whatever sorts before it", () => {
    expect(listPacks(packsDir({ zelda: true, core: true, abba: true }))).toEqual([
      "core",
      "abba",
      "zelda",
    ]);
  });

  it("ignores a directory with no pack.json", () => {
    expect(listPacks(packsDir({ core: true, "half-copied": false }))).toEqual(["core"]);
  });

  it("finds nothing where there is no packs directory", () => {
    expect(listPacks(join(tmpdir(), "no-such-packs-dir"))).toEqual([]);
  });
});

describe("loadPacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Serves the real content tree, plus whatever extra files a test adds. */
  function serve(extra: Record<string, string>): void {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url in extra) {
        return new Response(extra[url]);
      }
      try {
        return new Response(readFileSync(join(CONTENT, url)));
      } catch {
        return new Response("", { status: 404 });
      }
    });
  }

  it("loads core even when a pack beside it is broken", async () => {
    serve({
      "/packs/index.json": JSON.stringify(["core", "broken"]),
      "/packs/broken/pack.json": JSON.stringify({ id: "broken" }),
    });
    const { packs, problems } = await loadPacks();
    expect(packs.map((p) => p.pack.id)).toEqual(["core"]);
    expect(packs[0]?.base).toBe("/packs/core");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^broken: /);
  });
});
