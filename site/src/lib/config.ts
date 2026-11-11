/**
 * What this build is: its Surface and base path, fixed when it was built (next.config.ts), and
 * the release root, read from the environment when the server starts.
 */
import { resolveSurface } from "./surface";

// Replaced with literals at build time. A build without them does not exist: next.config.ts
// refuses to make one. This check is for anything that loads the module some other way.
const fixed = resolveSurface({
  ATLAS_SURFACE: process.env.ATLAS_SURFACE,
  BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
});

export const SURFACE = fixed.surface;
export const BASE_PATH = fixed.basePath;

/** The mydashboards front door, shared with /missions (ADR 0009). */
export const HOME_URL = "https://mydashboards.co/";
