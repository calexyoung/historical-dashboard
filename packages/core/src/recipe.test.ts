/**
 * Recipes (docs/method/transforms.md, "Recipes"), tested from that text. Expected values are
 * worked out by hand, or are the committed fixture's Derived series, which `make_fixture.py`
 * writes with the plain formula and without this engine.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Frequency } from "./period";
import { evaluateRecipe, mostRestrictiveRights, recipeClosure, type RecipeSeries } from "./recipe";
import { run } from "./testing";
import { SEMANTICS_VERSION } from "./transform";
import { resolve, type ResolveSeries } from "./vintage";

const RELEASE = { releaseId: "20260101T000000Z-0000000" };

type Made = { entry: RecipeSeries; observations?: ReturnType<typeof run> };
const stored = (key: string, freq: Frequency, first: string, values: (number | null)[], more: Partial<RecipeSeries> = {}, statuses: Record<string, string> = {}): Made => ({
  entry: {
    key, freq, unit: "units", unit_kind: "count", measure_kind: "flow", agg: "sum", continuity: "discrete", representation: "native",
    rights: { status: "public_domain" }, source: { origin: { producer: "Agency A", dataset: "Set A" }, channel: { via: "direct" } }, ...more,
  },
  observations: run(freq, first, values, statuses),
});
const derived = (key: string, freq: Frequency, recipe: RecipeSeries["recipe"], more: Partial<RecipeSeries> = {}): Made => ({
  entry: {
    key, freq, unit: "ratio", unit_kind: "ratio", measure_kind: "rate", agg: "none", continuity: "discrete", representation: "native",
    rights: { status: "public_domain" }, source: { origin: { producer: "Agency A", dataset: "Set A" }, channel: { via: "computed" } }, recipe, ...more,
  },
});
function world(...made: Made[]) {
  const catalog = new Map(made.map((m) => [m.entry.key, m.entry]));
  const held = new Map(made.filter((m) => m.observations).map((m) => [m.entry.key, m]));
  const load = (key: string): ResolveSeries | null => {
    const m = held.get(key);
    return m ? { key, freq: m.entry.freq, representation: "native", observations: m.observations! } : null;
  };
  return { catalog, load };
}
const table = (answer: ReturnType<typeof evaluateRecipe>): [string, number | null, string][] => {
  if (answer.unavailable) throw new Error(`unavailable: ${answer.unavailable.reason}: ${answer.unavailable.message}`);
  return answer.observations.map((o) => [o.period, o.value, o.status]);
};
const evaluate = (key: string, w: ReturnType<typeof world>, asOf: string | null = null) => evaluateRecipe(key, w.catalog, w.load, { asOf, ...RELEASE });

describe("the dependency closure", () => {
  it("lists what a Derived series rests on, inputs before what uses them", () => {
    const w = world(
      stored("nominal", "monthly", "2024-01", [1]),
      stored("prices", "monthly", "2024-01", [1]),
      derived("real", "monthly", { op: "ratio", inputs: ["nominal", "prices"], order: "aggregate_then_compute" }),
      derived("real_change", "monthly", { op: "pct_change", inputs: ["real"], order: "aggregate_then_compute", params: { lag: 1 } }),
    );
    expect(recipeClosure("real_change", w.catalog)).toEqual({ ok: true, order: ["nominal", "prices", "real", "real_change"], stored: ["nominal", "prices"], derived: ["real", "real_change"] });
  });

  it("a cyclic recipe fails with the cycle named", () => {
    const w = world(
      stored("x", "monthly", "2024-01", [1]),
      derived("a", "monthly", { op: "sum", inputs: ["x", "b"], order: "aggregate_then_compute" }),
      derived("b", "monthly", { op: "pct_change", inputs: ["c"], order: "aggregate_then_compute", params: { lag: 1 } }),
      derived("c", "monthly", { op: "ratio", inputs: ["x", "a"], order: "aggregate_then_compute" }),
      derived("self", "monthly", { op: "pct_change", inputs: ["self"], order: "aggregate_then_compute", params: { lag: 1 } }),
    );
    const closure = recipeClosure("a", w.catalog);
    expect(closure).toMatchObject({ ok: false, reason: "cycle", cycle: ["a", "b", "c", "a"] });
    expect(!closure.ok && closure.message).toContain("a → b → c → a");
    expect(recipeClosure("self", w.catalog)).toMatchObject({ ok: false, reason: "cycle", cycle: ["self", "self"] });
    const answer = evaluate("c", w);
    expect(answer.unavailable).toMatchObject({ reason: "cycle" });
    expect(answer.unavailable!.message).toContain("c → a → b → c");
    expect(answer.observations).toEqual([]);
  });

  it("an input the catalog does not know, or the Release does not hold, is a failure", () => {
    const w = world(derived("d", "monthly", { op: "pct_change", inputs: ["nowhere"], order: "aggregate_then_compute", params: { lag: 1 } }));
    expect(recipeClosure("d", w.catalog)).toMatchObject({ ok: false, reason: "unknown_input" });
    const w2 = world({ entry: stored("named", "monthly", "2024-01", [1]).entry }, derived("d", "monthly", { op: "pct_change", inputs: ["named"], order: "aggregate_then_compute", params: { lag: 1 } }));
    expect(evaluate("d", w2).unavailable).toMatchObject({ reason: "input_not_held" });
    expect(evaluate("named", w2).unavailable).toMatchObject({ reason: "not_a_recipe" });
  });
});

describe("the arithmetic", () => {
  const a = stored("a", "monthly", "2024-01", [10, 20, null, 40, 50]);
  const b = stored("b", "monthly", "2024-02", [4, 5, 0, 8], {}, { "2024-05": "preliminary" });

  it("ratio, difference, sum and product, Period by Period, with a gap where an input has none", () => {
    const w = world(a, b,
      derived("ratio", "monthly", { op: "ratio", inputs: ["a", "b"], order: "aggregate_then_compute" }),
      derived("diff", "monthly", { op: "difference", inputs: ["a", "b"], order: "aggregate_then_compute" }, { unit: "units", unit_kind: "count" }),
      derived("sum", "monthly", { op: "sum", inputs: ["a", "b", "a"], order: "aggregate_then_compute" }),
      derived("product", "monthly", { op: "product", inputs: ["a", "b"], order: "aggregate_then_compute" }),
    );
    // January has no b; March no a; April's b is zero. A Derived series begins and ends on a value.
    expect(table(evaluate("ratio", w))).toEqual([["2024-02", 5, "final"], ["2024-03", null, "missing"], ["2024-04", null, "missing"], ["2024-05", 6.25, "preliminary"]]);
    expect(table(evaluate("diff", w))).toEqual([["2024-02", 16, "final"], ["2024-03", null, "missing"], ["2024-04", 40, "final"], ["2024-05", 42, "preliminary"]]);
    expect(table(evaluate("sum", w))).toEqual([["2024-02", 44, "final"], ["2024-03", null, "missing"], ["2024-04", 80, "final"], ["2024-05", 108, "preliminary"]]);
    expect(table(evaluate("product", w))).toEqual([["2024-02", 80, "final"], ["2024-03", null, "missing"], ["2024-04", 0, "final"], ["2024-05", 400, "preliminary"]]);
  });

  it("pct_change counts back lag Periods", () => {
    const w = world(stored("x", "quarterly", "2023-Q1", [100, 0, 50, 200, 110, 5], {}, { "2023-Q1": "revised" }),
      derived("yoy", "quarterly", { op: "pct_change", inputs: ["x"], order: "aggregate_then_compute", params: { lag: 4 } }),
      derived("qoq", "quarterly", { op: "pct_change", inputs: ["x"], order: "aggregate_then_compute", params: { lag: 1 } }));
    expect(table(evaluate("yoy", w))).toEqual([["2024-Q1", 10.000000000000009, "revised"]]); // 2024-Q2 on a zero: no value, and trimmed
    expect(table(evaluate("qoq", w))).toEqual([["2023-Q2", -100, "revised"], ["2023-Q3", null, "missing"], ["2023-Q4", 300, "final"], ["2024-Q1", (110 / 200 - 1) * 100, "final"], ["2024-Q2", (5 / 110 - 1) * 100, "final"]]);
  });

  it("a partial Period gives no derived value", () => {
    const w = world(stored("x", "monthly", "2024-01", [100, 110, 121], {}, { "2024-03": "partial" }),
      derived("mom", "monthly", { op: "pct_change", inputs: ["x"], order: "aggregate_then_compute", params: { lag: 1 } }));
    expect(table(evaluate("mom", w)).map((r) => r[0])).toEqual(["2024-02"]);
  });

  it("a Recipe that gives no value at all says so", () => {
    const w = world(stored("x", "monthly", "2024-01", [100, 110]), derived("yoy", "monthly", { op: "pct_change", inputs: ["x"], order: "aggregate_then_compute", params: { lag: 12 } }),
      derived("on_top", "monthly", { op: "pct_change", inputs: ["yoy"], order: "aggregate_then_compute", params: { lag: 1 } }));
    expect(evaluate("yoy", w).unavailable).toMatchObject({ reason: "no_values" });
    expect(evaluate("on_top", w).unavailable).toMatchObject({ reason: "no_values" });
  });

  it("refuses to add or subtract Series in different units, and does not mind for a ratio", () => {
    const percent = stored("p", "monthly", "2024-01", [5, 6], { unit: "percent", unit_kind: "percent" });
    const points = stored("q", "monthly", "2024-01", [1, 2], { unit: "index, 2020 = 100", unit_kind: "index" });
    const thousands = stored("t", "monthly", "2024-01", [1, 2], { unit: "thousands of persons", unit_kind: "count" });
    const persons = stored("u", "monthly", "2024-01", [1, 2], { unit: "persons", unit_kind: "count" });
    const w = world(percent, points, thousands, persons,
      derived("spread", "monthly", { op: "difference", inputs: ["p", "q"], order: "aggregate_then_compute" }),
      derived("total", "monthly", { op: "sum", inputs: ["t", "u"], order: "aggregate_then_compute" }),
      derived("share", "monthly", { op: "ratio", inputs: ["p", "q"], order: "aggregate_then_compute" }));
    expect(evaluate("spread", w).unavailable).toMatchObject({ reason: "incompatible_units" });
    expect(evaluate("spread", w).unavailable!.message).toContain("percent");
    expect(evaluate("total", w).unavailable).toMatchObject({ reason: "incompatible_units" });
    expect(table(evaluate("share", w))).toEqual([["2024-01", 5, "final"], ["2024-02", 3, "final"]]);
  });
});

describe("frequencies and the stated order", () => {
  const monthlyFlow = stored("m", "monthly", "2024-01", [1, 2, 3, 4, 5, 6]);
  const quarterlyFlow = stored("q", "quarterly", "2024-Q1", [3, 5]);

  it("aggregate_then_compute brings each input to the output's frequency first", () => {
    const w = world(monthlyFlow, quarterlyFlow, derived("share", "quarterly", { op: "ratio", inputs: ["m", "q"], order: "aggregate_then_compute" }));
    expect(table(evaluate("share", w))).toEqual([["2024-Q1", 2, "final"], ["2024-Q2", 3, "final"]]);
  });

  it("the two orders differ, and each is what it says", () => {
    const price = stored("price", "monthly", "2024-01", [1, 2, 4], { measure_kind: "index", agg: "mean", unit: "index", unit_kind: "index" });
    const w = world(monthlyFlow, price,
      derived("first", "quarterly", { op: "ratio", inputs: ["m", "price"], order: "aggregate_then_compute" }),
      derived("after", "quarterly", { op: "ratio", inputs: ["m", "price"], order: "compute_then_aggregate" }, { measure_kind: "rate", agg: "mean" }));
    // Sum 6 over mean 7/3; against the mean of 1/1, 2/2 and 3/4.
    expect(table(evaluate("first", w))[0]![1]).toBeCloseTo(18 / 7, 12);
    expect(table(evaluate("after", w))[0]![1]).toBeCloseTo(2.75 / 3, 12);
  });

  it("lag counts Periods of the frequency the arithmetic is done at", () => {
    const months = Array.from({ length: 24 }, (_, i) => (i < 12 ? 10 : 11));
    const w = world(stored("m", "monthly", "2023-01", months),
      derived("annual_change", "annual", { op: "pct_change", inputs: ["m"], order: "aggregate_then_compute", params: { lag: 1 } }),
      derived("mean_of_yoy", "annual", { op: "pct_change", inputs: ["m"], order: "compute_then_aggregate", params: { lag: 12 } }, { measure_kind: "rate", agg: "mean" }));
    expect(table(evaluate("annual_change", w))).toEqual([["2024", 10.000000000000009, "final"]]);
    expect(table(evaluate("mean_of_yoy", w))[0]![0]).toBe("2024");
    expect(table(evaluate("mean_of_yoy", w))[0]![1]).toBeCloseTo(10, 9);
  });

  it("an empty Period at the edge still counts when the result is aggregated", () => {
    // January to March: 10 - 1, 20 - 2, and no March for the second input. A quarter's sum
    // with a month missing is not the quarter's sum; its mean over two of three months is given.
    const a = stored("a", "monthly", "2024-01", [10, 20, 30]);
    const b = stored("b", "monthly", "2024-01", [1, 2, null]);
    const w = world(a, b,
      derived("net_sum", "quarterly", { op: "difference", inputs: ["a", "b"], order: "compute_then_aggregate" }, { measure_kind: "flow", agg: "sum" }),
      derived("net_mean", "quarterly", { op: "difference", inputs: ["a", "b"], order: "compute_then_aggregate" }, { measure_kind: "stock", agg: "mean" }),
      derived("first_missing", "quarterly", { op: "difference", inputs: ["b", "a"], order: "compute_then_aggregate" }, { measure_kind: "flow", agg: "sum" }));
    expect(evaluate("net_sum", w).unavailable).toMatchObject({ reason: "no_values" });
    expect(table(evaluate("net_mean", w))).toEqual([["2024-Q1", 13.5, "final"]]);
    const lead = world(stored("a", "monthly", "2024-01", [null, 20, 30]), stored("b", "monthly", "2024-01", [1, 2, 3]),
      derived("net", "quarterly", { op: "difference", inputs: ["a", "b"], order: "compute_then_aggregate" }, { measure_kind: "flow", agg: "sum" }));
    expect(evaluate("net", lead).unavailable).toMatchObject({ reason: "no_values" });
  });

  it("refuses what the declarations do not cover", () => {
    const w = world(monthlyFlow, quarterlyFlow, stored("undeclared", "monthly", "2024-01", [1, 2, 3], { agg: "none" }),
      derived("mixed", "quarterly", { op: "ratio", inputs: ["m", "q"], order: "compute_then_aggregate" }, { agg: "mean" }),
      derived("too_fine", "monthly", { op: "ratio", inputs: ["m", "q"], order: "aggregate_then_compute" }),
      derived("no_rule", "quarterly", { op: "ratio", inputs: ["undeclared", "q"], order: "aggregate_then_compute" }),
      derived("no_rule_after", "quarterly", { op: "pct_change", inputs: ["m"], order: "compute_then_aggregate", params: { lag: 1 } }));
    expect(evaluate("mixed", w).unavailable).toMatchObject({ reason: "mixed_frequencies" });
    expect(evaluate("too_fine", w).unavailable).toMatchObject({ reason: "input_too_coarse" });
    expect(evaluate("no_rule", w).unavailable).toMatchObject({ reason: "aggregation_not_declared" });
    expect(evaluate("no_rule_after", w).unavailable).toMatchObject({ reason: "aggregation_not_declared" });
  });

  it("computes what a Derived series rests on first", () => {
    const w = world(
      stored("nominal", "monthly", "2024-01", [200, 210, 242]),
      stored("prices", "monthly", "2024-01", [100, 100, 110], { measure_kind: "index", agg: "mean", unit: "index", unit_kind: "index" }),
      derived("real", "monthly", { op: "ratio", inputs: ["nominal", "prices"], order: "aggregate_then_compute" }),
      derived("real_change", "monthly", { op: "pct_change", inputs: ["real"], order: "aggregate_then_compute", params: { lag: 1 } }),
    );
    const got = table(evaluate("real_change", w));
    expect(got.map((r) => r[0])).toEqual(["2024-02", "2024-03"]);
    expect(got[0]![1]).toBeCloseTo(5, 9);
    expect(got[1]![1]).toBeCloseTo((2.2 / 2.1 - 1) * 100, 9);
  });
});

describe("rights", () => {
  it("the most restrictive status wins, and one nobody knows is the most restrictive", () => {
    expect(mostRestrictiveRights(["public_domain", "cc_by"])).toBe("cc_by");
    expect(mostRestrictiveRights(["citation_required", "public_domain", "cc_by"])).toBe("citation_required");
    expect(mostRestrictiveRights(["permission_required", "citation_required"])).toBe("permission_required");
    expect(mostRestrictiveRights(["no_redistribution", "permission_required"])).toBe("no_redistribution");
    expect(mostRestrictiveRights(["unknown", "no_redistribution"])).toBe("unknown");
    expect(mostRestrictiveRights(["public_domain", "made_up"])).toBe("unknown");
    expect(mostRestrictiveRights([])).toBe("unknown");
  });

  it("a Derived series carries the most restrictive rights of everything it rests on, and its whole lineage", () => {
    const w = world(
      stored("open", "monthly", "2024-01", [1, 2]),
      stored("cited", "monthly", "2024-01", [2, 4], { rights: { status: "citation_required" }, source: { origin: { producer: "Agency B", dataset: "Set B" }, channel: { via: "mirror" } } }),
      derived("inner", "monthly", { op: "ratio", inputs: ["open", "cited"], order: "aggregate_then_compute" }),
      derived("outer", "monthly", { op: "product", inputs: ["inner", "open"], order: "aggregate_then_compute" }),
    );
    const answer = evaluate("outer", w);
    expect(answer.rights_status).toBe("citation_required");
    expect(answer.rights_used).toEqual([
      { origin: "Agency A", dataset: "Set A", channel: "computed", representation: "native" },
      { origin: "Agency A", dataset: "Set A", channel: "direct", representation: "native" },
      { origin: "Agency B", dataset: "Set B", channel: "mirror", representation: "native" },
    ]);
    expect(answer.semantics_version).toBe(SEMANTICS_VERSION);
    expect(answer.release_id).toBe(RELEASE.releaseId);
  });
});

// --- against the committed fixture release ---------------------------------------------------

const ROOT = fileURLToPath(new URL("../../../fixtures/public/releases/20260101T000000Z-0000000/", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(ROOT + path, "utf8"));
const fixtureCatalog = new Map<string, RecipeSeries>(read("catalog.json").series.map((e: RecipeSeries) => [e.key, e]));
const vintageKeys = new Set(readdirSync(ROOT + "vintages").map((name) => name.replace(".json", "")));
const fixtureLoad = (key: string): ResolveSeries | null => {
  try {
    const file = read(`series/${key}.json`);
    return { key, freq: file.freq, representation: file.representation, observations: file.observations, vintages: vintageKeys.has(key) ? read(`vintages/${key}.json`) : null };
  } catch {
    return null;
  }
};
const withRecipes = (...made: Made[]) => new Map([...fixtureCatalog, ...made.map((m) => [m.entry.key, m.entry] as const)]);

describe("the fixture release", () => {
  it("the engine reproduces the fixture's Derived series exactly", () => {
    const answer = evaluateRecipe("fx_price_index_yoy", fixtureCatalog, fixtureLoad, RELEASE);
    expect(answer.unavailable).toBeUndefined();
    expect(answer.observations).toEqual(read("derived/fx_price_index_yoy.json").observations);
    expect(answer.basis).toBeNull(); // not an as-of answer
    expect(answer.rights_status).toBe("public_domain");
  });

  it("an as-of answer carries the weakest basis among its inputs", () => {
    // fixtures/README.md: the price index is Atlas-observed from 8 December 2025 with no Capture
    // on 12, 13 and 14 December; quarterly output has the Origin's dated record to 8 December.
    const yoy = (asOf: string) => evaluateRecipe("fx_price_index_yoy", fixtureCatalog, fixtureLoad, { asOf, ...RELEASE });
    expect(yoy("2025-12-11").basis).toBe("atlas_observed");
    expect(yoy("2025-12-13").basis).toBe("uncertain");
    expect(yoy("2025-12-13").inputs).toMatchObject([{ key: "fx_price_index", basis: "uncertain", capture_gap: { missed_days: 1 } }]);
    // As held then: November 2025 was 109.5, preliminary, against 104.1 a year before.
    const november = yoy("2025-12-13").observations.find((o) => o.period === "2025-11")!;
    expect(november.value).toBeCloseTo((109.5 / 104.1 - 1) * 100, 9);
    expect(november.status).toBe("preliminary");

    const catalog = withRecipes(derived("fx_real_output", "quarterly", { op: "ratio", inputs: ["fx_output_quarterly", "fx_price_index"], order: "aggregate_then_compute" }));
    const real = (asOf: string) => evaluateRecipe("fx_real_output", catalog, fixtureLoad, { asOf, ...RELEASE });
    for (const asOf of ["2025-12-11", "2025-12-13"]) {
      const bases = ["fx_output_quarterly", "fx_price_index"].map((key) => resolve(fixtureLoad(key)!, asOf, RELEASE).basis);
      expect(real(asOf).inputs.map((i) => i.basis)).toEqual(bases);
    }
    expect(real("2025-12-11").basis).toBe("atlas_observed");
    expect(real("2025-12-13").basis).toBe("uncertain");
  });

  it("an input with no coverage makes the answer unavailable, never today's figures", () => {
    const catalog = withRecipes(derived("fx_real_output", "quarterly", { op: "ratio", inputs: ["fx_output_quarterly", "fx_price_index"], order: "aggregate_then_compute" }));
    const answer = evaluateRecipe("fx_real_output", catalog, fixtureLoad, { asOf: "2025-11-28", ...RELEASE });
    expect(answer.inputs.map((i) => [i.key, i.basis])).toEqual([["fx_output_quarterly", "provider"], ["fx_price_index", "unavailable"]]);
    expect(answer.basis).toBe("unavailable");
    expect(answer.unavailable).toMatchObject({ reason: "input_unavailable" });
    expect(answer.observations).toEqual([]);
  });

  it("carries the most restrictive rights of its inputs", () => {
    const catalog = withRecipes(derived("fx_mix", "annual", { op: "product", inputs: ["fx_price_index", "fx_poverty_rate_annual"], order: "aggregate_then_compute" }));
    const answer = evaluateRecipe("fx_mix", catalog, fixtureLoad, { asOf: "2025-12-11", ...RELEASE });
    expect(answer.rights_status).toBe("citation_required");
    expect(answer.basis).toBe("uncertain"); // Atlas-observed prices, an uncertain poverty rate
  });

  it("has no answer when an input's versions at the Cutoff were held under more than one metadata it cannot tell apart", () => {
    // On the Origin's clock the answer is the versions the Origin dated; if they were recorded
    // under different metadata (here: the first quarters in millions, the rest in billions)
    // no one unit is in force, and today's must not stand in for it.
    const load = (key: string): ResolveSeries | null => {
      const series = fixtureLoad(key);
      if (!series || key !== "fx_output_quarterly") return series;
      const file = structuredClone(series.vintages!);
      const line = file.metadata[0]!;
      file.metadata.push({ ...line, hash: "f".repeat(64), metadata: { ...line.metadata, unit: "millions of fixture dollars" } });
      for (const row of file.rows) if (row.period < "2023-Q1") row.metadata = "f".repeat(64);
      return { ...series, vintages: file };
    };
    const catalog = withRecipes(derived("fx_output_change", "quarterly", { op: "pct_change", inputs: ["fx_output_quarterly"], order: "aggregate_then_compute", params: { lag: 1 } }));
    const answer = evaluateRecipe("fx_output_change", catalog, load, { asOf: "2025-11-28", ...RELEASE });
    expect(answer.inputs[0]).toMatchObject({ key: "fx_output_quarterly", basis: "provider" });
    expect(answer.unavailable).toMatchObject({ reason: "input_metadata_mixed" });
    expect(answer.observations).toEqual([]);
    // With one metadata throughout, the same question has an answer.
    expect(evaluateRecipe("fx_output_change", catalog, fixtureLoad, { asOf: "2025-11-28", ...RELEASE }).unavailable).toBeUndefined();
  });

  it("leaves out Periods still held under other metadata than was in force", () => {
    // On 10 December 2025 the poverty rate's unit had changed the day before, and 2012 to 2015
    // had not been asked about again: they were still held under the earlier unit.
    const catalog = withRecipes(derived("fx_poverty_change", "annual", { op: "pct_change", inputs: ["fx_poverty_rate_annual"], order: "aggregate_then_compute", params: { lag: 1 } }));
    const answer = evaluateRecipe("fx_poverty_change", catalog, fixtureLoad, { asOf: "2025-12-10", ...RELEASE });
    expect(answer.inputs[0]!.left_out_periods).toEqual(["2012", "2013", "2014", "2015"]);
    expect(answer.observations[0]!.period).toBe("2017"); // 2016 has nothing before it to compare with
  });
});
