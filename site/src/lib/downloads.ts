/**
 * Bulk files as the site offers them (PLAN section 7 and M25; ADR 0039;
 * `docs/method/bulk-files.md`): `/downloads`, and `/downloads/{release id}/{file}`.
 *
 * The files were written under the Permission to redistribute. That was the register's answer
 * on the day the Release was made. A file is handed out only if it is still the answer today:
 * `downloadDecision` asks the gate, for this Surface, about every Series the file lists (and,
 * for a file of versions, everything their history came through). One refusal refuses the
 * file; a file is never cut down to what is still allowed, because its hash is in the
 * datapackage. The datapackage itself holds no value and is given whenever the Release has one.
 *
 * Node only (it takes an opened Release); pure otherwise.
 */
import type { RightsGate, Surface } from "@macro-atlas/core";
import type { BulkResource } from "@macro-atlas/core/release";
import { RIGHTS } from "./catalog";
import { askGate } from "./query";
import type { OpenedRelease } from "./release/reader";

type Gate = Pick<RightsGate, "permits">;
export type DownloadsOptions = { /** See `QueryOptions.gate`: only a test passes one. */ gate?: Gate };

export const DATAPACKAGE = "datapackage.json";
const TYPES: Record<string, string> = { parquet: "application/vnd.apache.parquet", "csv.gz": "application/gzip", "ndjson.gz": "application/gzip", json: "application/json; charset=utf-8" };
/** What a bulk file is sent as. */
export const downloadType = (name: string): string => TYPES[Object.keys(TYPES).find((ext) => name.endsWith(`.${ext}`)) ?? ""] ?? "application/octet-stream";

export type DownloadDecision = { ok: true; resource: BulkResource | null } | { ok: false; status: 403 | 404; message: string };

/** May this file of this Release be handed out here, today? */
export function downloadDecision(release: OpenedRelease, surface: Surface, name: string, options: DownloadsOptions = {}): DownloadDecision {
  const pack = release.downloads;
  if (pack === null) return { ok: false, status: 404, message: "This release has no bulk files" };
  if (name === DATAPACKAGE) return { ok: true, resource: null };
  const resource = pack.resources.find((r) => r.path === name);
  if (!resource) return { ok: false, status: 404, message: "This release has no bulk file of that name" };
  const asked = askGate(release, surface, resource.series, "redistribute", { history: name.startsWith("vintages"), gate: options.gate });
  if (!asked.ok) return { ok: false, status: 403, message: `This file may not be handed out here: ${asked.message}` };
  return { ok: true, resource };
}

export type DownloadRow = {
  name: string;
  /** Without the base path. */
  href: string;
  format: string;
  rows: number;
  series: number;
  bytes: number;
  size: string;
  sha256: string;
  /** The licence classes of its rows, in words. */
  licences: string[];
  /** Null when it is handed out here; else why not. */
  refused: string | null;
};
export type DownloadsView = {
  release: string;
  /** Null: the Release has no bulk files, and `none` says why that can be. */
  none: string | null;
  /** The whole tables. */
  whole: DownloadRow[];
  /** The same rows, for one licence class each. */
  byLicence: { licence: string; label: string; attributions: string[]; terms: string[]; rows: DownloadRow[] }[];
  datapackage: string | null;
  /** Series the Release publishes that are in no file, with the reason. */
  leftOut: { key: string; name: string; reason: string }[];
  /** Series the Release withholds: in no file, as on every page. */
  withheld: { key: string; name: string; reason: string }[];
  /** How many Series the Observations hold, and how many of those have their history in the versions. */
  counts: { series: number; observations: number; withHistory: number; versions: number };
};

export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
const FORMAT_WORDS: Record<string, string> = { parquet: "Parquet", csv: "CSV, gzip", ndjson: "JSON Lines, gzip" };

export function downloadsView(release: OpenedRelease, surface: Surface, options: DownloadsOptions = {}): DownloadsView {
  const names = new Map(release.catalog.series.map((entry) => [entry.key, entry.name]));
  const withheld = release.manifest.withheld.map((row) => ({ key: row.key, name: names.get(row.key) ?? row.key, reason: row.reason }));
  const pack = release.downloads;
  if (pack === null) {
    const none =
      release.manifest.profile !== "public"
        ? "This is a local-profile release. Bulk files are written only for a public-profile release."
        : "This release has no bulk files: it was written before there were any, or nothing in it may be redistributed.";
    return { release: release.id, none, whole: [], byLicence: [], datapackage: null, leftOut: [], withheld, counts: { series: 0, observations: 0, withHistory: 0, versions: 0 } };
  }
  const row = (r: BulkResource): DownloadRow => {
    const decided = downloadDecision(release, surface, r.path, options);
    return {
      name: r.path,
      href: `/downloads/${release.id}/${r.path}`,
      format: FORMAT_WORDS[r.format] ?? r.format,
      rows: r.rows,
      series: r.series.length,
      bytes: r.bytes,
      size: sizeWords(r.bytes),
      sha256: r.hash.slice("sha256:".length),
      licences: r.licences.map((l) => RIGHTS[l] ?? l),
      refused: decided.ok ? null : decided.message,
    };
  };
  const whole = pack.resources.filter((r) => r.licence === undefined);
  const classes = [...new Set(pack.resources.flatMap((r) => (r.licence === undefined ? [] : [r.licence as string])))];
  const observations = whole.find((r) => r.path === "observations.parquet");
  const versions = whole.find((r) => r.path === "vintages.parquet");
  return {
    release: release.id,
    none: null,
    whole: whole.map(row),
    byLicence: classes.map((licence) => {
      const of = pack.resources.filter((r) => r.licence === licence);
      return {
        licence,
        label: RIGHTS[licence] ?? licence,
        attributions: [...new Set(of.flatMap((r) => r.attributions))],
        terms: [...new Set(of.flatMap((r) => r.licenses.flatMap((l) => (l.path ? [l.path] : []))))],
        rows: of.map(row),
      };
    }),
    datapackage: `/downloads/${release.id}/${DATAPACKAGE}`,
    leftOut: pack.left_out.map((r) => ({ key: r.key, name: names.get(r.key) ?? r.key, reason: r.reason })),
    withheld,
    counts: { series: observations?.series.length ?? 0, observations: observations?.rows ?? 0, withHistory: versions?.series.length ?? 0, versions: versions?.rows ?? 0 },
  };
}
