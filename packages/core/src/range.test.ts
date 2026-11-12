/**
 * The range across a group's members (docs/method/topics.md), tested from that text. Every
 * expected value is worked out by hand; none comes from the code under test.
 */
import { describe, expect, it } from "vitest";
import { rangeAcross } from "./range";
import { run } from "./testing";

const member = (key: string, first: string, values: (number | null)[], statuses: Record<string, string> = {}) => ({ key, observations: run("monthly", first, values, statuses) });

// The fixture release's own numbers (fixtures/make_fixture.py): the price index's change from a
// year earlier, and three invented economies. A fifth member is declared and has no Series.
const PRICE = [100.0, 100.4, 100.9, 101.1, 101.6, 102.0, 102.3, 102.9, 103.2, 103.8, 104.1, 104.5, 105.0, 105.2, null, 106.3, 106.9, 107.2, 107.8, 108.1, 108.4, 109.0, 109.3, 109.9];
const YOY = PRICE.slice(12).map((now, i) => (now === null ? null : (now / PRICE[i]! - 1) * 100));
const A = member("fx_price_index_yoy", "2025-01", YOY, { "2025-12": "preliminary" });
const B = member("fx_infl_b", "2025-01", [1.2, 1.3, 1.1, 1.4, 1.6, 1.5, 1.7, 1.8, 1.9, 2.1, 2.0, 2.2]);
const C = member("fx_infl_c", "2025-04", [9.4, 9.1, 8.8, 8.6, 8.2, 7.9, 7.7, 7.5, 7.2]);
const D = member("fx_infl_d", "2025-01", [2.6, 2.7, 2.9, 3.0, 3.3, null, 3.4, 3.2, 3.0, 3.2, 3.1, 3.3], { "2025-12": "estimate" });

describe("rangeAcross", () => {
  const answer = rangeAcross([A, B, C, D], { of: 5 });
  const at = (period: string) => answer.periods.find((p) => p.period === period)!;

  it("matches a minimum, median and maximum worked out by hand for a fixture month", () => {
    // November 2025: 109.3 / 104.1 = 1.04995197, so the index's change is 4.995197. B 2.0, C 7.5, D 3.1.
    // In order: 2.0, 3.1, 4.995197, 7.5. Four values, so the median is (3.1 + 4.995197) / 2 = 4.0475985.
    const november = at("2025-11");
    expect(november.n).toBe(4);
    expect(november.minimum).toBe(2.0);
    expect(november.maximum).toBe(7.5);
    expect(november.median).toBeCloseTo(4.0475985, 6);
    expect(november.members).toEqual(["fx_price_index_yoy", "fx_infl_b", "fx_infl_c", "fx_infl_d"]);
    expect(november).toMatchObject({ period_start: "2025-11-01", period_end: "2025-11-30" });
  });

  it("takes the middle value of an odd count", () => {
    // January 2025: the index's change is (105.0 / 100.0 - 1) x 100 = 5; B 1.2; D 2.6. C has not begun.
    const january = at("2025-01");
    expect([january.n, january.minimum, january.median, january.maximum]).toEqual([3, 1.2, 2.6, expect.closeTo(5, 9)]);
  });

  it("states no range for a Period that fewer than the least number of members have a value in", () => {
    // March 2025: the index has a gap and C has not begun. Two of five is not more than half.
    expect(answer.least).toBe(3);
    expect(at("2025-03")).toMatchObject({ n: 2, minimum: null, median: null, maximum: null, members: ["fx_infl_b", "fx_infl_d"] });
  });

  it("does not count an estimate, a projection or a partial Period", () => {
    // December 2025: D is an estimate. The index (preliminary: a published figure), B and C count.
    const december = at("2025-12");
    expect(december.members).toEqual(["fx_price_index_yoy", "fx_infl_b", "fx_infl_c"]);
    expect(december.minimum).toBe(2.2);
    expect(december.maximum).toBe(7.2);
    expect(december.median).toBeCloseTo((109.9 / 104.5 - 1) * 100, 9);
    for (const status of ["projected", "partial"]) {
      const other = rangeAcross([A, B, C, member("fx_infl_d", "2025-12", [3.3], { "2025-12": status })], { of: 5 });
      expect(other.periods.find((p) => p.period === "2025-12")!.members).not.toContain("fx_infl_d");
    }
  });

  it("covers every Period any member has, in order, and keeps the count it was given", () => {
    expect(answer.of).toBe(5);
    expect(answer.periods.map((p) => p.period)).toEqual(A.observations.map((o) => o.period));
    expect(answer.periods.map((p) => p.n)).toEqual([3, 3, 2, 4, 4, 3, 4, 4, 4, 4, 4, 3]);
  });

  it("moves when membership changes, which is why each Period says who was counted", () => {
    // April 2025: C joins at 9.4 and the highest value goes from 5.something to 9.4 with no member's value having moved that far.
    expect(at("2025-02").maximum).toBeCloseTo((105.2 / 100.4 - 1) * 100, 9);
    expect(at("2025-04").maximum).toBe(9.4);
    expect(at("2025-04").members).toContain("fx_infl_c");
  });

  it("is the same whatever order the members are given in, apart from the order it lists them", () => {
    const other = rangeAcross([D, C, B, A], { of: 5 });
    expect(other.periods.map((p) => [p.minimum, p.median, p.maximum])).toEqual(answer.periods.map((p) => [p.minimum, p.median, p.maximum]));
  });

  it("holds the least number to more than half of the declared members unless told otherwise", () => {
    expect(rangeAcross([A, B], { of: 4 }).least).toBe(3);
    expect(rangeAcross([A, B], { of: 5 }).least).toBe(3);
    expect(rangeAcross([A, B], { of: 19 }).least).toBe(10);
    const two = rangeAcross([B, D], { of: 5, least: 2 });
    expect(two.periods.find((p) => p.period === "2025-03")).toMatchObject({ n: 2, minimum: 1.1, median: 2, maximum: 2.9 });
  });

  it("refuses a member given twice, more members than were declared, and a value that is not a number", () => {
    expect(() => rangeAcross([A, A], { of: 5 })).toThrow(/twice/);
    expect(() => rangeAcross([A, B, C], { of: 2 })).toThrow(/more members/);
    expect(() => rangeAcross([member("x", "2025-01", [Infinity])], { of: 1 })).toThrow(/not a finite number/);
  });

  it("refuses members whose Periods are not the same Periods", () => {
    const quarterly = { key: "q", observations: run("quarterly", "2025-Q1", [1, 2]) };
    expect(() => rangeAcross([A, quarterly], { of: 2 })).toThrow(/Periods/);
  });

  it("answers with no Periods for no members", () => {
    expect(rangeAcross([], { of: 5 })).toEqual({ of: 5, least: 3, periods: [] });
  });
});
