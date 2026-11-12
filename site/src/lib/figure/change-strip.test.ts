/**
 * The change strip (PLAN M22; docs/method/highlights.md): a Series' latest value and its change
 * over one, five and ten years, in figures and in words. Expected values are worked out by hand.
 */
import { describe, expect, it } from "vitest";
import { changeStrip } from "./change-strip";
import { CREATED, observations, onDays, series } from "./testing";

/** 121 months from 2015-12: 100, 101, … 220. 2025-12 is 220, 2024-12 is 208, 2020-12 is 160, 2015-12 is 100. */
const ramp = observations("monthly", "2015-12", Array.from({ length: 121 }, (_, i) => 100 + i));
const index = (over: Parameters<typeof series>[0]) => series({ name: "Fixture index", unit: "index, 2015 = 100", unitKind: "index", measureKind: "index", ...over });

describe("changeStrip", () => {
  it("states the latest value and the percent change of a level over one, five and ten years", () => {
    const strip = changeStrip(index({ observations: ramp }), CREATED);
    expect(strip.latest).toMatchObject({ period: "2025-12", value: "220", when: "December 2025", words: "220 in December 2025 (index, 2015 = 100)" });
    expect(strip.marks).toEqual([]);
    expect(strip.reason).toBeNull();
    expect(strip.cells!.map((c) => [c.years, c.period, c.figure?.kind, c.figure?.text, c.earlier])).toEqual([
      [1, "2024-12", "percent", "+5.8%", "208"],
      [5, "2020-12", "percent", "+37.5%", "160"],
      [10, "2015-12", "percent", "+120.0%", "100"],
    ]);
    expect(strip.cells!.map((c) => c.figure?.words)).toEqual([
      "5.8% higher than a year earlier",
      "37.5% higher than five years earlier",
      "120.0% higher than ten years earlier",
    ]);
    expect(strip.cells![0]).toMatchObject({ periodStart: "2024-12-01", periodWords: "Dec 2024", state: null, reason: null });
  });

  it("gives a Series measured in percent its change in percentage points, never a percent of a percent", () => {
    const strip = changeStrip(series({ freq: "annual", observations: observations("annual", "2015", [13.5, 12.7, 12.3, 11.8, 10.5, 11.5, 11.6, 11.5, 11.1, 10.6, 10.4]) }), CREATED);
    expect(strip.latest).toMatchObject({ value: "10.4", words: "10.4% in 2025" });
    expect(strip.cells!.map((c) => [c.figure?.kind, c.figure?.text, c.figure?.words])).toEqual([
      ["points", "−0.2 pts", "0.2 points lower than a year earlier"],
      ["points", "−1.1 pts", "1.1 points lower than five years earlier"],
      ["points", "−3.1 pts", "3.1 points lower than ten years earlier"],
    ]);
  });

  it("says unchanged, with no sign, when the two values are the same", () => {
    const strip = changeStrip(series({ observations: observations("monthly", "2024-01", Array.from({ length: 13 }, () => 4.3)) }), CREATED, [1]);
    expect(strip.cells![0]!.figure).toMatchObject({ text: "0.0 pts", words: "unchanged from a year earlier" });
  });

  it("gives the change in the Series' own unit where the earlier value is not above zero", () => {
    const strip = changeStrip(index({ unit: "billions of fixture dollars", unitKind: "currency", observations: observations("monthly", "2024-01", [-2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]) }), CREATED, [1]);
    expect(strip.cells![0]!.figure).toMatchObject({ kind: "unit", text: "+5", words: "5 higher than a year earlier" });
  });

  it("says why a cell is empty: the Series does not go back that far, or has no value there", () => {
    const values: (number | null)[] = Array.from({ length: 25 }, (_, i) => 50 + i);
    values[12] = null;
    const strip = changeStrip(index({ observations: observations("monthly", "2024-01", values) }), CREATED);
    expect(strip.latest!.period).toBe("2026-01");
    expect(strip.cells![0]).toMatchObject({ period: "2025-01", figure: null, earlier: null, state: { mark: "missing", word: "Missing" }, reason: "No value for Jan 2025" });
    expect(strip.cells![1]).toMatchObject({ period: "2021-01", periodStart: "2021-01-01", figure: null, state: null, reason: "The series does not go back to Jan 2021" });
  });

  it("puts no figure beside a partial Period, an estimate or a projection, and names the state", () => {
    const of = (statuses: Record<string, string>) => changeStrip(index({ observations: observations("monthly", "2024-01", Array.from({ length: 13 }, (_, i) => 5 + i), statuses) }), CREATED, [1]).cells![0]!;
    expect(of({ "2025-01": "partial" })).toMatchObject({ figure: null, state: { mark: "partial", word: "Partial period" }, reason: "January 2025 is a partial period" });
    expect(of({ "2024-01": "partial" })).toMatchObject({ figure: null, state: { mark: "partial" }, reason: "January 2024 is a partial period" });
    expect(of({ "2025-01": "estimate" })).toMatchObject({ figure: null, state: { mark: "estimate", word: "Estimate" }, reason: "The value for January 2025 is an estimate" });
    expect(of({ "2024-01": "projected" })).toMatchObject({ figure: null, state: { mark: "projected", word: "Projected" }, reason: "The value for January 2024 is a projection, not an observation" });
    // Preliminary and revised values are figures the origin published: compared, and marked beside the latest.
    expect(of({ "2025-01": "preliminary" }).figure).not.toBeNull();
  });

  it("puts no figure across a break, and one where the break is not after the earlier Period", () => {
    // 2023-01 … 2025-01; over one year the latest is set beside 2024-01.
    const run = observations("monthly", "2023-01", Array.from({ length: 25 }, (_, i) => 5 + i));
    const at = (period: string) => changeStrip(index({ breaks: [{ period, note: "New basis." }], observations: run }), CREATED, [1]).cells![0]!;
    expect(at("2024-07")).toMatchObject({ figure: null, state: { mark: "break", word: "Break" }, reason: "The series has a break at July 2024" });
    expect(at("2025-01")).toMatchObject({ figure: null, state: { mark: "break" } });
    expect(at("2024-01").figure).not.toBeNull(); // from the earlier Period on, the Series is on one basis
    expect(at("2023-06").figure).not.toBeNull();
  });

  it("a break dated inside the latest Period, or inside the earlier one, separates them too (a daily Series compared by month)", () => {
    // Monthly values that stand for months made of days; the break is dated by a day.
    const run = observations("monthly", "2024-01", Array.from({ length: 13 }, (_, i) => 10 + i));
    const at = (period: string) => changeStrip(index({ breaks: [{ period, note: "New basis." }], observations: run }), CREATED, [1]).cells![0]!;
    expect(at("2025-01-15")).toMatchObject({ figure: null, state: { mark: "break" }, reason: "The series has a break at 15 January 2025" });
    expect(at("2024-01-15")).toMatchObject({ figure: null, state: { mark: "break" } });
    expect(at("2025-02-01").figure).not.toBeNull(); // after the latest Period: it separates nothing compared here
  });

  it("marks the latest value: its Status, and Stale when the Series trails the Release", () => {
    const fresh = changeStrip(index({ maxLag: "P2M", observations: observations("monthly", "2024-12", Array.from({ length: 13 }, (_, i) => 5 + i), { "2025-12": "preliminary" }) }), CREATED, [1]);
    expect(fresh.marks).toEqual([{ mark: "preliminary", word: "Preliminary" }]);
    const stale = changeStrip(index({ maxLag: "P2M", observations: observations("monthly", "2023-06", Array.from({ length: 13 }, (_, i) => 5 + i)) }), CREATED, [1]);
    expect(stale.marks).toEqual([{ mark: "stale", word: "Stale" }]);
    expect(stale.cells![0]!.figure).not.toBeNull(); // the figures are still those of the Periods named
  });

  it("has a latest value and no cells for a Series with no fixed cadence", () => {
    const strip = changeStrip(series({ freq: "irregular", continuity: "held", unit: "percentage points", unitKind: "percentage_points", observations: onDays({ "2020-11-03": 4.5, "2024-11-05": -1.5 }) }), CREATED);
    expect(strip.cells).toBeNull();
    expect(strip.latest).toMatchObject({ value: "−1.5", words: "−1.5 on 5 November 2024 (percentage points)" });
    expect(strip.reason).toBe("This series has no fixed cadence, so there is no period a number of years earlier to set its latest value beside.");
  });

  it("has nothing at all for a Series with no value", () => {
    expect(changeStrip(index({ observations: observations("monthly", "2024-01", [null, null]) }), CREATED)).toMatchObject({ latest: null, cells: null, reason: "This series has no values." });
  });
});
