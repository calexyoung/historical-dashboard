import path from "node:path";
import type { NextConfig } from "next";
import { resolveSurface } from "./src/lib/surface";

/**
 * Every build is given its Surface and its base path explicitly (PLAN 6.1 point 1): this throws,
 * and the build fails, when either is missing or they do not match. Both are then fixed into the
 * build through `env`, so the environment a container is started with cannot change them.
 *
 * The release root (ATLAS_RELEASE_ROOT) is deliberately NOT here: it is read when a request
 * arrives. No page is prerendered, so nothing from a Release can enter the build output.
 */
const { surface, basePath } = resolveSurface({
  ATLAS_SURFACE: process.env.ATLAS_SURFACE,
  BASE_PATH: process.env.BASE_PATH,
});

const nextConfig: NextConfig = {
  basePath,
  // Tests build several variants of one commit side by side (tests/built/builds.ts).
  distDir: process.env.ATLAS_DIST_DIR || ".next",
  env: { ATLAS_SURFACE: surface, NEXT_PUBLIC_BASE_PATH: basePath },
  // A self-contained server for the container image; see deploy/Dockerfile.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // The engine is a workspace package shipped as TypeScript source.
  transpilePackages: ["@macro-atlas/core"],
  poweredByHeader: false,
  // The proxy sees every path as it was asked for, so a refused Release answers 503 there too.
  skipTrailingSlashRedirect: true,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
