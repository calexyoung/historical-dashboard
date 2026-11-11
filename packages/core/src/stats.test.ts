/**
 * The statistics contract (docs/method/statistics.md), tested from that text. Every expected
 * value here is worked out by hand; none comes from the code under test.
 */
import { describe, expect, it } from "vitest";
import { nextPeriod, periodBounds, type Frequency } from "./period";
import * as stats from "./stats";
import { changes, lagProfile, MIN_PAIRS, pairFrame, pearson, rollingCorrelation, strongest, type StatsSeries } from "./stats";

function series(freq: Frequency, first: string, values: (number | null)[], more: Partial<StatsSeries> = {}): StatsSeries {
  const observations = [];
  let label = first;
  for (const value of values) {
    const bounds = periodBounds(freq, label)!;
    observations.push({ period: label, period_start: bounds.start, period_end: bounds.end, value, status: value === null ? "missing" : "final" });
    label = nextPeriod(freq, label)!;
  }
  return { freq, continuity: "discrete", observations, ...more };
}
const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("changes", () => {
  it("is the percent change from the Period before, only where both are observed", () => {
    const got = changes([100, 110, null, 121, 121]);
    expect(got[0]).toBeNull(); // nothing before it
    expect(got[1]).toBeCloseTo(10, 9);
    expect(got[2]).toBeNull(); // not observed
    expect(got[3]).toBeNull(); // nothing observed the Period before: no change is invented across a gap
    expect(got[4]).toBe(0);
  });

  it("has no answer after a zero", () => {
    expect(changes([0, 5])).toEqual([null, null]);
  });
});

describe("pearson", () => {
  it("is 1 for a rising straight line and −1 for a falling one", () => {
    expect(pearson(ten, ten.map((v) => 2 * v + 1)).r).toBeCloseTo(1, 12);
    expect(pearson(ten, ten.map((v) => -v)).r).toBeCloseTo(-1, 12);
  });

  it("matches a value worked by hand", () => {
    // x = 1..8, y = 2,1,4,3,6,5,8,7: Sxy = 38, Sxx = Syy = 42, r = 38/42.
    const got = pearson([1, 2, 3, 4, 5, 6, 7, 8], [2, 1, 4, 3, 6, 5, 8, 7]);
    expect(got.r).toBeCloseTo(38 / 42, 12);
    expect(got.n).toBe(8);
  });

  it("pairs only Periods where both have a value, and says how many", () => {
    const got = pearson([1, null, 3, 4, 5, 6, 7, 8, 9, 10], [2, 4, null, 8, 10, 12, 14, 16, 18, 20]);
    expect(got.n).toBe(8);
    expect(got.r).toBeCloseTo(1, 12);
    expect(got.pairs[0]).toEqual([1, 2]);
  });

  it(`has no answer below ${MIN_PAIRS} pairs, and says why`, () => {
    const got = pearson([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7]);
    expect(got).toMatchObject({ r: null, n: 7, why: "too_few_pairs" });
  });

  it("has no answer when one side never varies", () => {
    expect(pearson(ten, ten.map(() => 4))).toMatchObject({ r: null, n: 10, why: "no_variation" });
  });

  it("a positive lag pairs X with Y that many Periods later (X leads Y)", () => {
    const x = Array.from({ length: 40 }, (_, i) => (i * 7919) % 23);
    const y = [null, null, null, ...x.slice(0, -3)];
    expect(pearson(x, y, { lag: 3 }).r).toBeCloseTo(1, 12);
    expect(pearson(x, y, { lag: 3 }).n).toBe(37);
    expect(Math.abs(pearson(x, y).r!)).toBeLessThan(0.9);
    expect(pearson(y, x, { lag: -3 }).r).toBeCloseTo(1, 12);
  });

  it("exposes no significance test: v1's p < 0.05 hint is not ported (PLAN 4.5)", () => {
    expect(Object.keys(stats).filter((name) => /p_?value|normcdf|signific/i.test(name))).toEqual([]);
    expect(Object.keys(pearson(ten, ten))).toEqual(["r", "n", "why", "pairs"]);
  });
});

describe("lagProfile", () => {
  it("answers for every lag from −max to +max and finds the strongest", () => {
    const x = Array.from({ length: 40 }, (_, i) => (i * 7919) % 23);
    const y = [null, null, null, ...x.slice(0, -3)];
    const profile = lagProfile(x, y, { maxLag: 6 });
    expect(profile.map((p) => p.lag)).toEqual([-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
    expect(strongest(profile)).toMatchObject({ lag: 3 });
    expect(strongest(profile)!.r).toBeCloseTo(1, 12);
  });

  it("has no strongest lag when no lag has an answer", () => {
    expect(strongest(lagProfile([1, 2, 3], [3, 2, 1], { maxLag: 2 }))).toBeNull();
  });
});

describe("rollingCorrelation", () => {
  it("answers at the end of each trailing window, and nowhere before the first full one", () => {
    const x = Array.from({ length: 30 }, (_, i) => i);
    const out = rollingCorrelation(x, x.map((v) => 2 * v), { window: 24 });
    expect(out).toHaveLength(30);
    expect(out[22]).toBeNull();
    expect(out[23]).toBeCloseTo(1, 12);
    expect(out[29]).toBeCloseTo(1, 12);
  });
});

describe("pairFrame: two Series on one axis of Periods", () => {
  const window = {};

  it("two monthly Series are compared month by month, on changes by default", () => {
    const a = series("monthly", "2020-01", [100, 110, 121]);
    const b = series("monthly", "2020-02", [50, 100]);
    const frame = pairFrame(a, b, "chg", window);
    if (!frame.ok) throw new Error(frame.message);
    expect(frame.freq).toBe("monthly");
    expect(frame.periods.map((p) => p.period)).toEqual(["2020-01", "2020-02", "2020-03"]);
    expect(frame.x[0]).toBeNull();
    expect(frame.x[1]).toBeCloseTo(10, 9);
    expect(frame.y).toEqual([null, null, 100]);
  });

  it("on levels the values themselves are compared", () => {
    const frame = pairFrame(series("monthly", "2020-01", [1, 2]), series("monthly", "2020-01", [3, null]), "lvl", window);
    if (!frame.ok) throw new Error(frame.message);
    expect([frame.x, frame.y]).toEqual([[1, 2], [3, null]]);
  });

  it("a change at the window's first Period looks back to the Period before the window", () => {
    const a = series("monthly", "2020-01", [100, 110, 121]);
    const frame = pairFrame(a, a, "chg", { from: "2020-02-01", to: "2020-03-31" });
    if (!frame.ok) throw new Error(frame.message);
    expect(frame.periods.map((p) => p.period)).toEqual(["2020-02", "2020-03"]);
    expect(frame.x[0]).toBeCloseTo(10, 9);
  });

  it("a held or irregular Series has no Period-to-Period comparison", () => {
    const votes: StatsSeries = { freq: "irregular", continuity: "held", observations: [] };
    const frame = pairFrame(series("monthly", "2020-01", [1, 2]), votes, "chg", window);
    expect(frame).toMatchObject({ ok: false, reason: "frequency_not_supported" });
  });

  it("a Series finer than monthly must be brought to monthly first", () => {
    const frame = pairFrame(series("monthly", "2020-01", [1, 2]), { freq: "daily", continuity: "discrete", observations: [] }, "chg", window);
    expect(frame).toMatchObject({ ok: false, reason: "frequency_not_supported" });
  });
});
