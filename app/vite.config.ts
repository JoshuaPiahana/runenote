import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    // Listen on all interfaces so the Docker port mapping reaches it.
    host: true,
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
