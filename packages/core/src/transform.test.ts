/**
 * The transform contract (docs/method/transforms.md), tested from that text. Every expected
 * value here is worked out by hand or is a published figure; none comes from the code under test.
 */
import { describe, expect, it } from "vitest";
import { periodBounds, type Frequency } from "./period";
import { SEMANTICS_VERSION, transform, TRANSFORMS, type TransformSeries } from "./transform";

function series(
  freq: Frequency,
  first: string,
  values: (number | null)[],
  continuity: "discrete" | "held" = "discrete",
  labels?: string[],
): TransformSeries {
  const observations = [];
  let label = first;
  for (let i = 0; i < values.length; i++) {
    if (labels) label = labels[i]!;
    const bounds = periodBounds(freq, label)!;
    observations.push({
      period: label,
      period_start: bounds.start,
      period_end: bounds.end,
      value: values[i]!,
      status: values[i] === null ? ("missing" as const) : ("final" as const),
    });
    if (!labels) label = next(freq, label);
  }
  return { freq, continuity, observations };
}
function next(freq: Frequency, label: string): string {
  if (freq === "annual") return String(Number(label) + 1);
  if (freq === "quarterly") {
    const [y, q] = label.split("-Q").map(Number) as [number, number];
    return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
  }
  const [y, m] = label.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const values = (result: ReturnType<typeof transform>): (number | null)[] => {
  if (!result.ok) throw new Error(`unavailable: ${result.reason}`);
  return result.observations.map((o) => o.value);
};
const periods = (result: ReturnType<typeof transform>): string[] => {
  if (!result.ok) throw new Error(`unavailable: ${result.reason}`);
  return result.observations.map((o) => o.period);
};
const close = (got: (number | null)[], want: (number | null)[]): void => {
  expect(got).toHaveLength(want.length);
  got.forEach((value, i) => {
    if (want[i] === null) expect(value).toBeNull();
    else expect(value).toBeCloseTo(want[i]!, 9);
  });
};

describe("the six transforms v1 had", () => {
  it("are named as FRED names them, plus drawdown", () => {
    expect(TRANSFORMS).toEqual(["lin", "log", "rebase", "z", "pc1", "drawdown"]);
    expect(SEMANTICS_VERSION).toBe("0.4.0");
  });

  it("lin returns the values in the window unchanged", () => {
    const s = series("monthly", "2024-01", [3, 4, null, 6]);
    expect(values(transform(s, "lin"))).toEqual([3, 4, null, 6]);
    expect(values(transform(s, "lin", { from: "2024-02-01", to: "2024-03-31" }))).toEqual([4, null]);
  });

  it("log is the natural logarithm, and empty where the value is not above zero", () => {
    const result = transform(series("monthly", "2024-01", [1, Math.E, 0, -1, 100]), "log");
    close(values(result), [0, 1, null, null, 4.605170185988092]);
    if (result.ok) expect(result.observations[2]!.empty).toBe("not_positive");
  });

  it("rebase sets the first value in the window to 100", () => {
    const s = series("monthly", "2024-01", [50, 55, null, 60]);
    const whole = transform(s, "rebase");
    close(values(whole), [100, 110, null, 120]);
    expect(whole.ok && whole.reference).toEqual({ kind: "rebase", period: "2024-01", value: 50 });
    // a window that opens on a gap takes the first value it finds
    const later = transform(s, "rebase", { from: "2024-03-01" });
    close(values(later), [null, 100]);
    expect(later.ok && later.reference).toEqual({ kind: "rebase", period: "2024-04", value: 60 });
  });

  it("rebase is unavailable on a zero or negative base, and with nothing to base on", () => {
    for (const first of [0, -2]) {
      const result = transform(series("monthly", "2024-01", [first, 4, 8]), "rebase");
      expect(result).toMatchObject({ ok: false, reason: "base_not_positive" });
    }
    expect(transform(series("monthly", "2024-01", [null, null]), "rebase")).toMatchObject({ ok: false, reason: "no_values" });
    expect(transform(series("monthly", "2024-01", [1, 2]), "rebase", { from: "2030-01-01" })).toMatchObject({
      ok: false,
      reason: "no_values",
    });
  });

  it("z uses the population standard deviation of the window", () => {
    // mean 5, population sd 2 (the textbook example)
    const result = transform(series("monthly", "2024-01", [2, 4, 4, 4, 5, 5, 7, 9]), "z");
    close(values(result), [-1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2]);
    expect(result.ok && result.reference).toEqual({ kind: "z", mean: 5, sd: 2, n: 8 });
  });

  it("z looks only at the window, and skips gaps", () => {
    const s = series("monthly", "2024-01", [100, 1, null, 3, 100]);
    // window values 1 and 3: mean 2, sd 1
    close(values(transform(s, "z", { from: "2024-02-01", to: "2024-04-30" })), [-1, null, 1]);
  });

  it("z is unavailable when the window values do not vary, or there are none", () => {
    expect(transform(series("monthly", "2024-01", [7, 7, 7]), "z")).toMatchObject({ ok: false, reason: "no_variation" });
    // identical decimals: summing 0.1 three times does not give exactly 0.3, which must not
    // turn into a deviation
    expect(transform(series("monthly", "2024-01", [0.1, 0.1, 0.1]), "z")).toMatchObject({ ok: false, reason: "no_variation" });
    expect(transform(series("monthly", "2024-01", [4.35, null, 4.35, 4.35, 4.35, 4.35, 4.35]), "z")).toMatchObject({ ok: false, reason: "no_variation" });
    expect(transform(series("monthly", "2024-01", [null]), "z")).toMatchObject({ ok: false, reason: "no_values" });
  });

  it("pc1 is the percent change from the observation one year earlier", () => {
    // CPI-U, all items, not seasonally adjusted (BLS): June 2021 271.696, June 2022 296.311.
    // BLS published the 12-month change for June 2022 as 9.1 percent.
    const monthly = [271.696, ...new Array<number | null>(11).fill(null), 296.311];
    const result = transform(series("monthly", "2021-06", monthly), "pc1");
    const june = values(result).at(-1)!;
    expect(june).toBeCloseTo(9.0597, 3);
    expect(Math.round(june * 10) / 10).toBe(9.1);
    if (result.ok) {
      expect(result.observations[0]).toMatchObject({ value: null, empty: "no_year_earlier" });
      expect(result.observations[5]).toMatchObject({ value: null, empty: "missing" });
    }
  });

  it("pc1 counts periods at the native frequency: 4 quarters, 1 year", () => {
    close(values(transform(series("quarterly", "2023-Q1", [100, 200, 300, 400, 110, 190]), "pc1")), [null, null, null, null, 10, -5]);
    close(values(transform(series("annual", "2020", [50, 55, 44]), "pc1")), [null, 10, -20]);
  });

  it("pc1 reads the year before the window", () => {
    const s = series("monthly", "2023-01", [...new Array<number>(12).fill(100), 103, 106]);
    const result = transform(s, "pc1", { from: "2024-01-01" });
    expect(periods(result)).toEqual(["2024-01", "2024-02"]);
    close(values(result), [3, 6]);
  });

  it("pc1 is empty when the earlier value is missing or zero", () => {
    const s = series("annual", "2020", [0, 5, null, 8]);
    const result = transform(s, "pc1");
    close(values(result), [null, null, null, null]);
    if (result.ok) expect(result.observations.map((o) => o.empty)).toEqual(["no_year_earlier", "zero_year_earlier", "missing", "no_year_earlier"]);
  });

  it("pc1 is unavailable where there is no observation one year earlier to count back to", () => {
    const margins = series("irregular", "", [1, 2], "held", ["2020-11-03", "2024-11-05"]);
    expect(transform(margins, "pc1")).toMatchObject({ ok: false, reason: "frequency_not_supported" });
    for (const freq of ["weekly", "daily", "business_daily"] as const) {
      expect(transform({ freq, continuity: "discrete", observations: [] }, "pc1")).toMatchObject({
        ok: false,
        reason: "frequency_not_supported",
      });
    }
  });

  it("drawdown is the percent below the running peak since the window opened", () => {
    const s = series("monthly", "2024-01", [100, 120, 90, 120, 150, 75]);
    close(values(transform(s, "drawdown")), [0, 0, -25, 0, 0, -50]);
    // the peak before the window is forgotten
    close(values(transform(s, "drawdown", { from: "2024-03-01", to: "2024-04-30" })), [0, 0]);
  });

  it("drawdown is empty while the peak is not above zero, and across a gap", () => {
    const result = transform(series("monthly", "2024-01", [-4, -2, null, 8, 6]), "drawdown");
    close(values(result), [null, null, null, 0, -25]);
    if (result.ok) expect(result.observations.map((o) => o.empty)).toEqual(["peak_not_positive", "peak_not_positive", "missing", undefined, undefined]);
  });
});

describe("which observations belong to a window", () => {
  const quarterly = series("quarterly", "2024-Q1", [10, 20, 30, 40]);

  it("a discrete observation belongs when its period starts inside the window", () => {
    // February to May: the first quarter overlaps but began in January; the second began in April
    expect(periods(transform(quarterly, "lin", { from: "2024-02-01", to: "2024-05-31" }))).toEqual(["2024-Q2"]);
    expect(periods(transform(quarterly, "lin", { from: "2024-01-01", to: "2024-07-01" }))).toEqual(["2024-Q1", "2024-Q2", "2024-Q3"]);
    expect(periods(transform(quarterly, "lin", { to: "2024-03-31" }))).toEqual(["2024-Q1"]);
    expect(periods(transform(quarterly, "lin", { from: "2024-10-02" }))).toEqual([]);
  });

  it("an annual observation belongs to a window that holds its first of January", () => {
    const annual = series("annual", "2020", [1, 2, 3]);
    expect(periods(transform(annual, "lin", { from: "2020-06-01", to: "2022-06-30" }))).toEqual(["2021", "2022"]);
  });

  it("for a held series the observation standing when the window opens belongs too, once", () => {
    const held = series("irregular", "", [4, -2, 6], "held", ["2016-11-08", "2020-11-03", "2024-11-05"]);
    const window = { from: "2019-06-01", to: "2022-06-30" };
    expect(periods(transform(held, "lin", window))).toEqual(["2016-11-08", "2020-11-03"]);
    // the standing value is the base: 4 = 100, so -2 is -50
    close(values(transform(held, "rebase", window)), [100, -50]);
    // each observation counts once in z: mean 1, sd 3
    close(values(transform(held, "z", window)), [1, -1]);
    // a window that opens exactly on an observation has nothing standing before it
    expect(periods(transform(held, "lin", { from: "2020-11-03", to: "2021-01-01" }))).toEqual(["2020-11-03"]);
    // and one that opens before the first observation has nothing standing at all
    expect(periods(transform(held, "lin", { from: "2000-01-01", to: "2017-01-01" }))).toEqual(["2016-11-08"]);
  });

  it("a missing observation ends the hold: nothing stands after it", () => {
    const held = series("irregular", "", [4, null, 6], "held", ["2016-11-08", "2020-11-03", "2024-11-05"]);
    expect(periods(transform(held, "lin", { from: "2021-01-01", to: "2025-01-01" }))).toEqual(["2024-11-05"]);
  });

  it("a discrete series gets no standing observation", () => {
    expect(periods(transform(quarterly, "lin", { from: "2024-05-01", to: "2024-06-30" }))).toEqual([]);
  });

  it("refuses a window that is not two calendar dates in order", () => {
    expect(transform(quarterly, "lin", { from: "2024-06-01", to: "2024-01-01" })).toMatchObject({ ok: false, reason: "bad_window" });
    expect(transform(quarterly, "lin", { from: "2024-02-30" })).toMatchObject({ ok: false, reason: "bad_window" });
    expect(transform(quarterly, "lin", { from: "2024-02" })).toMatchObject({ ok: false, reason: "bad_window" });
  });

  it("an answer carries each observation's period, bounds and status, and never the input objects", () => {
    const result = transform(quarterly, "lin");
    if (!result.ok) throw new Error("unavailable");
    expect(result.observations[0]).toEqual({
      period: "2024-Q1",
      period_start: "2024-01-01",
      period_end: "2024-03-31",
      value: 10,
      status: "final",
    });
    expect(result.observations[0]).not.toBe(quarterly.observations[0]);
    expect(result.transform).toBe("lin");
  });

  it("refuses a transform it does not know", () => {
    expect(transform(quarterly, "pch" as never)).toMatchObject({ ok: false, reason: "unknown_transform" });
  });
});

describe("a Series may offer only some transforms (transforms.md, \"Which transforms a Series offers\")", () => {
  const spread = series("monthly", "2024-01", [0.4, -0.1, 0.2]);

  it("a transform the Catalog does not offer for the Series is unavailable, whatever the window holds", () => {
    const result = transform({ ...spread, allowed: ["lin", "z"] }, "pc1");
    expect(result).toMatchObject({ ok: false, reason: "not_offered" });
    if (!result.ok) expect(result.message).toBe("this series does not offer pc1; it offers lin and z");
    expect(transform({ ...spread, allowed: ["lin", "z"] }, "rebase")).toMatchObject({ ok: false, reason: "not_offered" });
  });

  it("an offered transform answers as it always did", () => {
    expect(values(transform({ ...spread, allowed: ["lin", "z"] }, "lin"))).toEqual([0.4, -0.1, 0.2]);
  });

  it("no list recorded means nothing is ruled out, and an empty list is no list", () => {
    expect(transform(spread, "pc1").ok).toBe(true);
    expect(transform({ ...spread, allowed: [] }, "pc1").ok).toBe(true);
  });

  it("an unknown transform is still unknown, not merely not offered", () => {
    expect(transform({ ...spread, allowed: ["lin"] }, "sqrt" as never)).toMatchObject({ ok: false, reason: "unknown_transform" });
  });
});
