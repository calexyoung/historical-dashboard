/**
 * As-of answers from an opened Release (PLAN 4.5, M10): hands the engine's `resolve` what a
 * Release holds for one Series. Nothing is decided here; the rules are the engine's
 * (`docs/method/vintage-resolution.md`).
 *
 * A legacy Series is dated by the one clock a legacy Release has: when v1 generated the output
 * it was converted from (`manifest.inputs[].generated`). A Release that does not say cannot
 * answer an as-of question for it.
 */
import { resolve, type VintageAnswer } from "@macro-atlas/core";
import type { OpenedRelease } from "./reader";

/** When v1's output was generated, as the Release records it; null when it does not. */
function legacyHeldAt(release: OpenedRelease): string | null {
  const times = (release.manifest.inputs ?? []).map((input) => input.generated).filter((t): t is string => typeof t === "string");
  // The newest: every value in the Release was in v1's hands by then.
  return times.length > 0 ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
}

/**
 * What `key` said as of a date (`2026-03-10`) or an instant, with its Basis; `date` null asks
 * for the Release's own state. Null when the Release holds no values for `key`: an unknown
 * Series, or a withheld one.
 */
export function asOf(release: OpenedRelease, key: string, date: string | null): VintageAnswer | null {
  const own = <T>(folder: Record<string, T>): T | undefined => (Object.hasOwn(folder, key) ? folder[key] : undefined);
  const file = own(release.series) ?? own(release.derived);
  if (!file) return null;
  const legacy = file.representation !== "native";
  return resolve(
    {
      key,
      freq: file.freq,
      representation: file.representation,
      observations: file.observations,
      vintages: own(release.vintages) ?? null,
      heldAt: legacy ? legacyHeldAt(release) : null,
    },
    date,
    { releaseId: release.id },
  );
}
