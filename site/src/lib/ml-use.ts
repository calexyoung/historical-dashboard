/**
 * "Not for use in training machine-learning models" (ADR 0041): what a Series' values carry
 * wherever they leave the site, when its Rights do not allow that use.
 *
 * `mlUse(release, surface, entry)` answers with the flag and, when it is false, the sentence
 * that says so and why. Two things are asked and the most restrictive wins:
 *
 * 1. the Release: the `ml_use` its Catalog states for the Series (for a Derived series, the
 *    most restrictive of the stored Series it is computed from). A Release written before the
 *    contract said so (older than 0.8.0) is no permission;
 * 2. the rights gate, today, on this Surface, for the Permission `ml_use`, over the Series'
 *    whole lineage, and with `history` over everything its past versions came through. So a
 *    signature that changed after the Release was written, or a history fetched under other
 *    terms, is not passed over.
 *
 * Every surface that hands out a value says the sentence through this one function: a series
 * page and its twins, the read API, the Explorer's exports, page twins, `llms.txt` and
 * JSON-LD. Where `ml_use` is true nothing more is said.
 */
import { ML_USE_LEAD, mlUseNote, type RightsGate, type Surface } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { askGate } from "./query";
import type { OpenedRelease } from "./release/reader";

export type MlUse = { ml_use: boolean; /** The sentence, with no full stop; null when `ml_use` is true. */ note: string | null };
export type MlUseOptions = { /** See `QueryOptions.gate`: only a test passes one. */ gate?: Pick<RightsGate, "permits">; /** The values are, or may be, past versions. */ history?: boolean };

export function mlUse(release: OpenedRelease, surface: Surface, entry: CatalogEntry, options: MlUseOptions = {}): MlUse {
  const said = mlUseNote(entry.rights);
  if (said !== null) return { ml_use: false, note: said };
  const asked = askGate(release, surface, [entry.key], "ml_use", options);
  if (asked.ok) return { ml_use: true, note: null };
  return { ml_use: false, note: `${ML_USE_LEAD}: the rights register does not allow it today (${asked.message})` };
}

/** The same, by key: for a view that names Series and does not hold their entries. Null for a key the Release does not hold. */
export function mlUseOf(release: OpenedRelease, surface: Surface, key: string, options: MlUseOptions = {}): MlUse | null {
  const entry = release.catalog.series.find((e) => e.key === key);
  return entry ? mlUse(release, surface, entry, options) : null;
}

/**
 * The sentences for several Series, each once, with the names of the Series it is said of. A
 * key the Release does not hold (a Claim lock may name one) cannot be answered for, and that is
 * said: silence would read as permission.
 */
export function mlUseLines(release: OpenedRelease, surface: Surface, keys: readonly string[], options: MlUseOptions = {}): string[] {
  const by = new Map<string, string[]>();
  for (const key of keys) {
    const entry = release.catalog.series.find((e) => e.key === key);
    const note = entry ? mlUse(release, surface, entry, options).note : `${ML_USE_LEAD}: this release does not hold the series, so it cannot say whether its terms allow it`;
    if (note) by.set(note, [...(by.get(note) ?? []), entry?.name ?? key]);
  }
  return [...by].map(([note, names]) => `${note} (${names.join("; ")})`);
}
