/** `/api/v1/status` (PLAN 4.6, M17): freshness per source and per Series, and the last run. */
import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "./release/testing";
import { statusView } from "./status";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});
const created = Date.parse("2026-01-01T00:00:00Z");
const view = (more: Partial<Parameters<typeof statusView>[2]> = {}, surface: "local" | "production" = "local", of: OpenedRelease = release) =>
  statusView(of, surface, { refreshFailed: null, now: created + 3_600_000, lastRun: null, ...more });

describe("status", () => {
  it("names the release, its age, each source and each Series with its last Period and whether it is stale", () => {
    const v = view();
    expect(v).toMatchObject({ release_id: FIXTURE_ID, profile: "public", surface: "local", age_seconds: 3600, last_run: null });
    expect(v.sources).toEqual([{ producer: "Macro Atlas fixture (synthetic)", via: "fixture", fetched: null, outcome: "ok", detail: null }]);
    expect(v.series.find((s) => s.key === "fx_price_index")).toEqual({
      key: "fx_price_index", name: "Fixture price index", frequency: "monthly", max_lag: "P2M", state: "shown", reason: null, last_period: "2025-12", last_period_end: "2025-12-31", stale: false,
    });
    expect(v.series.find((s) => s.key === "fx_permits_stale")).toMatchObject({ last_period: "2024-06", stale: true });
    expect(v.counts).toMatchObject({ series: 8, shown: 7, withheld: 1, stale: 1 });
  });

  it("a fresh release with a stale Series or a failed source is reported as stale inputs", async () => {
    expect(view().status).toBe("stale_inputs");
    // The same release without its one stale Series' limit, then with a failed source.
    const fresh = { ...release, catalog: { series: release.catalog.series.map((e) => (e.key === "fx_permits_stale" ? { ...e, max_lag: undefined } : e)) } };
    expect(view({}, "local", fresh).status).toBe("ok");
    const failed = { ...fresh, manifest: { ...fresh.manifest, sources: [{ producer: "P", via: "direct", fetched: null, outcome: "failed" as const }] } };
    expect(view({}, "local", failed)).toMatchObject({ status: "stale_inputs", counts: { sources_not_ok: 1 } });
    // Most serious first.
    expect(view({ now: created + 40 * 3_600_000 }, "local", fresh).status).toBe("stale");
    expect(view({ now: created + 40 * 3_600_000, refreshFailed: { kind: "invalid", id: null, reason: "x" } }).status).toBe("degraded");
  });

  it("a Series that may not be shown is listed by name and reason, with nothing about its values", () => {
    expect(view().series.find((s) => s.key === "fx_exchange_index")).toMatchObject({ name: "Fixture exchange index", state: "withheld", reason: "The licence does not allow redistribution.", last_period: null, stale: null });
    const v = view({}, "production");
    expect(v.counts).toMatchObject({ shown: 0, not_permitted: 7, withheld: 1, stale: 0 });
    expect(v.series.every((s) => s.last_period === null && s.last_period_end === null)).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/109\.9|2025-12/);
  });
});

describe("the last run, from the root's own record", () => {
  it("is a fixed selection of STATUS.json, and nothing when the record is missing or unreadable", async () => {
    const root = tempRoot();
    addRelease(root, { id: "20260201T000000Z-3333333" });
    promote(root, "20260201T000000Z-3333333");
    const reader = createReleaseReader({ root, surface: "local" });
    expect(await reader.lastRun!()).toBeNull();
    writeFileSync(`${root}/STATUS.json`, "{ not json");
    expect(await reader.lastRun!()).toBeNull();
    writeFileSync(`${root}/STATUS.json`, JSON.stringify({ format: 1, started: "2026-02-01T00:00:00Z", finished: "2026-02-01T00:01:00Z", outcome: "rejected", release_id: null, command: "atlas release --secret", reason: "REJECTED: fx_price_index 109.9", failed_checks: [{ check: "x", detail: "109.9" }], current: "20260201T000000Z-3333333" }));
    const run = await reader.lastRun!();
    expect(run).toEqual({ started: "2026-02-01T00:00:00Z", finished: "2026-02-01T00:01:00Z", outcome: "rejected", release_id: null, failed_checks: 1 });
    mkdirSync(`${root}/x`, { recursive: true });
    writeFileSync(`${root}/STATUS.json`, JSON.stringify({ outcome: "<script>" }));
    expect(await reader.lastRun!()).toBeNull();
  });
});
