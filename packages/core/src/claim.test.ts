/**
 * Claim Readings and their Evidence rows (docs/method/claims.md), tested from that text. Every
 * expected figure is worked out by hand from the values written beside it, or is the shared
 * table's (`checks/claim-cases.json`). All values are invented.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claimDrift, evidenceRow, lockEvidence, readingProblem, type ClaimReading, type ClaimSource, type EvidenceRow, type Figure } from "./claim";
import { periodBounds, type Frequency } from "./period";
import type { RecipeSeries } from "./recipe";
import type { VintageFile, VintageRow } from "./release/types.generated";
import { run } from "./testing";
import { SEMANTICS_VERSION } from "./transform";
import type { ResolveSeries } from "./vintage";

const CASES = JSON.parse(readFileSync(fileURLToPath(new URL("../../../checks/claim-cases.json", import.meta.url)), "utf8"));
const RELEASE = "20260612T000000Z-abcdef0";
const WHOLE = { from: "2024-01-01", to: "2024-06-30" };

const entry = (key: string, freq: Frequency, more: Partial<RecipeSeries> = {}): RecipeSeries => ({
  key, freq, unit: "index, 2020 = 100", unit_kind: "index", measure_kind: "index", agg: "mean", continuity: "discrete", representation: "native",
  rights: { status: "public_domain" }, source: { origin: { producer: "Fixture office", dataset: "levels" }, channel: { via: "direct" } }, ...more,
});
/** January to June 2024: 100, 102, 101, 105, 110, 108. */
const LEVEL = run("monthly", CASES.series.first, CASES.series.values);
function source(series: ResolveSeries[], entries: RecipeSeries[]): ClaimSource {
  const held = new Map(series.map((s) => [s.key, s]));
  return { catalog: new Map(entries.map((e) => [e.key, e])), load: (key) => held.get(key) ?? null, releaseId: RELEASE };
}
const plain = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: LEVEL }], [entry("fx_level", "monthly")]);
const reading = (more: Record<string, unknown>): ClaimReading => ({ id: "r1", series: "fx_level", transform: "lin", ...more }) as ClaimReading;
const latest = (r: ClaimReading, from: ClaimSource = plain): EvidenceRow => evidenceRow(r, from, { state: "latest", asOf: null });
const short = (figures: readonly Figure[]): unknown[][] => figures.map((f) => [f.name, f.value, ...(f.period ? [f.period] : [])]);

describe("the closed list of measures", () => {
  it("value_at is the value of one Period", () => {
    expect(short(latest(reading({ measure: "value_at", period: "2024-04" })).figures)).toEqual([["value", 105, "2024-04"]]);
  });
  it("change is from the first Observation in the window to the last, in the unit and in percent", () => {
    expect(short(latest(reading({ measure: "change", window: WHOLE })).figures)).toEqual([["start", 100, "2024-01"], ["end", 108, "2024-06"], ["change", 8], ["pct_change", 8]]);
  });
  it("extreme is the largest or the smallest value in the window and the Period it fell in", () => {
    expect(short(latest(reading({ measure: "extreme", which: "max", window: WHOLE })).figures)).toEqual([["extreme", 110, "2024-05"], ["n", 6]]);
    expect(short(latest(reading({ measure: "extreme", which: "min", window: WHOLE })).figures)).toEqual([["extreme", 100, "2024-01"], ["n", 6]]);
  });
  it("rank places one Period's value among the window's: 105 is third highest of six, fourth lowest", () => {
    expect(short(latest(reading({ measure: "rank", order: "highest", period: "2024-04", window: WHOLE })).figures)).toEqual([["value", 105, "2024-04"], ["rank", 3], ["of", 6]]);
    expect(short(latest(reading({ measure: "rank", order: "lowest", period: "2024-04", window: WHOLE })).figures)).toEqual([["value", 105, "2024-04"], ["rank", 4], ["of", 6]]);
  });
  it("difference is the second Period less the first", () => {
    expect(short(latest(reading({ measure: "difference", periods: ["2024-02", "2024-05"] })).figures)).toEqual([["a", 102, "2024-02"], ["b", 110, "2024-05"], ["difference", 8]]);
  });
  it("every figure is a number or empty, never true or false", () => {
    for (const accepted of CASES.accepted as ClaimReading[]) {
      if (accepted.freq) continue;
      for (const figure of latest(accepted).figures) expect(figure.value === null || typeof figure.value === "number").toBe(true);
    }
  });
});

describe("what a measure does at the edges", () => {
  it("a tie for the extreme is the earliest Period", () => {
    const tied = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: run("monthly", "2024-01", [5, 9, 9, 3]) }], [entry("fx_level", "monthly")]);
    expect(short(latest(reading({ measure: "extreme", which: "max", window: WHOLE }), tied).figures)).toEqual([["extreme", 9, "2024-02"], ["n", 4]]);
  });
  it("equal values share a rank, and the next rank is skipped", () => {
    const tied = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: run("monthly", "2024-01", [5, 9, 9, 3]) }], [entry("fx_level", "monthly")]);
    expect(short(latest(reading({ measure: "rank", order: "highest", period: "2024-01", window: WHOLE }), tied).figures)).toEqual([["value", 5, "2024-01"], ["rank", 3], ["of", 4]]);
  });
  it("change steps over a missing end and names the Periods it used", () => {
    const gappy = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: run("monthly", "2024-01", [null, 102, 101, null]) }], [entry("fx_level", "monthly")]);
    expect(short(latest(reading({ measure: "change", window: WHOLE }), gappy).figures)).toEqual([["start", 102, "2024-02"], ["end", 101, "2024-03"], ["change", -1], ["pct_change", expect.closeTo(-0.98039215686, 9)]]);
  });
  it("a percent change from zero or below is empty: its sign would mislead", () => {
    const below = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: run("monthly", "2024-01", [-2, 4]) }], [entry("fx_level", "monthly")]);
    const figures = latest(reading({ measure: "change", window: WHOLE }), below).figures;
    expect(short(figures)).toEqual([["start", -2, "2024-01"], ["end", 4, "2024-02"], ["change", 6], ["pct_change", null]]);
    expect(figures[3]!.empty).toBe("start_not_positive");
  });
  it("a Period the Release does not hold is an empty figure, with the reason", () => {
    const figure = latest(reading({ measure: "value_at", period: "2025-01" })).figures[0]!;
    expect([figure.value, figure.period, figure.empty]).toEqual([null, "2025-01", "no_observation"]);
  });
  it("a figure that is an Observation's value carries its Status", () => {
    const early = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: run("monthly", "2024-01", [100, 102], { "2024-02": "preliminary" }) }], [entry("fx_level", "monthly")]);
    expect(latest(reading({ measure: "value_at", period: "2024-02" }), early).figures[0]!.status).toBe("preliminary");
  });
});

describe("transform and frequency come before the measure", () => {
  it("the transform is applied first: February is 2 percent above January", () => {
    const row = latest(reading({ transform: "pch", measure: "value_at", period: "2024-02" }));
    expect(row.figures[0]!.value).toBeCloseTo(2, 9);
  });
  it("a transform that depends on a window is taken over the Reading's window", () => {
    // Rebased to February = 100: May is 100 * 110 / 102.
    const row = latest(reading({ transform: "rebase", measure: "extreme", which: "max", window: { from: "2024-02-01", to: "2024-06-30" } }));
    expect(row.figures[0]!.value).toBeCloseTo(107.8431372549, 9);
    expect(row.figures[0]!.period).toBe("2024-05");
  });
  it("a Reading at a slower frequency is aggregated as the Catalog declares, then measured", () => {
    // Quarterly means: (100 + 102 + 101) / 3 = 101; (105 + 110 + 108) / 3 = 107.666...
    const row = latest(reading({ freq: "quarterly", measure: "difference", periods: ["2024-Q1", "2024-Q2"] }));
    expect(row.figures[0]!.value).toBe(101);
    expect(row.figures[2]!.value).toBeCloseTo(6.6666666667, 9);
  });
  it("a Derived series is computed from what it rests on", () => {
    const change = entry("fx_change", "monthly", { unit: "percent", recipe: { op: "pct_change", inputs: ["fx_level"], order: "aggregate_then_compute", params: { lag: 1 } }, source: { origin: { producer: "Fixture office", dataset: "levels" }, channel: { via: "computed" } } });
    const from = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: LEVEL }], [entry("fx_level", "monthly"), change]);
    const row = latest(reading({ series: "fx_change", measure: "value_at", period: "2024-02" }), from);
    expect(row.figures[0]!.value).toBeCloseTo(2, 9);
    expect(row.unit).toBe("percent");
    expect(row.inputs.map((input) => input.key)).toEqual(["fx_level"]);
  });
});

describe("window sensitivity", () => {
  it("matches the hand-computed table: the declared window and each alternative", () => {
    const { reading: r, expect: want } = CASES.window_sensitivity;
    const row = latest(r);
    const close = (figures: { name: string; value: number; period?: string }[]) =>
      figures.map((f) => [f.name, expect.closeTo(f.value, 9), ...(f.period ? [f.period] : [])]);
    expect(short(row.figures)).toEqual(close(want.figures));
    expect(row.window_sensitivity.map((w) => [w.from, w.to])).toEqual(want.window_sensitivity.map((w: { from: string; to: string }) => [w.from, w.to]));
    row.window_sensitivity.forEach((w, i) => expect(short(w.figures)).toEqual(close(want.window_sensitivity[i].figures)));
  });
  it("a Reading with no alternative window has an empty table", () => {
    expect(latest(reading({ measure: "value_at", period: "2024-04" })).window_sensitivity).toEqual([]);
  });
});

describe("which Readings are Readings", () => {
  it.each((CASES.accepted as ClaimReading[]).map((r) => [r.measure, r] as const))("accepts %s", (_, r) => {
    expect(readingProblem(r, "monthly")).toBeNull();
  });
  it.each((CASES.refused as { why: string; reading: ClaimReading }[]).map((c) => [c.why, c.reading] as const))("refuses %s", (_, r) => {
    expect(readingProblem(r, "monthly")).toEqual(expect.any(String));
  });
});

// --- the three rows ------------------------------------------------------------------------------

const hash = "1".padEnd(64, "0");
function vrow(period: string, value: number | null, status: VintageRow["status"], from: string, to: string | null): VintageRow {
  const bounds = periodBounds("monthly", period)!;
  return { period, period_start: bounds.start, period_end: bounds.end, value, status, deleted: false, recorded_from: from, recorded_to: to,
    provider_from: null, provider_to: null, provider_precision: null, channel: "direct", metadata: hash };
}
// Captures at 10:45 New York time. 9 June: February 100.4 preliminary. 10 June: February is revised to 100.6.
const C1 = "2026-06-09T14:45:00Z";
const C2 = "2026-06-10T14:45:00Z";
const C3 = "2026-06-11T14:45:00Z";
const vintages: VintageFile = {
  key: "fx_level", freq: "monthly", representation: "native", provider_coverage: null,
  metadata: [{ hash, recorded_from: C1, metadata: { name: "Fixture level", unit: "index, 2020 = 100", source: { origin: { producer: "Fixture office", dataset: "levels", origin_id: "FX1", url: null }, channel: { via: "direct" } }, rights: null } }],
  captures: [C1, C2, C3].map((at, i) => ({ retrieved_at: at, scope: ["2026-01-01", "2026-12-31"] as [string, string], change: (["first", "revision", "none"] as const)[i]! })),
  rows: [vrow("2026-01", 100, "final", C1, null), vrow("2026-02", 100.4, "preliminary", C1, C2), vrow("2026-02", 100.6, "final", C2, null)],
};
const NOW = run("monthly", "2026-01", [100, 100.6]);
const watched = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: NOW, vintages }], [entry("fx_level", "monthly")]);
const FEB = reading({ measure: "change", window: { from: "2026-01-01", to: "2026-02-28" } });

describe("the three Evidence rows", () => {
  it("then is what was public before the Cutoff, with its Basis", () => {
    const row = evidenceRow(FEB, watched, { state: "then", asOf: "2026-06-10" });
    expect(short(row.figures)).toEqual([["start", 100, "2026-01"], ["end", 100.4, "2026-02"], ["change", expect.closeTo(0.4, 9)], ["pct_change", expect.closeTo(0.4, 9)]]);
    expect([row.state, row.as_of, row.basis, row.cutoff?.instant]).toEqual(["then", "2026-06-10", "atlas_observed", "2026-06-10T04:00:00Z"]);
    expect(row.figures[1]!.status).toBe("preliminary");
    expect(row.inputs).toEqual([expect.objectContaining({ key: "fx_level", basis: "atlas_observed", last_capture: C3 })]);
    expect([row.release_id, row.semantics_version]).toEqual([RELEASE, SEMANTICS_VERSION]);
  });
  it("a Claim with a time is cut off at that instant", () => {
    const row = evidenceRow(FEB, watched, { state: "then", asOf: "2026-06-10T15:00:00Z" });
    expect(row.figures[1]!.value).toBe(100.6);
    expect(row.cutoff?.precision).toBe("datetime");
  });
  it("before anything was captured there is no answer, and today's figure never stands in", () => {
    const row = evidenceRow(FEB, watched, { state: "then", asOf: "2026-06-01" });
    expect([row.basis, row.unavailable?.reason, row.figures]).toEqual(["unavailable", "no_coverage", []]);
  });
  it("latest is the Release's own state and claims no Basis", () => {
    const row = evidenceRow(FEB, watched, { state: "latest", asOf: null });
    expect([row.state, row.as_of, row.basis, row.cutoff, row.figures[1]!.value]).toEqual(["latest", null, null, null, 100.6]);
  });
});

describe("what a lock is computed from", () => {
  const spec = { said_on: "2026-06-10", checked_on: "2026-06-12", readings: [FEB] };
  it("each Reading gets a then row and a now-when-checked row, and says what it resolved to", () => {
    const evidence = lockEvidence(spec, watched);
    if (!evidence.ok) throw new Error(evidence.message);
    expect(evidence.semantics_version).toBe(SEMANTICS_VERSION);
    const [first] = evidence.readings;
    expect([first!.id, first!.series, first!.freq, first!.unit, first!.recipe]).toEqual(["r1", "fx_level", "monthly", "index, 2020 = 100", null]);
    expect(first!.then.figures[1]!.value).toBe(100.4);
    expect(first!.now_when_checked.figures[1]!.value).toBe(100.6);
    expect([first!.then.state, first!.now_when_checked.state]).toEqual(["then", "now_when_checked"]);
    expect(evidence.rights_used).toEqual([{ origin: "Fixture office", dataset: "levels", channel: "direct", representation: "native" }]);
  });
  it("names the recipe of a Derived series", () => {
    const recipe = { op: "pct_change" as const, inputs: ["fx_level"], order: "aggregate_then_compute" as const, params: { lag: 1 } };
    const from = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: NOW, vintages }],
      [entry("fx_level", "monthly"), entry("fx_change", "monthly", { unit: "percent", recipe, source: { origin: { producer: "Fixture office", dataset: "levels" }, channel: { via: "computed" } } })]);
    const evidence = lockEvidence({ ...spec, readings: [reading({ series: "fx_change", measure: "value_at", period: "2026-02" })] }, from);
    if (!evidence.ok) throw new Error(evidence.message);
    expect(evidence.readings[0]!.recipe).toEqual({ key: "fx_change", recipe, rests_on: ["fx_level"] });
    expect(evidence.readings[0]!.then.figures[0]!.value).toBeCloseTo(0.4, 9);
    expect(evidence.rights_used.map((row) => row.channel)).toEqual(["computed", "direct"]);
  });
  it("refuses a legacy-representation Series, and a Derived series that rests on one", () => {
    const legacy = entry("fx_level", "monthly", { representation: "legacy_monthly_rounded" });
    const refused = lockEvidence(spec, source([{ key: "fx_level", freq: "monthly", representation: "legacy_monthly_rounded", observations: NOW }], [legacy]));
    expect([refused.ok, !refused.ok && refused.reason]).toEqual([false, "legacy_representation"]);
    const change = entry("fx_change", "monthly", { recipe: { op: "pct_change", inputs: ["fx_level"], order: "aggregate_then_compute", params: { lag: 1 } } });
    const rests = lockEvidence({ ...spec, readings: [reading({ series: "fx_change", measure: "value_at", period: "2026-02" })] }, source([], [legacy, change]));
    expect([rests.ok, !rests.ok && rests.reason]).toEqual([false, "legacy_representation"]);
  });
  it("refuses a Series the Release does not hold, a bad Reading, and one the Release cannot measure now", () => {
    const reasons = (readings: ClaimReading[]) => { const e = lockEvidence({ ...spec, readings }, watched); return e.ok ? "ok" : e.reason; };
    expect(reasons([reading({ series: "nowhere", measure: "value_at", period: "2026-02" })])).toBe("unknown_series");
    expect(reasons([reading({ measure: "value_at" })])).toBe("bad_reading");
    expect(reasons([reading({ measure: "value_at", period: "2026-02" }), reading({ measure: "value_at", period: "2026-01" })])).toBe("bad_reading"); // one id twice
    expect(reasons([reading({ transform: "pc1", measure: "value_at", period: "2026-02" })])).toBe("not_measurable"); // no year earlier
    expect(reasons([])).toBe("no_readings");
  });
});

describe("drift", () => {
  const spec = { said_on: "2026-06-10", checked_on: "2026-06-12", readings: [FEB] };
  const locked = (() => { const e = lockEvidence(spec, watched); if (!e.ok) throw new Error(e.message); return e.readings[0]!; })();
  it("is empty when the latest figures are the locked ones", () => {
    expect(claimDrift(locked, evidenceRow(FEB, watched, { state: "latest", asOf: null }), evidenceRow(FEB, watched, { state: "then", asOf: "2026-06-10" }))).toEqual([]);
  });
  it("names each figure a Revision moved since the Claim was checked", () => {
    const revised = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: run("monthly", "2026-01", [100, 100.9]), vintages }], [entry("fx_level", "monthly")]);
    const drift = claimDrift(locked, evidenceRow(FEB, revised, { state: "latest", asOf: null }), evidenceRow(FEB, revised, { state: "then", asOf: "2026-06-10" }));
    expect(drift.map((d) => [d.kind, d.window, d.figure, d.locked, d.now])).toEqual([
      ["latest_differs", null, "end", 100.6, 100.9],
      ["latest_differs", null, "change", expect.closeTo(0.6, 9), expect.closeTo(0.9, 9)],
      ["latest_differs", null, "pct_change", expect.closeTo(0.6, 9), expect.closeTo(0.9, 9)],
    ]);
  });
  it("says when the then row, computed again on this Release, is no longer the locked one", () => {
    const rewritten: VintageFile = { ...vintages, rows: [vintages.rows[0]!, vrow("2026-02", 100.5, "preliminary", C1, C2), vintages.rows[2]!] };
    const other = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: NOW, vintages: rewritten }], [entry("fx_level", "monthly")]);
    const drift = claimDrift(locked, evidenceRow(FEB, other, { state: "latest", asOf: null }), evidenceRow(FEB, other, { state: "then", asOf: "2026-06-10" }));
    expect(drift.map((d) => [d.kind, d.figure])).toEqual([["then_differs", "end"], ["then_differs", "change"], ["then_differs", "pct_change"]]);
  });
  it("says when the then row can no longer be computed at all", () => {
    const bare = source([{ key: "fx_level", freq: "monthly", representation: "native", observations: NOW }], [entry("fx_level", "monthly")]);
    const drift = claimDrift(locked, evidenceRow(FEB, bare, { state: "latest", asOf: null }), evidenceRow(FEB, bare, { state: "then", asOf: "2026-06-10" }));
    expect(drift).toEqual([expect.objectContaining({ kind: "then_differs", figure: null, locked: null, now: null })]);
  });
});
