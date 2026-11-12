/**
 * The change over one, five and ten years (docs/method/highlights.md), tested from that text.
 * Every expected value is worked out by hand; none comes from the code under test.
 */
import { describe, expect, it } from "vitest";
import { changeOver, shownChange } from "./highlights";
import { run } from "./testing";
import { transform } from "./transform";

const monthly = (first: string, values: (number | null)[], statuses: Record<string, string> = {}) =>
  ({ freq: "monthly" as const, continuity: "discrete" as const, observations: run("monthly", first, values, statuses) });

/** 121 months from 2015-01: 100, 101, … 220. So 2025-01 is 220, 2024-01 is 208, 2020-01 is 160, 2015-01 is 100. */
const ramp = monthly("2015-01", Array.from({ length: 121 }, (_, i) => 100 + i));

describe("changeOver", () => {
  it("sets the latest value beside the same Period one, five and ten years earlier", () => {
    const answer = changeOver(ramp, [1, 5, 10]);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.freq).toBe("monthly");
    expect(answer.aggregated).toBeNull();
    expect(answer.latest).toEqual({ period: "2025-01", period_start: "2025-01-01", period_end: "2025-01-31", value: 220, status: "final" });
    expect(answer.changes.map((c) => [c.years, c.start?.period, c.start?.value, c.change])).toEqual([
      [1, "2024-01", 208, 12],
      [5, "2020-01", 160, 60],
      [10, "2015-01", 100, 120],
    ]);
    expect(answer.changes[0]!.pct_change).toBeCloseTo((12 / 208) * 100, 9);
    expect(answer.changes[1]!.pct_change).toBeCloseTo(37.5, 9);
    expect(answer.changes[2]!.pct_change).toBeCloseTo(120, 9);
  });

  it("agrees with ch1 and pc1 at the latest Period for one year", () => {
    const answer = changeOver(ramp, [1]);
    const ch1 = transform(ramp, "ch1");
    const pc1 = transform(ramp, "pc1");
    if (!answer.ok || !ch1.ok || !pc1.ok) throw new Error("unavailable");
    expect(answer.changes[0]!.change).toBe(ch1.observations.at(-1)!.value);
    expect(answer.changes[0]!.pct_change).toBeCloseTo(pc1.observations.at(-1)!.value!, 12);
  });

  it("takes the last Observation that has a value as the latest, and never the nearest Period for the earlier one", () => {
    // 2023-01 … 2025-03; 2025-03 is missing, and so is 2024-02, the Period a year before the latest.
    const values: (number | null)[] = Array.from({ length: 27 }, (_, i) => 50 + i);
    values[26] = null;
    values[13] = null;
    const answer = changeOver(monthly("2023-01", values), [1, 5]);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.latest.period).toBe("2025-02");
    expect(answer.changes[0]).toEqual({ years: 1, start: null, period: "2024-02", change: null, pct_change: null, empty: "no_value_earlier" });
    // The Series does not reach back five years.
    expect(answer.changes[1]).toEqual({ years: 5, start: null, period: "2020-02", change: null, pct_change: null, empty: "no_observation_earlier" });
  });

  it("gives no percent change from a value at or below zero, and still the change", () => {
    const answer = changeOver(monthly("2024-01", [-2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 4]), [1]);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.latest.period).toBe("2025-02");
    expect(answer.changes[0]).toMatchObject({ change: 4, pct_change: null, pct_empty: "start_not_positive" });
  });

  it("compares nothing with a partial Period, on either side", () => {
    const latestPartial = changeOver(monthly("2024-01", Array.from({ length: 13 }, () => 5), { "2025-01": "partial" }), [1]);
    if (!latestPartial.ok) throw new Error(latestPartial.reason);
    expect(latestPartial.latest.status).toBe("partial");
    expect(latestPartial.changes[0]).toMatchObject({ change: null, pct_change: null, empty: "partial_period" });
    const earlierPartial = changeOver(monthly("2024-01", Array.from({ length: 13 }, () => 5), { "2024-01": "partial" }), [1]);
    if (!earlierPartial.ok) throw new Error(earlierPartial.reason);
    expect(earlierPartial.changes[0]).toMatchObject({ change: null, empty: "partial_period" });
  });

  it("answers a quarterly and an annual Series on their own Periods", () => {
    const quarterly = changeOver({ freq: "quarterly", continuity: "discrete", observations: run("quarterly", "2019-Q4", Array.from({ length: 21 }, (_, i) => 10 + i)) }, [1, 5]);
    if (!quarterly.ok) throw new Error(quarterly.reason);
    expect(quarterly.latest.period).toBe("2024-Q4");
    expect(quarterly.changes.map((c) => [c.start?.period, c.change])).toEqual([["2023-Q4", 4], ["2019-Q4", 20]]);
    const annual = changeOver({ freq: "annual", continuity: "discrete", observations: run("annual", "2014", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) }, [10]);
    if (!annual.ok) throw new Error(annual.reason);
    expect(annual.changes[0]).toMatchObject({ start: { period: "2014", value: 1 }, change: 11, pct_change: 1100 });
  });

  it("brings a daily Series to months first, by its declared rule, as pc1 does", () => {
    // Every day of January 2024 is 10 and of January 2025 is 13; the months between are 11.
    const observations = run("daily", "2024-01-01", Array.from({ length: 397 }, (_, i) => (i < 31 ? 10 : i < 366 ? 11 : 13)));
    const daily = { freq: "daily" as const, continuity: "discrete" as const, measure_kind: "rate", agg: "mean", observations };
    const answer = changeOver(daily, [1]);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.freq).toBe("monthly");
    expect(answer.aggregated).toEqual({ from: "daily", to: "monthly", method: "mean" });
    expect(answer.latest).toMatchObject({ period: "2025-01", value: 13 });
    expect(answer.changes[0]).toMatchObject({ start: { period: "2024-01", value: 10 }, change: 3, pct_change: 30 });
    // With no declared rule it is not guessed.
    const undeclared = changeOver({ ...daily, agg: undefined }, [1]);
    expect(undeclared).toMatchObject({ ok: false, reason: "aggregation_not_declared" });
  });

  it("is unavailable for an irregular Series and for one with no value", () => {
    const irregular = changeOver({ freq: "irregular", continuity: "held", observations: run("irregular", "", [1, 2], {}, ["2020-11-03", "2024-11-05"]) }, [1]);
    expect(irregular).toMatchObject({ ok: false, reason: "frequency_not_supported" });
    expect(changeOver(monthly("2024-01", [null, null]), [1])).toMatchObject({ ok: false, reason: "no_values" });
  });

  it("refuses a span that is not a whole number of years", () => {
    expect(() => changeOver(ramp, [0])).toThrow();
    expect(() => changeOver(ramp, [1.5])).toThrow();
  });
});

describe("shownChange: which figure a page shows for a Series", () => {
  const change = { years: 1, start: { period: "2024-01", period_start: "2024-01-01", period_end: "2024-01-31", value: 4, status: "final" }, period: "2024-01", change: 0.5, pct_change: 12.5 };
  it("is the change in percentage points for a Series measured in percent", () => {
    expect(shownChange(change, "percent")).toEqual({ kind: "points", value: 0.5 });
    expect(shownChange(change, "percentage_points")).toEqual({ kind: "points", value: 0.5 });
  });
  it("is the percent change otherwise, where there is one", () => {
    expect(shownChange(change, "index")).toEqual({ kind: "percent", value: 12.5 });
    expect(shownChange(change, undefined)).toEqual({ kind: "percent", value: 12.5 });
  });
  it("is the change in the Series' own unit where a percent change would read the wrong way round", () => {
    expect(shownChange({ ...change, pct_change: null, pct_empty: "start_not_positive" }, "currency")).toEqual({ kind: "unit", value: 0.5 });
  });
  it("is nothing, with the reason, where there is no change", () => {
    expect(shownChange({ years: 1, start: null, period: "2024-01", change: null, pct_change: null, empty: "no_value_earlier" }, "index")).toEqual({ kind: "none", empty: "no_value_earlier" });
  });
});
