/**
 * As-of answers from an opened Release (PLAN 4.5, M10): hands the engine's `resolve` what a
 * Release holds for one Series. Nothing is decided here; the rules are the engine's
 * (`docs/method/vintage-resolution.md`).
 *
 * A legacy Series is dated by the one clock a legacy Release has: when v1 generated the output
 * it was converted from (`manifest.inputs[].generated`). A Release that does not say cannot
 * answer an as-of question for it.
 */
import { evaluateRecipe, resolve, type DerivedAnswer, type ResolveSeries, type VintageAnswer } from "@macro-atlas/core";
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

/**
 * What a Derived series the engine computes said as of a date: its Recipe run over each stored
 * input's own Vintage, with the weakest Basis among them (PLAN 4.5, M11;
 * `docs/method/transforms.md`, "Recipes"). `date` null asks for the Release's own state.
 *
 * Null when `key` is not such a Series in this Release: unknown, withheld, stored, or one of
 * v1's Derived series, which v1 computed and which `asOf` answers on the legacy Basis.
 */
export function derivedAsOf(release: OpenedRelease, key: string, date: string | null): DerivedAnswer | null {
  const entry = release.catalog.series.find((candidate) => candidate.key === key);
  if (!entry?.recipe || entry.representation !== "native" || !Object.hasOwn(release.derived, key)) return null;
  const catalog = new Map(release.catalog.series.map((candidate) => [candidate.key, candidate]));
  const load = (name: string): ResolveSeries | null => {
    const file = Object.hasOwn(release.series, name) ? release.series[name] : undefined;
    if (!file) return null;
    const vintages = Object.hasOwn(release.vintages, name) ? release.vintages[name]! : null;
    return { key: name, freq: file.freq, representation: file.representation, observations: file.observations, vintages, heldAt: null };
  };
  return evaluateRecipe(key, catalog, load, { asOf: date, releaseId: release.id });
}
