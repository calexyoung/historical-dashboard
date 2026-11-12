/**
 * `/api/v1/status` (PLAN 4.6 and section 7): how fresh what is being served is, source by source
 * and Series by Series, and how the writer's last run ended. Never an upstream call: everything
 * here is read from the Release fixed for the request and from the root's own record.
 *
 * `statusView()` is pure apart from what it is given. A Series' last Period is said only where
 * the gate allows its values to be shown; a Series that is Withheld or not permitted is listed by
 * name with the reason, as everywhere else.
 *
 * `status`, most serious first:
 *   degraded       a newer Release could not be opened and an earlier one is being served
 *   stale          the Release is older than a day and a half (a daily refresh was missed)
 *   stale_inputs   the Release is fresh, but a source failed or was stale when it was made, or a
 *                  Series is past the limit the Catalog sets for it
 *   ok
 */
import { SEMANTICS_VERSION, staleness, type RightsGate, type Surface } from "@macro-atlas/core";
import { STALE_AFTER_SECONDS } from "./freshness";
import { latestValue } from "./query";
import type { Failure, LastRun, OpenedRelease } from "./release/reader";

export type StatusView = {
  status: "ok" | "stale_inputs" | "stale" | "degraded";
  surface: Surface;
  release_id: string;
  profile: string;
  created: string;
  age_seconds: number;
  semantics_version: string;
  refresh_failed: Omit<Failure, "ok"> | null;
  /** Null when the root holds no record of a run. */
  last_run: LastRun | null;
  sources: { producer: string; via: string; fetched: string | null; outcome: string | null; /** The Release's own note on a source that failed or was stale. */ detail: string | null }[];
  series: {
    key: string;
    name: string;
    state: "shown" | "withheld" | "not_permitted";
    reason: string | null;
    frequency: string;
    /** The last Period with a value; null where there is none, or where it may not be shown. */
    last_period: string | null;
    last_period_end: string | null;
    max_lag: string | null;
    /** Against the Release's own day. Null when no limit is recorded or the Series is not shown. */
    stale: boolean | null;
  }[];
  counts: { series: number; shown: number; withheld: number; not_permitted: number; stale: number; sources_not_ok: number };
  now: string;
};

export function statusView(
  release: OpenedRelease,
  surface: Surface,
  context: { refreshFailed: Omit<Failure, "ok"> | null; now: number; lastRun: LastRun | null; gate?: Pick<RightsGate, "permits"> },
): StatusView {
  const { manifest } = release;
  const withheld = new Map(manifest.withheld.map((row) => [row.key, row.reason]));
  const series = release.catalog.series.map((entry): StatusView["series"][number] => {
    const base = { key: entry.key, name: entry.name, frequency: entry.freq, max_lag: entry.max_lag ?? null };
    const latest = latestValue(release, surface, entry.key, context.gate);
    if (!latest.ok) {
      const state = withheld.has(entry.key) ? "withheld" : "not_permitted";
      return { ...base, state, reason: withheld.get(entry.key) ?? latest.message, last_period: null, last_period_end: null, stale: null };
    }
    const last = latest.latest;
    const age = last ? staleness(last.period_end, entry.max_lag, manifest.created) : { known: false as const };
    return { ...base, state: "shown", reason: null, last_period: last?.period ?? null, last_period_end: last?.period_end ?? null, stale: age.known ? age.stale : null };
  });
  const sources = (manifest.sources ?? []).map((s) => ({ producer: s.producer, via: s.via, fetched: s.fetched ?? null, outcome: s.outcome ?? null, detail: s.detail ?? null }));
  const ageSeconds = Math.max(0, Math.floor((context.now - Date.parse(manifest.created)) / 1000));
  const count = (state: string) => series.filter((s) => s.state === state).length;
  const counts = {
    series: series.length,
    shown: count("shown"),
    withheld: count("withheld"),
    not_permitted: count("not_permitted"),
    stale: series.filter((s) => s.stale === true).length,
    sources_not_ok: sources.filter((s) => s.outcome === "failed" || s.outcome === "stale").length,
  };
  const status: StatusView["status"] = context.refreshFailed
    ? "degraded"
    : ageSeconds > STALE_AFTER_SECONDS
      ? "stale"
      : counts.stale > 0 || counts.sources_not_ok > 0
        ? "stale_inputs"
        : "ok";
  return {
    status,
    surface,
    release_id: release.id,
    profile: manifest.profile,
    created: manifest.created,
    age_seconds: ageSeconds,
    semantics_version: SEMANTICS_VERSION,
    refresh_failed: context.refreshFailed,
    last_run: context.lastRun,
    sources,
    series,
    counts,
    now: new Date(context.now).toISOString(),
  };
}
