import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests that need production builds of the site: they build three variants (see
// tests/built/builds.ts), start them on loopback and talk HTTP. No network beyond that.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/built/**/*.test.ts"],
    globalSetup: ["tests/built/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
