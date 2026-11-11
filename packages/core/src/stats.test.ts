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
    expect(got.pairs[0]).toEqual({ x: 1, y: 2, i: 0, j: 0 });
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
    expect(out[23]!.r).toBeCloseTo(1, 12);
    expect(out[29]).toMatchObject({ n: 24 });
    expect(out[29]!.r).toBeCloseTo(1, 12);
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

// --- v1's two caveats (PLAN M5): each of these failed against the port of v1's code -------------

describe("caveat 1: the floor on pairs (minN) is honoured", () => {
  const six = [1, 2, 3, 4, 5, 6];
  const other = [2, 1, 4, 3, 6, 5]; // Sxy = 13.5, Sxx = Syy = 17.5

  it("pearson answers from the floor it is given", () => {
    expect(pearson(six, other).r).toBeNull(); // the default floor is 8
    expect(pearson(six, other, { minN: 6 }).r).toBeCloseTo(13.5 / 17.5, 12);
    expect(pearson(six, other, { minN: 7 })).toMatchObject({ r: null, n: 6, why: "too_few_pairs" });
  });

  it("a floor below 3 is not accepted: two points always lie on a line", () => {
    expect(pearson([1, 2], [5, 9], { minN: 2 })).toMatchObject({ r: null, why: "too_few_pairs" });
  });

  it("rollingCorrelation passes its floor on (v1 took the argument and ignored it)", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const y = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11];
    expect(rollingCorrelation(x, y, { window: 6 }).every((w) => w === null || w.r === null)).toBe(true);
    const out = rollingCorrelation(x, y, { window: 6, minN: 6 });
    expect(out[4]).toBeNull();
    expect(out[5]!.r).toBeCloseTo(13.5 / 17.5, 12);
    expect(out[11]).toMatchObject({ n: 6 });
    // A window with gaps: twelve Periods, nine pairs. A floor of ten leaves it unanswered.
    const gappy = [1, null, 3, 4, null, 6, 7, 8, null, 10, 11, 12];
    expect(rollingCorrelation(gappy, y, { window: 12 })[11]!.r).not.toBeNull();
    expect(rollingCorrelation(gappy, y, { window: 12, minN: 10 })[11]).toEqual({ r: null, n: 9 });
  });

  it("the lag profile passes its floor on too", () => {
    expect(lagProfile(six, other, { maxLag: 1, minN: 5 }).map((p) => p.r !== null)).toEqual([true, true, true]);
  });
});

describe("caveat 2: quarterly and annual Series have changes, at their own frequency", () => {
  it("two quarterly Series are compared quarter by quarter (v1 looked for adjacent months and found none)", () => {
    const a = series("quarterly", "2020-Q1", [100, 110, 121]);
    const b = series("quarterly", "2020-Q1", [50, 25, 50]);
    const frame = pairFrame(a, b, "chg");
    if (!frame.ok) throw new Error(frame.message);
    expect(frame.freq).toBe("quarterly");
    expect(frame.periods.map((p) => p.period)).toEqual(["2020-Q1", "2020-Q2", "2020-Q3"]);
    expect(frame.x[0]).toBeNull();
    expect(frame.x[1]).toBeCloseTo(10, 9);
    expect(frame.x[2]).toBeCloseTo(10, 9);
    expect(frame.y).toEqual([null, -50, 100]);
  });

  it("two annual Series are compared year by year", () => {
    const frame = pairFrame(series("annual", "2001", [10, 11]), series("annual", "2000", [4, 5, 10]), "chg");
    if (!frame.ok) throw new Error(frame.message);
    expect(frame.freq).toBe("annual");
    expect(frame.periods.map((p) => p.period)).toEqual(["2000", "2001", "2002"]);
    expect(frame.x[2]).toBeCloseTo(10, 9);
    expect(frame.y).toEqual([null, 25, 100]);
  });

  it("a monthly and a quarterly Series meet at the quarter, the monthly one combined as its Catalog entry declares", () => {
    const quarterly = series("quarterly", "2020-Q1", [10, 20]);
    const months = [1, 2, 3, 4, 5, 6];
    const at = (agg: StatsSeries["agg"]) => {
      const frame = pairFrame(series("monthly", "2020-01", months, { agg }), quarterly, "lvl");
      if (!frame.ok) throw new Error(frame.message);
      expect(frame.freq).toBe("quarterly");
      expect(frame.y).toEqual([10, 20]);
      return frame.x;
    };
    expect(at("mean")).toEqual([2, 5]);
    expect(at("sum")).toEqual([6, 15]);
    expect(at("last")).toEqual([3, 6]);
  });

  it("whichever side is finer is the one combined, and a year takes twelve months or four quarters", () => {
    const frame = pairFrame(series("annual", "2020", [7]), series("quarterly", "2020-Q1", [1, 2, 3, 4], { agg: "sum" }), "lvl");
    expect(frame.ok && [frame.freq, frame.x, frame.y]).toEqual(["annual", [7], [10]]);
    const year = pairFrame(series("monthly", "2020-01", Array.from({ length: 12 }, (_, i) => i + 1), { agg: "mean" }), series("annual", "2020", [7]), "lvl");
    expect(year.ok && year.x).toEqual([6.5]);
  });

  it("a coarser Period that is not whole has no value: nothing is made from part of a quarter", () => {
    const quarterly = series("quarterly", "2020-Q1", [10, 20]);
    const frame = (values: (number | null)[], agg: StatsSeries["agg"]) => {
      const f = pairFrame(series("monthly", "2020-01", values, { agg }), quarterly, "lvl");
      if (!f.ok) throw new Error(f.message);
      return f.x;
    };
    expect(frame([1, 2, 3, 4, 5], "mean")).toEqual([2, null]); // June has not arrived
    expect(frame([1, null, 3, 4, 5, 6], "sum")).toEqual([null, 15]);
    expect(frame([1, null, 3, 4, 5], "last")).toEqual([3, null]); // `last` needs only the last month
  });

  it("a Series that does not say how its Periods combine cannot be brought to a slower frequency", () => {
    const quarterly = series("quarterly", "2020-Q1", [10, 20]);
    for (const agg of [undefined, "none"] as const) {
      const frame = pairFrame(series("monthly", "2020-01", [1, 2, 3], { agg }), quarterly, "lvl");
      expect(frame).toMatchObject({ ok: false, reason: "no_aggregation" });
    }
    // At its own frequency nothing needs combining.
    expect(pairFrame(series("monthly", "2020-01", [1, 2], { agg: "none" }), series("monthly", "2020-01", [3, 4]), "lvl").ok).toBe(true);
  });

  it("a Period belongs to the window by its first day, as in a Transform", () => {
    const a = series("quarterly", "2019-Q4", [1, 2, 3, 4]);
    const frame = pairFrame(a, a, "lvl", { from: "2020-01-01", to: "2020-05-31" });
    expect(frame.ok && frame.periods.map((p) => p.period)).toEqual(["2020-Q1", "2020-Q2"]);
  });
});

describe("what counts as observed", () => {
  it("a projected or partial value is not a measurement and is left out", () => {
    const a = series("monthly", "2020-01", [1, 2, 3]);
    const b: StatsSeries = { ...a, observations: a.observations.map((o, i) => (i === 1 ? { ...o, status: "projected" } : i === 2 ? { ...o, status: "partial" } : o)) };
    const frame = pairFrame(a, b, "lvl");
    expect(frame.ok && frame.y).toEqual([1, null, null]);
  });

  it("a preliminary, revised or estimated value counts", () => {
    const a = series("monthly", "2020-01", [1, 2, 3]);
    const b: StatsSeries = { ...a, observations: a.observations.map((o, i) => ({ ...o, status: ["preliminary", "revised", "estimate"][i]! })) };
    expect(pairFrame(a, b, "lvl")).toMatchObject({ ok: true, y: [1, 2, 3] });
  });

  it("no change is taken across a break: the two values are not comparable", () => {
    const a = series("monthly", "2020-01", [100, 110, 121, 133.1], { breaks: ["2020-03-01"] });
    const frame = pairFrame(a, a, "chg");
    if (!frame.ok) throw new Error(frame.message);
    expect(frame.x[1]).toBeCloseTo(10, 9);
    expect(frame.x[2]).toBeNull();
    expect(frame.x[3]).toBeCloseTo(10, 9);
  });

  it("identical decimal values have no variation, whatever their sum rounds to", () => {
    const flat = Array<number>(10).fill(0.1);
    expect(pearson(flat, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toMatchObject({ r: null, why: "no_variation" });
  });
});
