/**
 * The reader and vintages (PLAN M10): a Release's vintage files, opened with it, answer as-of
 * questions through the engine's `resolve`. Expected values are read off the fixture's own
 * script (fixtures/make_fixture.py, "vintages"), where each version is written out by hand.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asOf } from "./as-of";
import { createReleaseReader, type OpenedRelease } from "./reader";
import { FIXTURE_ROOT } from "./testing";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "production" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const last = (key: string, date: string | null): unknown[] => {
  const o = asOf(release, key, date)!.observations.at(-1)!;
  return [o.period, o.value, o.status];
};

describe("the reader opens a Release's vintage files with it", () => {
  it("holds one for each Series that has a history, checked against the contract on open", () => {
    expect(Object.keys(release.vintages).sort()).toEqual(["fx_output_quarterly", "fx_poverty_rate_annual", "fx_price_index"]);
    expect(release.vintages.fx_price_index!.captures).toHaveLength(21);
  });
});

describe("as-of answers from the fixture release", () => {
  it("an Atlas-observed Series: the figure as it stood before each revision", () => {
    expect(asOf(release, "fx_price_index", "2025-12-08")).toMatchObject({ basis: "unavailable", reason: "no_coverage", observations: [] });
    expect([asOf(release, "fx_price_index", "2025-12-09")!.basis, last("fx_price_index", "2025-12-09")]).toEqual(["atlas_observed", ["2025-10", 109.2, "preliminary"]]);
    expect(last("fx_price_index", "2025-12-11")).toEqual(["2025-11", 109.5, "preliminary"]);
    expect(asOf(release, "fx_price_index", "2025-12-11")!.observations.at(-2)).toMatchObject({ period: "2025-10", value: 109.0, status: "final" });
  });
  it("the three days with no Capture make the answers across them uncertain", () => {
    expect(asOf(release, "fx_price_index", "2025-12-12")).toMatchObject({ basis: "atlas_observed", capture_gap: { missed_days: 0 } });
    expect(asOf(release, "fx_price_index", "2025-12-13")).toMatchObject({ basis: "uncertain", capture_gap: { missed_days: 1 } });
    expect(asOf(release, "fx_price_index", "2025-12-15")).toMatchObject({
      basis: "uncertain", same_day_release: true,
      capture_gap: { from: "2025-12-11T15:45:00Z", to: "2025-12-15T15:45:00Z", missed_days: 3, changed_across: true },
    });
    expect(last("fx_price_index", "2025-12-15")).toEqual(["2025-11", 109.5, "preliminary"]);
  });
  it("as of the Release's own date the answer is the Release's own state", () => {
    const answer = asOf(release, "fx_price_index", "2026-01-01")!;
    expect(answer.basis).toBe("atlas_observed");
    expect(answer.observations.map((o) => [o.period, o.value, o.status])).toEqual(
      release.series.fx_price_index!.observations.map((o) => [o.period, o.value, o.status]),
    );
    expect(answer.release_id).toBe(release.id);
  });
  it("a Series with the Origin's own record answers on the provider basis", () => {
    expect([asOf(release, "fx_output_quarterly", "2025-08-01")!.basis, last("fx_output_quarterly", "2025-08-01")]).toEqual(["provider", ["2025-Q2", 557.9, "preliminary"]]);
    expect(last("fx_output_quarterly", "2025-09-01")).toEqual(["2025-Q2", 558.3, "final"]);
    // The revision of Q3 is dated only to the day, 28 November: it does not count on that day.
    expect([last("fx_output_quarterly", "2025-11-28"), asOf(release, "fx_output_quarterly", "2025-11-28")!.same_day_release]).toEqual([["2025-Q3", 560.2, "preliminary"], true]);
    expect(last("fx_output_quarterly", "2025-11-29")).toEqual(["2025-Q3", 561.0, "revised"]);
    expect(asOf(release, "fx_output_quarterly", "2022-03-31")).toMatchObject({ basis: "unavailable", observations: [] });
  });
  it("a metadata change is reported as in force at the cutoff", () => {
    const before = asOf(release, "fx_poverty_rate_annual", "2025-12-09")!;
    expect([before.metadata?.metadata.unit, before.metadata?.differs_from_current]).toEqual(["percent of persons", true]);
    const after = asOf(release, "fx_poverty_rate_annual", "2025-12-10")!;
    expect([after.metadata?.metadata.unit, after.metadata?.differs_from_current]).toEqual(["percent of residents", false]);
    // 2012 to 2015 were last asked about on 8 December and are still held under the old unit.
    expect(after.metadata?.other_metadata_periods).toEqual(["2012", "2013", "2014", "2015"]);
    expect(after.observations.map((o) => o.basis)).toEqual([...Array(4).fill("uncertain"), ...Array(10).fill("atlas_observed")]);
    expect(after.basis).toBe("uncertain");
  });
  it("a Series with no vintage file is unavailable as-of any date, and a derived one too", () => {
    for (const key of ["fx_payrolls_break", "fx_price_index_yoy"]) {
      expect(asOf(release, key, "2025-12-20")).toMatchObject({ basis: "unavailable", reason: "no_vintages", observations: [] });
    }
  });
  it("with no date it is the Release's own state, with no basis", () => {
    const answer = asOf(release, "fx_payrolls_break", null)!;
    expect([answer.basis, answer.observations.length]).toEqual([null, 24]);
  });
  it("a Series the Release does not hold has no answer at all: withheld, or unknown", () => {
    expect(asOf(release, "fx_exchange_index", "2025-12-20")).toBeNull();
    expect(asOf(release, "nothing_here", null)).toBeNull();
    expect(asOf(release, "__proto__", null)).toBeNull();
  });
});

describe("a legacy Series (v1's output)", () => {
  const legacy = (generated: string | null): OpenedRelease => ({
    ...release,
    manifest: { ...release.manifest, profile: "local", inputs: [{ path: "data/atlas.json", sha256: "0".repeat(64), generated }, { path: "atlas/series.json", sha256: "1".repeat(64), generated: null }] },
    catalog: { series: release.catalog.series.map((entry) => (entry.key === "fx_permits_stale" ? { ...entry, representation: "legacy_monthly_rounded" as const } : entry)) },
    series: { ...release.series, fx_permits_stale: { ...release.series.fx_permits_stale!, representation: "legacy_monthly_rounded" } },
  });
  it("answers on the legacy basis only for a cutoff after v1 generated it", () => {
    const held = legacy("2025-06-01T09:00:00Z");
    expect(asOf(held, "fx_permits_stale", "2025-06-02")).toMatchObject({ basis: "legacy", observations: { length: 18 } });
    expect(asOf(held, "fx_permits_stale", "2025-06-01")).toMatchObject({ basis: "unavailable", reason: "legacy_held_after_cutoff", observations: [] });
    expect(asOf(held, "fx_permits_stale", "2024-01-01")).toMatchObject({ basis: "unavailable", observations: [] });
  });
  it("is unavailable when the Release does not say when that was", () => {
    expect(asOf(legacy(null), "fx_permits_stale", "2030-01-01")).toMatchObject({ basis: "unavailable", reason: "legacy_not_dated", observations: [] });
  });
});
