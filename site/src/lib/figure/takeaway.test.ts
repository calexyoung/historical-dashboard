/**
 * The Takeaway: one sentence from a fixed template that states the latest figure and its change,
 * and the rules under which a figure has no sentence (PLAN section 3; M3's acceptance criteria).
 * Every expected sentence here is written out by hand.
 */
import { describe, expect, it } from "vitest";
import { renderFigure } from "./index";
import { CREATED, observations, onDays, series } from "./testing";

const figure = (...list: Parameters<typeof series>[0][]) => renderFigure({ created: CREATED }, list.map(series));

describe("templates state figures and nothing else", () => {
  it("a rate: the latest value and the value one Period before", () => {
    const f = figure({ observations: observations("monthly", "2025-10", [4.1, 4.2, 4.3]) });
    expect(f.takeaway).toBe("Fixture rate was 4.3% in December 2025, up from 4.2% in November 2025.");
    expect(f.silence).toBeNull();
  });

  it("says down, and unchanged, in the same words", () => {
    expect(figure({ observations: observations("monthly", "2025-11", [4.2, 4.0]) }).takeaway).toBe(
      "Fixture rate was 4.0% in December 2025, down from 4.2% in November 2025.",
    );
    expect(figure({ observations: observations("monthly", "2025-11", [4.2, 4.2]) }).takeaway).toBe(
      "Fixture rate was 4.2% in December 2025, unchanged from 4.2% in November 2025.",
    );
  });

  it("a unit that is not a bare percent sign is given in brackets", () => {
    const f = figure({ unit: "percent of residents", freq: "annual", observations: observations("annual", "2023", [11.1, 10.6, 10.4]) });
    expect(f.takeaway).toBe("Fixture rate was 10.4 in 2025 (percent of residents), down from 10.6 in 2024.");
  });

  it("an index, a currency amount or a count is set against the same Period a year earlier", () => {
    const values = [100, 100.4, 100.9, 101.1, 101.6, 102, 102.3, 102.9, 103.2, 103.8, 104.1, 104.5, 105];
    const f = figure({ name: "Fixture price index", unit: "index, 2024-01 = 100", unitKind: "index", measureKind: "index", observations: observations("monthly", "2024-12", values) });
    // 105 / 100 - 1 = 5.0%
    expect(f.takeaway).toBe("Fixture price index was 105 in December 2025 (index, 2024-01 = 100), 5.0% higher than a year earlier.");
  });

  it("a quarter and a lower value a year earlier", () => {
    const f = figure({ name: "Fixture output", unit: "billions of fixture dollars", unitKind: "currency", measureKind: "flow", freq: "quarterly", observations: observations("quarterly", "2024-Q4", [500, 510, 505, 495, 490]) });
    // 490 / 500 - 1 = -2.0%
    expect(f.takeaway).toBe("Fixture output was 490 in the fourth quarter of 2025 (billions of fixture dollars), 2.0% lower than a year earlier.");
  });

  it("with no value a year earlier, an index falls back to the Period before", () => {
    const f = figure({ name: "Fixture price index", unit: "index", unitKind: "index", measureKind: "index", observations: observations("monthly", "2025-11", [108.1, 109.9]) });
    expect(f.takeaway).toBe("Fixture price index was 109.9 in December 2025 (index), up from 108.1 in November 2025.");
  });

  it("with nothing to compare with, it states the level alone", () => {
    expect(figure({ observations: observations("monthly", "2025-12", [4.3]) }).takeaway).toBe("Fixture rate was 4.3% in December 2025.");
    // The Period before is a gap: no comparison is made across it.
    expect(figure({ observations: observations("monthly", "2025-10", [4.1, null, 4.3]) }).takeaway).toBe("Fixture rate was 4.3% in December 2025.");
  });

  it("a held Series is dated by the day of its latest Observation", () => {
    const f = figure({ name: "Fixture election margin", unit: "percentage points", unitKind: "percentage_points", freq: "irregular", continuity: "held", observations: onDays({ "2020-11-03": 4.5, "2024-11-05": -1.5 }) });
    expect(f.takeaway).toBe("Fixture election margin was -1.5 on 5 November 2024 (percentage points), down from 4.5 on 3 November 2020.");
  });

  it("a preliminary or revised latest value still gets its sentence (the source line names the status)", () => {
    const f = figure({ observations: observations("monthly", "2025-11", [4.2, 4.3], { "2025-12": "preliminary" }) });
    expect(f.takeaway).toBe("Fixture rate was 4.3% in December 2025, up from 4.2% in November 2025.");
    expect(f.sourceLine).toContain("preliminary");
  });

  it("never uses a word that evaluates", () => {
    const sentences = [
      figure({ observations: observations("monthly", "2025-10", [4.1, 4.2, 9.9]) }).takeaway,
      figure({ observations: observations("monthly", "2025-10", [4.1, 4.2, 0.1]) }).takeaway,
    ].join(" ");
    expect(sentences).not.toMatch(/\b(only|just|surged?|soared|plunged|fell sharply|improved|worsened|good|bad|strong|weak|record|unfortunately|healthy)\b/i);
  });
});

describe("silence rules: when a sentence would mislead, there is none, and the figure says why", () => {
  it("partial: the latest Period is not complete", () => {
    const f = figure({ observations: observations("monthly", "2025-11", [4.2, 1.9], { "2025-12": "partial" }) });
    expect(f.takeaway).toBeNull();
    expect(f.silence).toEqual({ rule: "partial", text: "No summary sentence: December 2025 is a partial period." });
  });

  it("stale: the Series trails the Release by more than its limit", () => {
    const f = figure({ maxLag: "P3M", observations: observations("monthly", "2024-05", [4.2, 4.3]) });
    expect(f.takeaway).toBeNull();
    expect(f.silence).toEqual({
      rule: "stale",
      text: "No summary sentence: the series is stale. Its latest value is for June 2024 and this release was made on 1 January 2026.",
    });
  });

  it("estimate: the latest value is an estimate", () => {
    const f = figure({ observations: observations("monthly", "2025-11", [4.2, 4.3], { "2025-12": "estimate" }) });
    expect(f.takeaway).toBeNull();
    expect(f.silence).toEqual({ rule: "estimate", text: "No summary sentence: the value for December 2025 is an estimate." });
  });

  it("estimate: the value it would be compared with is an estimate", () => {
    const f = figure({ observations: observations("monthly", "2025-11", [4.2, 4.3], { "2025-11": "estimate" }) });
    expect(f.takeaway).toBeNull();
    expect(f.silence?.rule).toBe("estimate");
    expect(f.silence?.text).toBe("No summary sentence: the value for November 2025 is an estimate.");
  });

  it("projected: a projection is never presented as observed", () => {
    const f = figure({ observations: observations("monthly", "2025-11", [4.2, 4.3], { "2025-12": "projected" }) });
    expect(f.takeaway).toBeNull();
    expect(f.silence).toEqual({ rule: "projected", text: "No summary sentence: the value for December 2025 is a projection, not an observation." });
  });

  it("break: a break lies between the two Periods a sentence would compare", () => {
    const base = { breaks: [{ period: "2025-12", note: "New population controls." }] };
    const f = figure({ ...base, observations: observations("monthly", "2025-11", [4.2, 4.3]) });
    expect(f.takeaway).toBeNull();
    expect(f.silence).toEqual({
      rule: "break",
      text: "No summary sentence: the series has a break at December 2025, between the two periods a sentence would compare.",
    });
    // A break before both Periods is no obstacle.
    const earlier = figure({ breaks: [{ period: "2025-11", note: "n" }], observations: observations("monthly", "2025-10", [4.0, 4.2, 4.3]) });
    expect(earlier.takeaway).toBe("Fixture rate was 4.3% in December 2025, up from 4.2% in November 2025.");
  });

  it("break: across the year for a year-earlier comparison", () => {
    const values = [100, 100.4, 100.9, 101.1, 101.6, 102, 102.3, 102.9, 103.2, 103.8, 104.1, 104.5, 105];
    const f = figure({ unitKind: "count", unit: "thousands of jobs", breaks: [{ period: "2025-01", note: "n" }], observations: observations("monthly", "2024-12", values) });
    expect(f.takeaway).toBeNull();
    expect(f.silence?.rule).toBe("break");
  });

  it("missing: the latest Period has no value, so the last value is not passed off as the latest", () => {
    const f = figure({ observations: observations("monthly", "2025-10", [4.1, 4.2, null]) });
    expect(f.takeaway).toBeNull();
    expect(f.silence).toEqual({ rule: "missing", text: "No summary sentence: the latest period (December 2025) has no value." });
  });

  describe("non-comparable: two Series in one figure", () => {
    const a = { key: "a", name: "Rate A", observations: observations("monthly", "2025-11", [4.2, 4.3]) };
    const b = { key: "b", name: "Rate B", observations: observations("monthly", "2025-11", [3.0, 3.1]) };

    it("comparable Series share a sentence", () => {
      expect(figure(a, b).takeaway).toBe("In December 2025, Rate A was 4.3% and Rate B was 3.1%.");
    });

    it.each([
      ["unit", { unit: "percent of residents" }, "they are not in the same unit"],
      ["frequency", { freq: "quarterly" as const, observations: observations("quarterly", "2025-Q3", [3.0, 3.1]) }, "they are not at the same frequency"],
      ["seasonal adjustment", { seasonalAdjustment: "nsa" }, "they differ in seasonal adjustment"],
      ["price basis", { priceBasis: "real" }, "they differ in price basis"],
      ["what they measure", { measureKind: "index" }, "they do not measure the same kind of quantity"],
      ["country", { country: "GBR" }, "they are not for the same country"],
      ["representation", { representation: "legacy_monthly_rounded" }, "one holds v1's rounded values and the other does not"],
      ["latest period", { observations: observations("monthly", "2025-10", [3.0, 3.1]) }, "their latest values are for different periods"],
    ])("differing in %s: silence", (_what, change, why) => {
      const f = figure(a, { ...b, ...change });
      expect(f.takeaway).toBeNull();
      expect(f.silence).toEqual({ rule: "not_comparable", text: `No summary sentence: these series are not comparable (${why}).` });
    });

    it("a fact that is not recorded does not count as the same", () => {
      const f = figure({ ...a, seasonalAdjustment: undefined }, { ...b, seasonalAdjustment: undefined });
      expect(f.takeaway).toBeNull();
      expect(f.silence).toEqual({
        rule: "not_comparable",
        text: "No summary sentence: these series are not comparable (seasonal adjustment is not recorded for them).",
      });
    });

    it("a Series that would be silent alone silences the pair", () => {
      const f = figure(a, { ...b, observations: observations("monthly", "2025-11", [3.0, 3.1], { "2025-12": "partial" }) });
      expect(f.takeaway).toBeNull();
      expect(f.silence?.rule).toBe("partial");
    });
  });

  it("a Series with no values at all", () => {
    const f = figure({ observations: observations("monthly", "2025-11", [null, null]) });
    expect(f.takeaway).toBeNull();
    expect(f.silence?.rule).toBe("no_values");
  });
});
