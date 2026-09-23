import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const PACKS_DIR = resolve(__dirname, "../content/packs");
const INDEX = "/packs/index.json";

/** Every directory under content/packs that holds a pack.json, core first.
    A browser cannot list a directory, so the server says which packs exist.
    That is what lets a family pack sit beside core, ignored by git, and
    appear without any code naming it. */
export function listPacks(dir = PACKS_DIR): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(dir, entry.name, "pack.json")))
    .map((entry) => entry.name)
    .sort();
  return [...ids.filter((id) => id === "core"), ...ids.filter((id) => id !== "core")];
}

function packIndex(): Plugin {
  return {
    name: "runenote-pack-index",
    configureServer(server) {
      // Read on every request, so a pack dropped in shows up on reload.
      server.middlewares.use(INDEX, (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(listPacks()));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: INDEX.slice(1),
        source: JSON.stringify(listPacks()),
      });
    },
  };
}

export default defineConfig({
  plugins: [packIndex()],
  // The content tree is served as-is (/packs/core/ode-to-joy/song.json) and
  // copied into the build. It lives beside the app, not inside it, because
  // the pipeline writes it and the app only reads it.
  publicDir: "../content",
  server: {
    // Listen on all interfaces so the Docker port mapping reaches it.
    host: true,
    port: 5173,
    strictPort: true,
    // The JSON Schemas are imported from the content tree, one level up.
    fs: { allow: [".."] },
    watch: {
      // The app runs in a container against a Windows bind mount, which
      // delivers no inotify events, so without polling the dev server
      // serves the code as it was when it started and an edit looks like
      // it did nothing.
      usePolling: true,
      interval: 300,
    },
  },
  build: {
    // OSMD and VexFlow are ~1.4 MB minified. One app, loaded once, on
    // localhost: not worth splitting, and the default warning would nag CI.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
