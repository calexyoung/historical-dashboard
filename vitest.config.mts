import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the engine and the site. Tests that need a production build of the site are a
// separate suite (site/vitest.built.config.mts); browser tests are Playwright (site/e2e).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./site/src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "site/src/**/*.test.{ts,tsx}"],
  },
});
