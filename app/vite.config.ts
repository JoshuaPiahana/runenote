import { defineConfig } from "vitest/config";

export default defineConfig({
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
