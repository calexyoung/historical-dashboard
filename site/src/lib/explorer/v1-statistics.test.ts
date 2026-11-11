/**
 * v1's 16 statistics cases (tests/test_stats.py, which runs v1's web/stats.js), ported: the same
 * inputs and the same expected numbers, asked of v2's own modules (PLAN M5). Where v2 differs on
 * purpose the case says so and checks what v2 does instead:
 *
 *   case 12  fillSparse: v2 never fills (docs/method/transforms.md, D5)
 *   case 13  pValue, normCdf: not ported (PLAN 4.5; docs/method/statistics.md, S1)
 *   case 14  fmtN's "1.23M": v2 writes a value out in full
 *
 * v1's own suite still runs against v1's code (`make test`).
 */
import { describe, expect, it } from "vitest";
import * as core from "@macro-atlas/core";
import { changes, nextPeriod, pearson, periodBounds, rollingCorrelation, transform, type Frequency, type TransformName, type TransformSeries } from "@macro-atlas/core";
import { periodWords, together } from "../figure/words";

function series(freq: Frequency, first: string, values: (number | null)[]): TransformSeries {
  const observations = [];
  let label = first;
  for (const value of values) {
    const bounds = periodBounds(freq, label)!;
    observations.push({ period: label, period_start: bounds.start, period_end: bounds.end, value, status: value === null ? "missing" : "final" });
    label = nextPeriod(freq, label)!;
  }
  return { freq, continuity: "discrete", observations };
}
/** A Transform's values, over the months numbered i0 to i1 of a Series that starts in 2000-01, as v1's functions took a range. */
function v2(values: (number | null)[], name: TransformName, i0 = 0, i1 = values.length - 1): (number | null)[] {
  const s = series("monthly", "2000-01", values);
  const result = transform(s, name, { from: s.observations[i0]!.period_start, to: s.observations[i1]!.period_end });
  if (!result.ok) throw new Error(result.message);
  return result.observations.map((o) => o.value);
}
const close = (got: (number | null)[], want: (number | null)[]) => {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => (w === null ? expect(got[i]).toBeNull() : expect(got[i]).toBeCloseTo(w, 9)));
};
const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("v1's 16 statistics cases", () => {
  it("1 · pearson: perfect positive and negative", () => {
    expect(pearson(ten, ten.map((v) => 2 * v + 1)).r).toBeCloseTo(1, 9);
    expect(pearson(ten, ten.map((v) => -v)).r).toBeCloseTo(-1, 9);
  });

  it("2 · pearson: near zero", () => {
    expect(Math.abs(pearson(ten, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1]).r!)).toBeLessThan(0.2);
  });

  it("3 · pearson: fewer than 8 pairs has no answer", () => {
    const out = pearson([1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 6, 7]);
    expect(out.r).toBeNull();
    expect(out.n).toBe(7);
  });

  it("4 · pearson: skips missing values", () => {
    const out = pearson([1, null, 3, 4, 5, 6, 7, 8, 9, 10], [2, 4, null, 8, 10, 12, 14, 16, 18, 20]);
    expect(out.n).toBe(8);
    expect(out.r).toBeCloseTo(1, 9);
  });

  it("5 · lag alignment: X leads Y", () => {
    const x = Array.from({ length: 40 }, (_, i) => ((i * 7919) % 23) * 1.0);
    const y = [null, null, null, ...x.slice(0, -3)];
    expect(pearson(x, y, { lag: 3 }).r).toBeCloseTo(1, 9);
    expect(Math.abs(pearson(x, y, { lag: 0 }).r!)).toBeLessThan(0.9);
  });

  it("6 · z-score: population standard deviation", () => {
    const z = v2([2, 4, 4, 4, 5, 5, 7, 9], "z"); // mean 5, sd 2
    expect(z[0]).toBeCloseTo(-1.5, 9);
    expect(z.at(-1)).toBeCloseTo(2, 9);
  });

  it("7 · z-score: respects the range", () => {
    // v1 returned the whole axis with nulls outside the range; v2 answers for the range only.
    const z = v2([100, 1, 2, 3, 100], "z", 1, 3);
    expect(z).toHaveLength(3);
    expect(z[1]).toBeCloseTo(0, 9);
  });

  it("8 · rebase: with leading missing values", () => {
    close(v2([null, null, 50, 75, null, 100], "rebase"), [null, null, 100, 150, null, 200]);
  });

  it("9 · rebase: uses the first value in the range, not in the series", () => {
    close(v2([10, 20, 40], "rebase", 1, 2), [100, 200]);
  });

  it("10 · year over year, on the fly", () => {
    expect(v2([...Array<number>(12).fill(100), 110], "pc1")[12]).toBeCloseTo(10, 9);
  });

  it("11 · changes: no fill", () => {
    close(changes([100, 110, null, 121, 121]), [null, 10, null, null, 0]);
  });

  it("12 · fillSparse stop rules: deliberately not ported; a quarterly Series answers once per quarter, never per month (D5)", () => {
    const quarterly = series("quarterly", "2000-Q1", [1, 2]);
    const result = transform(quarterly, "lin");
    expect(result.ok && result.observations.map((o) => o.period)).toEqual(["2000-Q1", "2000-Q2"]);
    expect("fillSparse" in core).toBe(false);
  });

  it("13 · p-value by normal approximation: deliberately not ported (PLAN 4.5)", () => {
    expect("pValue" in core).toBe(false);
    expect("normCdf" in core).toBe(false);
  });

  it("14 · adding months, and how a month and a number are written", () => {
    expect(nextPeriod("monthly", "1999-12")).toBe("2000-01"); // v1: addM('2000-01', -1) === '1999-12'
    expect(periodWords("monthly", { period: "2008-09", period_start: "2008-09-01" }, "short")).toBe("Sep 2008");
    expect(together([12345.6])).toEqual(["12,346"]);
    expect(together([123.456])).toEqual(["123.5"]);
    expect(together([1.234])).toEqual(["1.23"]);
    expect(together([1234567])).toEqual(["1,234,567"]); // v1 wrote "1.23M"; v2 writes the value out
  });

  it("15 · drawdown", () => {
    close(v2([100, 120, 90, null, 130, 65], "drawdown"), [0, 0, -25, null, 0, -50]);
  });

  it("16 · rolling correlation window", () => {
    const x = Array.from({ length: 30 }, (_, i) => i);
    const out = rollingCorrelation(x, x.map((v) => 2 * v), { window: 24 });
    expect(out[22]).toBeNull();
    expect(out[23]!.r).toBeCloseTo(1, 9);
    expect(out[29]!.r).toBeCloseTo(1, 9);
  });
});
