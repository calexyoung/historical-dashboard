/**
 * What every body of the read API carries (PLAN section 7, M24; docs/method/api.md):
 * `release_id`, `semantics_version`, `provenance` and `rights`.
 *
 * Apart from the routes' own module so that the proxy, which answers 429 itself, can write the
 * same four fields without carrying the engine. Everything here is read from a Release the gate
 * has already accepted for this request; nothing here opens one.
 */
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import type { OpenedRelease } from "../release/reader";

type Held = Pick<OpenedRelease, "id" | "manifest">;

/**
 * Where a body with no value of one Series in it came from: this Release. `release_sources` is
 * every source the Release was made from and how its fetch ended; it is the Release's record,
 * not a list of what one Event or one Claim rests on (those cite their own sources).
 */
export function releaseProvenance(release: Held) {
  const { manifest } = release;
  return {
    publisher: "Macro Atlas",
    release: { id: release.id, created: manifest.created, profile: manifest.profile },
    release_sources: (manifest.sources ?? []).map((s) => ({ producer: s.producer, via: s.via, fetched: s.fetched ?? null, outcome: s.outcome ?? null })),
  };
}

/**
 * The rights of a body that holds no value of a Series. It says only that no Permission was
 * needed to give this body. It does not say that anything the body names may be shown or
 * redistributed: each Series listed carries its own rights and its own answer from the gate.
 */
export const NO_VALUE_RIGHTS = {
  permission: "none",
  permitted: true,
  scope: "This body holds no value of a Series, so no Permission was asked for it. It does not say that anything it names may be redistributed: each Series carries its own rights.",
} as const;

export type ApiError = { status: number; code: string; message: string; /** What may be asked instead (PLAN section 7: "400 with the allowlist"). */ allowed?: Record<string, unknown>; retry_after_seconds?: number };

/** The body of a refusal: the error, and the same four fields as every other body. */
export function errorBody(release: Held, error: ApiError, rights: Record<string, unknown> = NO_VALUE_RIGHTS) {
  return { error, release_id: release.id, semantics_version: SEMANTICS_VERSION, provenance: releaseProvenance(release), rights };
}

export const toJson = (doc: unknown): string => JSON.stringify(doc, null, 1) + "\n";
