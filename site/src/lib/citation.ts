/**
 * A citation: one rendering of a Series' Provenance (CONTEXT.md), from a fixed template. It names
 * the Origin, what the Origin calls the data, the Channel it came through, the Release it is in
 * and the address it was read at. Nothing in it is written by hand and nothing evaluates.
 */
import type { CatalogEntry } from "@macro-atlas/core/release";
import { VIAS } from "./catalog";
import { formatDay } from "./freshness";
import type { OpenedRelease } from "./release/reader";

const LEGACY = "legacy_monthly_rounded";

export function citation(release: Pick<OpenedRelease, "id" | "manifest">, entry: CatalogEntry, /** The series page's address, as a reader would open it. */ address: string, asOf?: string): string {
  const { origin, channel } = entry.source;
  const named = !/^not recorded/i.test(origin.producer);
  const what = [origin.dataset, origin.origin_id && origin.origin_id !== origin.dataset ? origin.origin_id : null].filter(Boolean).join(", ");
  const route =
    channel.via === "direct"
      ? "Obtained directly from the origin"
      : channel.via === "hand_entered"
        ? "Entered by hand from the published record"
        : channel.via === "computed"
          ? "Computed from other series"
          : `Obtained through ${VIAS[channel.via] ?? channel.via}`;
  const parts = [
    `${named ? origin.producer : "Origin not recorded"}. ${entry.name} (${what}).`,
    `${route}${entry.representation === LEGACY ? ", as rounded monthly values carried over from Macro Atlas v1" : ""}.`,
    `Macro Atlas, series ${entry.key}, release ${release.id} of ${formatDay(release.manifest.created)}${asOf ? `, as known before ${asOf}` : ""}.`,
    address,
  ];
  return parts.join(" ");
}
