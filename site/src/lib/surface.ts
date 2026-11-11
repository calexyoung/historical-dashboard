/**
 * The Surface a build is for, and the base path it is served at (PLAN 6.1 point 1, ADR 0008).
 *
 * Every build is given both explicitly, as `ATLAS_SURFACE` and `BASE_PATH`. `next.config.ts`
 * calls this, so a build (or `next dev`) with no Surface, or with a Surface that does not match
 * its base path, fails before anything is compiled. Both values are then fixed into the build:
 * the environment a container is started with cannot turn a production build into a local one.
 *
 * Pure: no file or network access, and nothing here reads `process.env` by itself.
 */
import { SURFACES, type Surface } from "@macro-atlas/core";

export const PRODUCTION_BASE_PATH = "/macro-atlas";
export const STAGING_BASE_PATH = "/macro-atlas-staging";
export const BASE_PATHS = [PRODUCTION_BASE_PATH, STAGING_BASE_PATH] as const;
export type BasePath = (typeof BASE_PATHS)[number];

export type SurfaceConfig = { surface: Surface; basePath: BasePath };

/** The one base path each public Surface is served at. The local Surface may use either. */
const HOME: Partial<Record<Surface, BasePath>> = {
  production: PRODUCTION_BASE_PATH,
  staging: STAGING_BASE_PATH,
};

export function resolveSurface(env: { ATLAS_SURFACE?: string; BASE_PATH?: string }): SurfaceConfig {
  const surface = env.ATLAS_SURFACE;
  if (!surface) {
    throw new Error(`ATLAS_SURFACE is not set: a build must say which surface it is for (${SURFACES.join(", ")})`);
  }
  if (!(SURFACES as readonly string[]).includes(surface)) {
    throw new Error(`unknown surface "${surface}": only ${SURFACES.join(", ")} exist`);
  }
  const basePath = env.BASE_PATH;
  if (!basePath) {
    throw new Error(`BASE_PATH is not set: a build must say where it is served (${BASE_PATHS.join(" or ")})`);
  }
  if (!(BASE_PATHS as readonly string[]).includes(basePath)) {
    throw new Error(`BASE_PATH must be ${BASE_PATHS.join(" or ")}, not "${basePath}"`);
  }
  const home = HOME[surface as Surface];
  if (home && home !== basePath) {
    throw new Error(`the ${surface} surface is served at ${home}, not ${basePath}`);
  }
  return { surface: surface as Surface, basePath: basePath as BasePath };
}
