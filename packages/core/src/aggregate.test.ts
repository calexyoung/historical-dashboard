/**
 * Aggregation by Measure kind (docs/method/transforms.md, "Bringing a Series to a slower
 * frequency"), tested from that text. Every expected value is worked out by hand.
 */
import { describe, expect, it } from "vitest";
import { aggregate, type AggregateSeries } from "./aggregate";
import { periodContaining, type Frequency } from "./period";
import { run } from "./testing";

const of = (freq: Frequency, first: string, values: (number | null)[], measure_kind: string, agg?: string, statuses: Record<string, string> = {}): AggregateSeries => ({
  freq, continuity: "discrete", measure_kind, agg, observations: run(freq, first, values, statuses),
});
const table = (result: ReturnType<typeof aggregate>): [string, number | null, string][] => {
  if (!result.ok) throw new Error(`unavailable: ${result.reason}`);
  return result.observations.map((o) => [o.period, o.value, o.status]);
};

describe("which Period a day falls in", () => {
  it("names the week, month, quarter and year", () => {
    expect(periodContaining("monthly", "2024-02-29")).toBe("2024-02");
    expect(periodContaining("quarterly", "2024-06-30")).toBe("2024-Q2");
    expect(periodContaining("annual", "2024-12-31")).toBe("2024");
    expect(periodContaining("weekly", "2024-12-30")).toBe("2025-W01"); // a Monday in ISO week 1 of 2025
    expect(periodContaining("business_daily", "2024-06-01")).toBeNull(); // a Saturday
    expect(periodContaining("irregular", "2024-06-01")).toBeNull();
    expect(periodContaining("monthly", "2024-02-30")).toBeNull();
  });
});

describe("aggregation by measure kind", () => {
  it("sums a flow", () => {
    expect(table(aggregate(of("monthly", "2024-01", [1, 2, 3, 4, 5, 6], "flow", "sum"), "quarterly"))).toEqual([
      ["2024-Q1", 6, "final"],
      ["2024-Q2", 15, "final"],
    ]);
  });

  it("gives no sum where a month is missing: a total with a hole is not the total", () => {
    expect(table(aggregate(of("monthly", "2024-01", [1, null, 3, 4, 5, 6], "flow", "sum"), "quarterly"))).toEqual([
      ["2024-Q1", null, "missing"],
      ["2024-Q2", 15, "final"],
    ]);
  });

  it("averages an index over the values present", () => {
    expect(table(aggregate(of("monthly", "2024-01", [100, null, 104, 106, 108, 110], "index", "mean"), "quarterly"))).toEqual([
      ["2024-Q1", 102, "final"],
      ["2024-Q2", 108, "final"],
    ]);
  });

  it("takes the last value present of a stock declared as last", () => {
    expect(table(aggregate(of("monthly", "2024-01", [10, 11, null, 13, 14, 15], "stock", "last"), "quarterly"))).toEqual([
      ["2024-Q1", 11, "final"],
      ["2024-Q2", 15, "final"],
    ]);
  });

  it("has no value for a Period in which nothing is present", () => {
    expect(table(aggregate(of("monthly", "2024-01", [null, null, null, 4, 5, 6], "rate", "mean"), "quarterly"))[0]).toEqual(["2024-Q1", null, "missing"]);
  });

  it("brings months to years", () => {
    const months = Array.from({ length: 24 }, (_, i) => i + 1); // 1..12 then 13..24
    expect(table(aggregate(of("monthly", "2023-01", months, "flow", "sum"), "annual"))).toEqual([
      ["2023", 78, "final"],
      ["2024", 222, "final"],
    ]);
  });

  it("carries the least settled status of what went in", () => {
    const s = of("monthly", "2024-01", [1, 2, 3, 4, 5, 6], "flow", "sum", { "2024-02": "revised", "2024-03": "preliminary", "2024-05": "revised" });
    expect(table(aggregate(s, "quarterly")).map((row) => row[2])).toEqual(["preliminary", "revised"]);
  });

  it("refuses a combination nobody declared, and one that is not allowed", () => {
    const months = [1, 2, 3];
    expect(aggregate(of("monthly", "2024-01", months, "flow"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_declared" });
    expect(aggregate(of("monthly", "2024-01", months, "flow", "none"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_declared" });
    expect(aggregate(of("monthly", "2024-01", months, "flow", "mean"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
    expect(aggregate(of("monthly", "2024-01", months, "rate", "sum"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
    expect(aggregate(of("monthly", "2024-01", months, "annualized", "sum"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
    expect(aggregate(of("monthly", "2024-01", months, "stock", "sum"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
    expect(aggregate(of("monthly", "2024-01", months, "tonnage", "sum"), "quarterly")).toMatchObject({ ok: false, reason: "aggregation_not_allowed" });
    expect(table(aggregate(of("monthly", "2024-01", [2, 4, 6], "annualized", "mean"), "quarterly"))).toEqual([["2024-Q1", 4, "final"]]);
    expect(table(aggregate(of("monthly", "2024-01", [2, 4, 6], "index", "last"), "quarterly"))).toEqual([["2024-Q1", 6, "final"]]);
    expect(table(aggregate(of("monthly", "2024-01", [2, 4, 6], "stock", "mean"), "quarterly"))).toEqual([["2024-Q1", 4, "final"]]);
  });

  it("only goes to a slower frequency", () => {
    const quarterly = of("quarterly", "2024-Q1", [1, 2], "flow", "sum");
    expect(aggregate(quarterly, "monthly")).toMatchObject({ ok: false, reason: "not_slower" });
    expect(table(aggregate(quarterly, "quarterly"))).toEqual([["2024-Q1", 1, "final"], ["2024-Q2", 2, "final"]]);
    const irregular: AggregateSeries = { freq: "irregular", continuity: "discrete", measure_kind: "flow", agg: "sum", observations: run("irregular", "", [1], {}, ["2024-11-05"]) };
    expect(aggregate(irregular, "annual")).toMatchObject({ ok: false, reason: "no_cadence" });
    expect(aggregate(quarterly, "irregular")).toMatchObject({ ok: false, reason: "no_cadence" });
    expect(aggregate({ ...of("monthly", "2024-01", [1, 2, 3], "rate", "mean"), continuity: "held" }, "quarterly")).toMatchObject({ ok: false, reason: "held" });
  });
});

describe("partial periods", () => {
  it("marks a Period the Series has not finished, and one it began part-way through", () => {
    // February to August 2024: the first quarter lacks January, the third lacks September.
    expect(table(aggregate(of("monthly", "2024-02", [2, 3, 4, 5, 6, 7, 8], "flow", "sum"), "quarterly"))).toEqual([
      ["2024-Q1", 5, "partial"],
      ["2024-Q2", 15, "final"],
      ["2024-Q3", 15, "partial"],
    ]);
  });

  it("a month of working days is whole although it begins and ends on a weekend", () => {
    // June 2024: the 1st and 2nd, and the 29th and 30th, are a weekend. Working days 3 to 28
    // are 20 days; then 1 and 2 July.
    const june = Array.from({ length: 20 }, () => 5);
    const s = of("business_daily", "2024-06-03", [...june, 7, 9], "rate", "mean");
    expect(table(aggregate(s, "monthly"))).toEqual([
      ["2024-06", 5, "final"],
      ["2024-07", 8, "partial"],
    ]);
  });

  it("a holiday inside the month does not make it partial", () => {
    const june = Array.from({ length: 20 }, (_, i) => (i === 12 ? null : 4)); // Wednesday 19 June
    expect(table(aggregate(of("business_daily", "2024-06-03", june, "rate", "mean"), "monthly"))).toEqual([["2024-06", 4, "final"]]);
  });

  it("a week belongs to the month it ends in", () => {
    // W22 is 27 May to 2 June; W23 to W26 end on 9, 16, 23 and 30 June; W27 ends on 7 July.
    const s = of("weekly", "2024-W22", [1, 2, 3, 4, 5, 6], "flow", "sum");
    expect(table(aggregate(s, "monthly"))).toEqual([
      ["2024-06", 15, "final"],
      ["2024-07", 6, "partial"],
    ]);
  });

  it("calendar days: the month is partial until its last day is in", () => {
    const s = of("daily", "2024-02-01", Array.from({ length: 28 }, () => 1), "flow", "sum");
    expect(table(aggregate(s, "monthly"))).toEqual([["2024-02", 28, "partial"]]); // 2024 is a leap year
    const whole = of("daily", "2024-02-01", Array.from({ length: 29 }, () => 1), "flow", "sum");
    expect(table(aggregate(whole, "monthly"))).toEqual([["2024-02", 29, "final"]]);
  });
});
