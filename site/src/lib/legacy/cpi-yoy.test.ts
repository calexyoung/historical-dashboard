/**
 * PLAN M11 acceptance: "`cpi_yoy` for 2022-06 matches the published figure within tolerance",
 * and the engine's Recipe against v1's own computation of the same thing.
 *
 * The published figure is 9.1 percent (BLS, USDL-22-1470, 13 July 2022: all items over the 12
 * months to June 2022, before seasonal adjustment). No row of the rights register is signed,
 * so no agency value is committed to this repository (PLAN 6.1); the only real CPI values a
 * test may read are v1's, converted into a temporary directory. v1 held the *seasonally
 * adjusted* index, rounded to three decimals, so its twelve-month change sits a little under
 * the unadjusted headline. The tolerance here (0.15) says so. The exact check, 9.1 within
 * 0.05 on the unadjusted index that the series table's `cpi_yoy` is declared over, is
 * `checks/spot.json`: the Node step applies it to every release run that holds that month.
 *
 * Failure messages name Periods and never print a value (PLAN 6.1).
 */
import { evaluateRecipe, type RecipeSeries, type ResolveSeries } from "@macro-atlas/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { buildLegacyRelease } from "./testing";

let release: OpenedRelease;

beforeAll(async () => {
  const opened = await createReleaseReader({ root: buildLegacyRelease().root, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
}, 120_000);

/** The series table's `cpi_yoy` Recipe, asked of v1's `cpi`. */
function engineYoy() {
  const cpi = release.catalog.series.find((entry) => entry.key === "cpi")!;
  const recipe: RecipeSeries = {
    ...cpi, key: "cpi_yoy_by_engine", unit: "percent change from a year earlier", unit_kind: "percent", measure_kind: "rate", agg: "none",
    recipe: { op: "pct_change", inputs: ["cpi"], order: "aggregate_then_compute", params: { lag: 12 } },
  };
  const catalog = new Map<string, RecipeSeries>([["cpi", cpi], [recipe.key, recipe]]);
  const file = release.series.cpi!;
  const load = (key: string): ResolveSeries | null => (key === "cpi" ? { key, freq: file.freq, representation: file.representation, observations: file.observations } : null);
  return evaluateRecipe(recipe.key, catalog, load, { releaseId: release.id });
}

describe("cpi_yoy, the first recipe", () => {
  it("for June 2022 is the published 9.1 percent, within what v1's adjusted, rounded index allows", () => {
    const answer = engineYoy();
    expect(answer.unavailable).toBeUndefined();
    const june = answer.observations.find((o) => o.period === "2022-06");
    expect(june !== undefined && june.value !== null).toBe(true);
    expect(Math.abs(june!.value! - 9.1) <= 0.15).toBe(true);
  });

  it("agrees with v1's own year-over-year series in every month, to v1's two decimals", () => {
    const theirs = new Map(release.derived.cpi_yoy!.observations.map((o) => [o.period, o.value]));
    const ours = engineYoy().observations;
    const compared = ours.filter((o) => o.value !== null && typeof theirs.get(o.period) === "number");
    expect(compared.length).toBeGreaterThan(300); // v1 holds CPI from 2000
    const off = compared.filter((o) => Math.abs(o.value! - theirs.get(o.period)!) > 0.0051).map((o) => o.period);
    expect(off).toEqual([]);
  });
});
