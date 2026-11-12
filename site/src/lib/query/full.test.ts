/**
 * Query, in full (PLAN 4.2, 4.5 and M17): one request shape that can also ask for a slower
 * frequency and for what was known before a date, answered in the engine's order (resolve the
 * Vintage, aggregate, transform), behind the rights gate and three caps. Tested through
 * `query()` and `vintageTable()` on the synthetic fixture release.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createRightsGate } from "@macro-atlas/core";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { addRelease, FIXTURE_ROOT, fixtureRegister, promote, tempRoot } from "../release/testing";
import { query, vintageTable, type QueryAnswer } from "./index";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const base = { series: ["fx_price_index"], transform: "lin", permission: "display" };
function ask(request: object, options: Parameters<typeof query>[3] = {}): QueryAnswer {
  const answer = query(release, "local", { ...base, ...request }, options);
  if (!answer.ok) throw new Error(`${answer.status} ${answer.message}`);
  return answer;
}
const values = (answer: QueryAnswer, at = 0) => {
  const result = answer.series[at]!.result;
  if (!result.ok) throw new Error(result.message);
  return result.observations.map((o) => [o.period, o.value]);
};

describe("what was known before a date", () => {
  it("answers with the Vintage held before the Cutoff, its Basis, the Capture gap and the same-day flag", () => {
    const answer = ask({ as_of: "2025-12-13" });
    const [series] = answer.series;
    expect(series!.vintage).toMatchObject({
      as_of: "2025-12-13",
      basis: "uncertain",
      cutoff: { instant: "2025-12-13T05:00:00Z", day: "2025-12-13", precision: "date" },
      capture_gap: { from: "2025-12-11T15:45:00Z", to: "2025-12-15T15:45:00Z", missed_days: 1, changed_across: true },
      same_day_release: false,
    });
    // November as first held on 10 December, before its revision on the 15th; December not yet seen.
    expect(values(answer).slice(-2)).toEqual([["2025-10", 109], ["2025-11", 109.5]]);
    expect(answer.request.as_of).toBe("2025-12-13");
  });

  it("gives each Observation its own evidence when the Series is answered as it is", () => {
    const answer = ask({ as_of: "2025-12-11", from: "2025-11-01" });
    expect(answer.series[0]!.vintage!.basis).toBe("atlas_observed");
    expect(answer.series[0]!.vintage!.evidence).toEqual([
      { period: "2025-11", basis: "atlas_observed", known_from: "2025-12-10T15:45:00Z", known_by: "atlas", last_checked: "2025-12-10T15:45:00Z" },
    ]);
  });

  it("claims the weakest Basis among the Periods the answer used, not the whole Series' (ADR 0024)", () => {
    // 2012 to 2015 were not asked about again and are uncertain; later years are Atlas-observed.
    expect(ask({ series: ["fx_poverty_rate_annual"], as_of: "2025-12-20" }).series[0]!.vintage!.basis).toBe("uncertain");
    expect(ask({ series: ["fx_poverty_rate_annual"], as_of: "2025-12-20", from: "2018-01-01" }).series[0]!.vintage!.basis).toBe("atlas_observed");
    // A change from a year earlier looks back one Period: 2016 rests on 2015.
    const changed = ask({ series: ["fx_poverty_rate_annual"], as_of: "2025-12-20", from: "2016-01-01", transform: "ch1" });
    expect(changed.series[0]!.vintage!.basis).toBe("uncertain");
  });

  /** The fixture, except that the Capture of 11 December asked only about Periods from `from` on. */
  async function narrowedOn11th(id: string, from: string): Promise<OpenedRelease> {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const root = tempRoot();
    const dir = addRelease(root, { id });
    const path = `${dir}/vintages/fx_price_index.json`;
    const file = JSON.parse(readFileSync(path, "utf8"));
    for (const capture of file.captures) if (capture.retrieved_at.startsWith("2025-12-11")) capture.scope = [from, "2025-12-31"];
    writeFileSync(path, JSON.stringify(file, null, 1) + "\n");
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
    manifest.series.fx_price_index.vintages_sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + "\n");
    promote(root, id);
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    return opened.release;
  }
  const basisOf = (of: OpenedRelease, request: object) => {
    const answer = query(of, "local", { ...base, as_of: "2025-12-12", ...request });
    if (!answer.ok) throw new Error(answer.message);
    return answer.series[0]!.vintage!.basis;
  };

  it("a change from the Period before rests on that Period only, not on a year of them", async () => {
    // As of the 12th the last Capture is the 11th's, a day before: Periods it asked about
    // (October on) are Atlas-observed; September and earlier were last asked about on the 10th,
    // with the 11th unseen for them, and are uncertain.
    const of = await narrowedOn11th("20260201T000000Z-4444444", "2025-10-01");
    expect(basisOf(of, {})).toBe("uncertain");
    expect(basisOf(of, { from: "2025-11-01" })).toBe("atlas_observed");
    expect(basisOf(of, { from: "2025-11-01", transform: "chg" })).toBe("atlas_observed"); // November beside October
    expect(basisOf(of, { from: "2025-10-01", transform: "chg" })).toBe("uncertain"); // October beside September
    expect(basisOf(of, { from: "2025-11-01", transform: "pc1" })).toBe("uncertain"); // November beside November 2024
    expect(basisOf(of, { from: "2025-10-01", freq: "quarterly" })).toBe("atlas_observed"); // the quarter's own months
    expect(basisOf(of, { from: "2025-10-01", freq: "quarterly", transform: "chg" })).toBe("uncertain"); // beside the third quarter's
  });

  it("a Derived series claims the Basis of the Periods its Recipe used, input by input", async () => {
    // Here only the first half of 2024 went unasked on the 11th.
    const of = await narrowedOn11th("20260201T000000Z-5555555", "2024-07-01");
    const yoy = { series: ["fx_price_index_yoy"] };
    expect(basisOf(of, yoy)).toBe("uncertain"); // the whole Series rests on all of 2024
    expect(basisOf(of, { ...yoy, from: "2025-11-01" })).toBe("atlas_observed"); // November 2025 beside November 2024
    expect(basisOf(of, { ...yoy, from: "2025-02-01", to: "2025-03-31" })).toBe("uncertain"); // beside February and March 2024
    expect(basisOf(of, { ...yoy, from: "2025-08-01", transform: "z" })).toBe("atlas_observed"); // August on, beside August 2024 on
    expect(basisOf(of, { ...yoy, from: "2025-05-01", transform: "z" })).toBe("uncertain"); // May and June rest on May and June 2024
  });

  it("reports the metadata in force then, and keeps Periods held under other metadata out of arithmetic", () => {
    const plain = ask({ series: ["fx_poverty_rate_annual"], as_of: "2025-12-20" });
    expect(plain.series[0]!.vintage!.metadata).toMatchObject({ unit: "percent of residents", differs_from_current: false, other_metadata_periods: ["2012", "2013", "2014", "2015"] });
    expect(plain.series[0]!.vintage!.left_out_periods).toEqual([]);
    expect(values(plain)[0]).toEqual(["2012", 15]);
    const changed = ask({ series: ["fx_poverty_rate_annual"], as_of: "2025-12-20", transform: "chg" });
    expect(changed.series[0]!.vintage!.left_out_periods).toEqual(["2012", "2013", "2014", "2015"]);
    // 2016 has nothing comparable before it; 2017 is 12.3 - 12.7.
    expect(values(changed).slice(4, 6)).toEqual([["2016", null], ["2017", expect.closeTo(-0.4, 9)]]);
  });

  it("an answer on the Origin's own record says so", () => {
    const answer = ask({ series: ["fx_output_quarterly"], as_of: "2025-11-20" });
    expect(answer.series[0]!.vintage).toMatchObject({ basis: "provider", capture_gap: null });
    expect(values(answer).at(-1)).toEqual(["2025-Q3", 560.2]);
  });

  it("a Derived series is computed from each input's own Vintage and claims the weakest Basis", () => {
    const answer = ask({ series: ["fx_price_index_yoy"], as_of: "2025-12-11" });
    expect(answer.series[0]!.vintage!.basis).toBe("atlas_observed");
    expect(values(answer).at(-1)![0]).toBe("2025-11");
    expect(values(answer).at(-1)![1]).toBeCloseTo(5.187319884726227, 12);
  });

  it("no coverage is an unavailable answer that holds no Observation, never today's figures", () => {
    for (const [key, date, reason] of [["fx_price_index", "2025-12-01", "no_coverage"], ["fx_vote_margin", "2025-12-20", "no_vintages"]] as const) {
      const answer = ask({ series: [key], as_of: date });
      expect(answer.series[0]!.vintage).toMatchObject({ basis: "unavailable", reason });
      expect(values(answer)).toEqual([]);
      expect(answer.rows).toBe(0);
    }
  });

  it.each([["a month", "2025-12"], ["a date that is not one", "2025-02-30"], ["a year before 1900", "1899-12-31"], ["a number", 20251213]])("refuses %s as an as-of question with 400", (_, as_of) => {
    expect(query(release, "local", { ...base, as_of })).toMatchObject({ ok: false, status: 400, code: "bad_request" });
  });

  it("without an as-of question there is no Basis", () => {
    expect(ask({}).series[0]!.vintage).toBeNull();
  });
});

describe("the Basis never claims more than the Periods used allow", () => {
  it("a year earlier means the whole month a year earlier, the 29th of February included", () => {
    // Daily values for February 2024 and February 2025; only 29 February 2024 was last asked about a day early.
    const day = (date: string, value: number) => ({ period: date, period_start: date, period_end: date, value, status: "final" });
    const dates = (year: number, last: number) => Array.from({ length: last }, (_, i) => `${year}-02-${String(i + 1).padStart(2, "0")}`);
    const feb24 = dates(2024, 29);
    const feb25 = dates(2025, 28);
    const row = (date: string, from: string) => ({ ...day(date, 100), deleted: false, recorded_from: from, recorded_to: null, provider_from: null, provider_to: null, provider_precision: null, channel: "fixture", metadata: "m" });
    const entry = { ...release.catalog.series.find((e) => e.key === "fx_price_index")!, key: "fx_daily", freq: "daily" as const };
    const metadata = [{ hash: "m", recorded_from: "2025-03-01T12:00:00Z", metadata: { name: "d", unit: "u", source: entry.source, rights: null } }];
    const captures = [
      { retrieved_at: "2025-03-01T12:00:00Z", scope: ["2024-02-01", "2025-02-28"], change: "first" },
      { retrieved_at: "2025-03-02T12:00:00Z", scope: ["2024-02-01", "2025-02-28"], change: "none" },
      // The last Capture before the Cutoff did not ask about the 29th.
      { retrieved_at: "2025-03-03T12:00:00Z", scope: ["2024-02-01", "2024-02-28"], change: "none" },
      { retrieved_at: "2025-03-03T12:01:00Z", scope: ["2025-02-01", "2025-02-28"], change: "none" },
    ];
    const made = {
      ...release,
      catalog: { series: [...release.catalog.series, entry] },
      series: { ...release.series, fx_daily: { key: "fx_daily", freq: "daily", representation: "native", observations: [...feb24, ...feb25].map((d) => day(d, 100)) } },
      vintages: { ...release.vintages, fx_daily: { key: "fx_daily", freq: "daily", representation: "native", provider_coverage: null, metadata, captures, rows: [...feb24, ...feb25].map((d) => row(d, "2025-03-01T12:00:00Z")) } },
    } as unknown as OpenedRelease;
    const basis = (request: object) => {
      const answer = query(made, "local", { series: ["fx_daily"], transform: "lin", permission: "display", as_of: "2025-03-04", ...request });
      if (!answer.ok) throw new Error(answer.message);
      return answer.series[0]!.vintage!.basis;
    };
    expect(basis({ from: "2025-02-01" })).toBe("atlas_observed");
    expect(basis({ from: "2024-02-29", to: "2024-02-29" })).toBe("uncertain");
    // February 2025 beside February 2024, whose mean includes the 29th.
    expect(basis({ from: "2025-02-01", transform: "pc1" })).toBe("uncertain");
    expect(basis({ from: "2025-02-01", freq: "monthly", transform: "ch1" })).toBe("uncertain");
  });
});

describe("a slower frequency", () => {
  it("combines by the Series' declared rule, then transforms (PLAN 4.5)", () => {
    const answer = ask({ freq: "quarterly", from: "2025-01-01" });
    expect(answer.series[0]).toMatchObject({ freq: "monthly", answered_freq: "quarterly", aggregated: { from: "monthly", to: "quarterly", method: "mean" } });
    const q = values(answer);
    expect(q.map(([period]) => period)).toEqual(["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]);
    const monthly = values(ask({ from: "2025-10-01" })).map(([, v]) => v as number);
    expect(q.at(-1)![1]).toBeCloseTo((monthly[0]! + monthly[1]! + monthly[2]!) / 3, 12);
    // The transform is applied to the quarters: a change from the quarter before.
    const changed = values(ask({ freq: "quarterly", transform: "chg", from: "2025-07-01" }));
    expect(changed.at(-1)![1]).toBeCloseTo((q[3]![1] as number) - (q[2]![1] as number), 12);
  });

  it("takes a rule named in the request only if the Measure kind allows it", () => {
    const last = ask({ freq: "quarterly", agg: "last", from: "2025-10-01" });
    expect(last.series[0]!.aggregated).toMatchObject({ method: "last" });
    expect(values(last).at(-1)).toEqual(["2025-Q4", 109.9]);
    const summed = ask({ freq: "quarterly", agg: "sum" });
    expect(summed.series[0]!.result).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
  });

  it("says why a Series cannot be brought there, for that Series only", () => {
    const answer = ask({ series: ["fx_output_quarterly", "fx_vote_margin", "fx_price_index"], freq: "quarterly" });
    expect(answer.series[0]).toMatchObject({ answered_freq: "quarterly", aggregated: null });
    expect(answer.series[1]!.result).toMatchObject({ ok: false, reason: "no_cadence" });
    expect(answer.series[2]!.result.ok).toBe(true);
    expect(ask({ series: ["fx_poverty_rate_annual"], freq: "monthly" }).series[0]!.result).toMatchObject({ ok: false, reason: "not_slower" });
  });

  it("resolves the Vintage first: quarters of what was known then", () => {
    const then = values(ask({ freq: "quarterly", as_of: "2025-12-13", from: "2025-10-01" }));
    // October and November only: the quarter is under way.
    expect(then).toEqual([["2025-Q4", expect.closeTo((109 + 109.5) / 2, 12)]]);
    const answer = ask({ freq: "quarterly", as_of: "2025-12-13", from: "2025-10-01" });
    const result = answer.series[0]!.result;
    expect(result.ok && result.observations[0]!.status).toBe("partial");
    expect(answer.series[0]!.vintage!.evidence).toBeNull();
  });

  it.each([["an unknown frequency", { freq: "hourly" }], ["irregular", { freq: "irregular" }], ["an unknown rule", { agg: "median" }]])("refuses %s with 400", (_, extra) => {
    expect(query(release, "local", { ...base, ...extra })).toMatchObject({ ok: false, status: 400, code: "bad_request" });
  });
});

describe("history is values: the gate hears of everything the past came through (ADR 0024)", () => {
  const sign = (decision: { display: boolean; redistribute: boolean }) => createRightsGate(fixtureRegister(decision));

  it("a display-only Series is answered for display and refused for redistribution, with the gate's reason", () => {
    const gate = sign({ display: true, redistribute: false });
    expect(query(release, "staging", base, { gate })).toMatchObject({ ok: true });
    const refused = query(release, "staging", { ...base, permission: "redistribute" }, { gate });
    expect(refused).toMatchObject({ ok: false, status: 403, code: "not_permitted" });
    expect(!refused.ok && refused.message).toContain("does not allow redistribute");
    expect(JSON.stringify(refused)).not.toMatch(/"value"|observations/);
  });

  it("an as-of answer and the vintage table are refused when a past Source is not permitted, while today's values still answer", async () => {
    // The same Release, but the history of one Series says it once came through another Origin.
    const root = tempRoot();
    const dir = addRelease(root, { id: "20260201T000000Z-1111111" });
    const { readFileSync, writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const path = `${dir}/vintages/fx_price_index.json`;
    const file = JSON.parse(readFileSync(path, "utf8"));
    const earlier = structuredClone(file.metadata[0]);
    earlier.metadata.source.origin.producer = "Some Other Origin (synthetic)";
    earlier.hash = "0".repeat(64);
    earlier.recorded_from = "2025-12-07T00:00:00Z";
    file.metadata.unshift(earlier);
    writeFileSync(path, JSON.stringify(file, null, 1) + "\n");
    const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
    manifest.series.fx_price_index.vintages_sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + "\n");
    promote(root, "20260201T000000Z-1111111");
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);

    const gate = sign({ display: true, redistribute: true });
    expect(query(opened.release, "staging", base, { gate })).toMatchObject({ ok: true });
    for (const key of ["fx_price_index", "fx_price_index_yoy"]) {
      const then = query(opened.release, "staging", { ...base, series: [key], as_of: "2025-12-13" }, { gate });
      expect(then, key).toMatchObject({ ok: false, status: 403, code: "not_permitted" });
      expect(!then.ok && then.message).toContain("Some Other Origin");
    }
    expect(vintageTable(opened.release, "staging", "fx_price_index", { gate })).toMatchObject({ ok: false, status: 403 });
    expect(vintageTable(release, "staging", "fx_price_index", { gate })).toMatchObject({ ok: true });
  });
});

describe("the vintage table: every version a Release holds of each Period", () => {
  it("lists versions in Period order with both clocks kept apart", () => {
    const table = vintageTable(release, "local", "fx_price_index");
    if (!table.ok || table.held === false) throw new Error("no table");
    const november = table.versions.filter((v) => v.period === "2025-11");
    expect(november).toEqual([
      { period: "2025-11", period_start: "2025-11-01", period_end: "2025-11-30", value: 109.5, status: "preliminary", withdrawn: false, held_from: "2025-12-10T15:45:00Z", held_to: "2025-12-15T15:45:00Z", published: null, published_precision: null, superseded: null, current: false },
      { period: "2025-11", period_start: "2025-11-01", period_end: "2025-11-30", value: 109.3, status: "final", withdrawn: false, held_from: "2025-12-15T15:45:00Z", held_to: null, published: null, published_precision: null, superseded: null, current: true },
    ]);
    expect(table.captures).toMatchObject({ count: 21, first: "2025-12-08T15:45:00Z", missed_days: ["2025-12-12", "2025-12-13", "2025-12-14"] });
    expect(table.revised_periods).toEqual(["2025-10", "2025-11"]);
    const provider = vintageTable(release, "local", "fx_output_quarterly");
    if (!provider.ok || provider.held === false) throw new Error("no table");
    expect(provider.provider_coverage).toEqual({ from: "2022-04-01T00:00:00Z", to: "2025-12-08T00:00:00Z" });
    expect(provider.versions.at(-2)).toMatchObject({ period: "2025-Q3", value: 561, published: "2025-11-28", published_precision: "date" });
    expect(provider.versions.at(-1)).toMatchObject({ period: "2025-Q4", published: "2025-12-05T13:30:00Z", published_precision: "datetime" });
  });

  it("can be narrowed to the history of one Period", () => {
    const table = vintageTable(release, "local", "fx_price_index", { period: "2025-10" });
    expect(table.ok && table.held !== false && table.versions.map((v) => v.value)).toEqual([109.2, 109]);
  });

  it("says when a Release holds no history for a Series, and refuses what the gate refuses", () => {
    expect(vintageTable(release, "local", "fx_vote_margin")).toMatchObject({ ok: true, held: false, why: "no_vintages" });
    expect(vintageTable(release, "local", "fx_price_index_yoy")).toMatchObject({ ok: true, held: false, why: "derived" });
    expect(vintageTable(release, "local", "fx_exchange_index")).toMatchObject({ ok: false, status: 403, code: "withheld" });
    expect(vintageTable(release, "production", "fx_price_index")).toMatchObject({ ok: false, status: 403, code: "not_permitted" });
    expect(vintageTable(release, "local", "nope")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("caps (PLAN 4.2): rows, the work behind them, and time", () => {
  it("refuses an answer that takes longer than its time, even one that finished", () => {
    let now = 0;
    const answer = query(release, "local", base, { maxMs: 50, clock: () => (now += 40) });
    expect(answer).toMatchObject({ ok: false, status: 503, code: "too_slow" });
    expect(JSON.stringify(answer)).not.toMatch(/"value"|observations/);
  });

  it("refuses to read a history longer than the cap", () => {
    expect(query(release, "local", { ...base, as_of: "2025-12-13" }, { maxVintageRows: 5 })).toMatchObject({ ok: false, status: 422, code: "too_large" });
    expect(vintageTable(release, "local", "fx_price_index", { maxVintageRows: 5 })).toMatchObject({ ok: false, status: 422, code: "too_large" });
  });

  it("reading a history has the same limit on time", () => {
    let now = 0;
    const table = vintageTable(release, "local", "fx_price_index", { maxMs: 50, clock: () => (now += 40) });
    expect(table).toMatchObject({ ok: false, status: 503, code: "too_slow" });
    expect(JSON.stringify(table)).not.toMatch(/"value"|versions/);
  });
});
