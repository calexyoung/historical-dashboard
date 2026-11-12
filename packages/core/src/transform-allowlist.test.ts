/**
 * The rest of the transform allowlist (docs/method/transforms.md: "The four that compare with
 * an earlier Observation", "Daily and weekly Series", "Partial periods"), tested from that
 * text. Every expected value is worked out by hand.
 */
import { describe, expect, it } from "vitest";
import { nextPeriod, periodBounds, type Frequency } from "./period";
import { run } from "./testing";
import { SEMANTICS_VERSION, transform, TRANSFORMS, type TransformSeries } from "./transform";

const of = (freq: Frequency, first: string, values: (number | null)[], statuses: Record<string, string> = {}): TransformSeries => ({
  freq, continuity: "discrete", observations: run(freq, first, values, statuses),
});
const rows = (result: ReturnType<typeof transform>): [string, number | null, string?][] => {
  if (!result.ok) throw new Error(`unavailable: ${result.reason}`);
  return result.observations.map((o) => (o.value === null ? [o.period, null, o.empty] : [o.period, o.value]));
};
const near = (got: [string, number | null, string?][], want: [string, number | null, string?][]): void => {
  expect(got.map((r) => r[0])).toEqual(want.map((r) => r[0]));
  got.forEach((row, i) => {
    if (want[i]![1] === null) expect(row.slice(1)).toEqual(want[i]!.slice(1));
    else expect(row[1]).toBeCloseTo(want[i]![1]!, 9);
  });
};

/** Working days from `first` to `last`, each valued by its month. */
function workingDays(first: string, last: string, valueOf: (month: string) => number): TransformSeries["observations"] {
  const out = [];
  for (let label: string | null = first; label !== null && label <= last; label = nextPeriod("business_daily", label)) {
    const bounds = periodBounds("business_daily", label)!;
    out.push({ period: label, period_start: bounds.start, period_end: bounds.end, value: valueOf(label.slice(0, 7)), status: "final" });
  }
  return out;
}

describe("the allowlist", () => {
  it("is FRED's names plus v1's drawdown, and adding to it raised the semantics version", () => {
    expect(TRANSFORMS).toEqual(["lin", "chg", "ch1", "pch", "pc1", "pca", "log", "rebase", "z", "drawdown"]);
    expect(SEMANTICS_VERSION).toBe("0.8.0");
  });
});

describe("chg, pch, ch1 and pca", () => {
  it("chg is the change from the Observation before", () => {
    near(rows(transform(of("monthly", "2024-01", [100, 102, 101, null, 105]), "chg")), [
      ["2024-01", null, "no_earlier"],
      ["2024-02", 2],
      ["2024-03", -1],
      ["2024-04", null, "missing"],
      ["2024-05", null, "no_earlier"],
    ]);
  });

  it("pch is the percent change from the Observation before", () => {
    near(rows(transform(of("monthly", "2024-01", [100, 110, 99, 0, 5]), "pch")), [
      ["2024-01", null, "no_earlier"],
      ["2024-02", 10],
      ["2024-03", -10],
      ["2024-04", -100],
      ["2024-05", null, "zero_earlier"],
    ]);
  });

  it("ch1 is the change from a year earlier", () => {
    near(rows(transform(of("quarterly", "2023-Q1", [1, 2, 3, 4, 6, 8]), "ch1")), [
      ["2023-Q1", null, "no_year_earlier"],
      ["2023-Q2", null, "no_year_earlier"],
      ["2023-Q3", null, "no_year_earlier"],
      ["2023-Q4", null, "no_year_earlier"],
      ["2024-Q1", 5],
      ["2024-Q2", 6],
    ]);
    const result = transform(of("quarterly", "2023-Q1", [1, 2, 3, 4, 6, 8]), "ch1");
    expect(result.ok && result.reference).toEqual({ kind: "ch1", lag: 4 });
  });

  it("pca compounds one Period's change over a year", () => {
    // 1.01 to the 12th is 1.126825030131969...; 1.02 to the 4th is 1.08243216; a year is a year.
    near(rows(transform(of("monthly", "2024-01", [100, 101]), "pca")), [["2024-01", null, "no_earlier"], ["2024-02", 12.6825030131969]]);
    near(rows(transform(of("quarterly", "2024-Q1", [100, 102]), "pca")), [["2024-Q1", null, "no_earlier"], ["2024-Q2", 8.243216]]);
    near(rows(transform(of("annual", "2023", [100, 105]), "pca")), [["2023", null, "no_earlier"], ["2024", 5]]);
    const result = transform(of("quarterly", "2024-Q1", [100, 102]), "pca");
    expect(result.ok && result.reference).toEqual({ kind: "pca", periods_per_year: 4 });
  });

  it("they read the Observation before the window", () => {
    const s = of("monthly", "2024-01", [100, 102, 101]);
    near(rows(transform(s, "chg", { from: "2024-02-01" })), [["2024-02", 2], ["2024-03", -1]]);
  });

  it("an irregular Series has an Observation before, but no year earlier and no Periods per year", () => {
    const s: TransformSeries = { freq: "irregular", continuity: "held", observations: run("irregular", "", [3.9, 2.1, 4.5], {}, ["2012-11-06", "2016-11-08", "2020-11-03"]) };
    near(rows(transform(s, "chg")), [["2012-11-06", null, "no_earlier"], ["2016-11-08", -1.8], ["2020-11-03", 2.4]]);
    expect(transform(s, "ch1")).toMatchObject({ ok: false, reason: "frequency_not_supported" });
    expect(transform(s, "pca")).toMatchObject({ ok: false, reason: "frequency_not_supported" });
  });

  it("are refused where the catalog does not offer them", () => {
    expect(transform({ ...of("monthly", "2024-01", [1, 2]), allowed: ["lin", "z"] }, "pch")).toMatchObject({ ok: false, reason: "not_offered" });
  });
});

describe("daily and weekly Series", () => {
  // 100 on every working day of June 2023, 110 from July 2023 to May 2024, 121 in June 2024.
  const level = (month: string): number => (month === "2023-06" ? 100 : month === "2024-06" ? 121 : 110);
  const daily: TransformSeries = { freq: "business_daily", continuity: "discrete", measure_kind: "rate", agg: "mean", observations: workingDays("2023-06-01", "2024-06-28", level) };

  it("pc1 and ch1 are taken on months: the Series is brought to monthly first", () => {
    const pc1 = transform(daily, "pc1", { from: "2024-05-01" });
    near(rows(pc1), [["2024-05", null, "no_year_earlier"], ["2024-06", 21]]);
    expect(pc1.ok && pc1.aggregated).toEqual({ from: "business_daily", to: "monthly", method: "mean" });
    near(rows(transform(daily, "ch1", { from: "2024-06-01" })), [["2024-06", 21]]);
  });

  it("pca is taken on months too", () => {
    // July 2023 on June 2023: 1.1 to the 12th is 3.138428376721...
    near(rows(transform(daily, "pca", { from: "2023-07-01", to: "2023-08-31" })), [["2023-07", 213.8428376721], ["2023-08", 0]]);
  });

  it("chg and pch stay on days", () => {
    const result = transform(daily, "chg", { from: "2023-06-29", to: "2023-07-04" });
    // Thursday 29 and Friday 30 June, Monday 3 and Tuesday 4 July.
    near(rows(result), [["2023-06-29", 0], ["2023-06-30", 0], ["2023-07-03", 10], ["2023-07-04", 0]]);
    expect(result.ok && result.aggregated).toBeUndefined();
  });

  it("a Series that does not say how it combines cannot be brought to months", () => {
    expect(transform({ ...daily, agg: undefined }, "pc1")).toMatchObject({ ok: false, reason: "aggregation_not_declared" });
    expect(transform({ ...daily, measure_kind: "flow" }, "pc1")).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
    expect(transform({ ...daily, agg: undefined }, "lin").ok).toBe(true);
  });

  it("weeks go to the month they end in", () => {
    // Weeks ending in June 2023 (W22 to W25, ending 4, 11, 18, 25 June) hold 10; July's five
    // (ending 2, 9, 16, 23, 30 July) hold 11; W31 ends on 6 August.
    const weekly: TransformSeries = { freq: "weekly", continuity: "discrete", measure_kind: "index", agg: "mean", observations: run("weekly", "2023-W22", [10, 10, 10, 10, 11, 11, 11, 11, 11, 12]) };
    near(rows(transform(weekly, "pca")), [["2023-06", null, "no_earlier"], ["2023-07", 213.8428376721], ["2023-08", null, "partial_period"]]);
  });
});

describe("partial periods", () => {
  it("a month the Series has not finished is not compared with anything", () => {
    const upTo2July: TransformSeries = {
      freq: "business_daily", continuity: "discrete", measure_kind: "rate", agg: "mean",
      observations: workingDays("2023-06-01", "2024-07-02", (month) => (month < "2024-01" ? 100 : 121)),
    };
    near(rows(transform(upTo2July, "pc1", { from: "2024-06-01" })), [["2024-06", 21], ["2024-07", null, "partial_period"]]);
  });

  it("nor is a Period the source itself marks partial, in either place", () => {
    const s = of("monthly", "2024-01", [100, 110, 121, 133.1], { "2024-02": "partial" });
    near(rows(transform(s, "pch")), [
      ["2024-01", null, "no_earlier"],
      ["2024-02", null, "partial_period"],
      ["2024-03", null, "partial_period"],
      ["2024-04", 10],
    ]);
    near(rows(transform(s, "lin")), [["2024-01", 100], ["2024-02", 110], ["2024-03", 121], ["2024-04", 133.1]]);
    const years = of("annual", "2022", [100, 110, 121], { "2024": "partial" });
    near(rows(transform(years, "pc1")), [["2022", null, "no_year_earlier"], ["2023", 10], ["2024", null, "partial_period"]]);
  });
});
