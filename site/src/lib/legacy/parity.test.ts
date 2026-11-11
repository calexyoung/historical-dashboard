/**
 * M2's parity criterion: for every one of v1's 126 series, the engine's six Transforms match
 * what v1's own `web/stats.js` gave, over three recorded windows. A difference is allowed only
 * if it is one of the deliberate fixes listed in docs/method/transforms.md (D1 to D6), and each
 * of those is checked against v1's own function applied at the Series' real cadence.
 *
 * v1's side is computed by v1's code: the dataset comes from v1's build step and the arithmetic
 * from web/stats.js, driven exactly as web/app.js `transform()` drove it (copied below).
 * Failure messages name the Series, Transform, window and Period, never a value (PLAN 6.1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { transform, TRANSFORMS, type TransformName, type TransformResult } from "@macro-atlas/core";
import type { CatalogEntry, SeriesFile } from "@macro-atlas/core/release";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { catalogView, parseCatalogFilters, releaseHoldsLegacy } from "../catalog";
import { query } from "../query";
import { buildLegacyRelease, REPO, v1Page, v1Stats, type LegacyFixture, type V1Data, type V1Stats } from "./testing";

type Arr = (number | null)[];
type WindowSpec = { name: string; from: string; to: string };
const WINDOWS = (JSON.parse(readFileSync(join(REPO, "checks", "v1-parity-windows.json"), "utf8")) as { windows: WindowSpec[] }).windows;
const V1_MODE: Record<TransformName, string> = { lin: "raw", log: "log", rebase: "rebase", z: "z", pc1: "yoy", drawdown: "dd" };

const same = (a: number | null, b: number | null): boolean => {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
};
const lastDay = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

type Deliberate = "D1" | "D2" | "D3" | "D4";
type Tally = {
  compared: number;
  equal: number;
  deliberate: Record<Deliberate, number>;
  /** D5: months where v1 showed a repeated (filled) value and v2 has no row or an explicit gap. */
  plotFill: number;
  /** D4: months of approval that v1 made by repeating a quarter. */
  approvalMonths: number;
  /** Series x windows whose membership was checked against v1's own month list. */
  windows: number;
  /** D6: `log` values compared through exp(v2) = v1. */
  logMapped: number;
  unexplained: string[];
  wronglyFixed: string[];
};

function compare(release: OpenedRelease, DB: V1Data, Stats: V1Stats): Tally {
  const page = v1Page(DB, Stats);
  const tally: Tally = {
    compared: 0,
    equal: 0,
    deliberate: { D1: 0, D2: 0, D3: 0, D4: 0 },
    plotFill: 0,
    approvalMonths: 0,
    windows: 0,
    logMapped: 0,
    unexplained: [],
    wronglyFixed: [],
  };
  const files: Record<string, SeriesFile> = { ...release.series, ...release.derived };

  for (const entry of release.catalog.series as CatalogEntry[]) {
    const key = entry.key;
    const file = files[key]!;
    const input = { freq: file.freq, continuity: entry.continuity, observations: file.observations };
    for (const w of WINDOWS) {
      const i0 = page.MI[w.from]!;
      const i1 = page.MI[w.to]!;
      const window = { from: `${w.from}-01`, to: lastDay(w.to) };
      // The Observations that belong to the window, and the v1 month each sits on. The standing
      // Observation of a held Series began before the window: v1 shows it from the first month.
      const members = transform(input, "lin", window);
      if (!members.ok) throw new Error(`${key}: lin is unavailable`);
      const at = members.observations.map((o) => Math.max(i0, page.MI[o.period_start.slice(0, 7)]!));
      const native = members.observations.map((o) => o.value);

      // Which Observations ought to be there is worked out from v1's own month list and the
      // written rule, not taken from the engine: a dropped Observation must not pass as "fill".
      const v1Months = DB.series[key]!.d;
      const inWindow = v1Months.filter((m) => m >= w.from && m <= w.to);
      let expected = inWindow;
      if (key === "approval") {
        expected = inWindow.filter((m) => [1, 4, 7, 10].includes(Number(m.slice(5)))); // one per quarter
      } else if (entry.continuity === "held") {
        const standing = v1Months.filter((m) => m < w.from).at(-1);
        if (standing !== undefined && !v1Months.includes(w.from)) expected = [standing, ...inWindow];
      }
      const got = members.observations.filter((o) => o.value !== null).map((o) => o.period_start.slice(0, 7));
      if (got.length !== expected.length || got.some((m, n) => m !== expected[n])) {
        tally.unexplained.push(`${key} [${w.from}..${w.to}]: the observations in the window are not the ones v1 holds there`);
      }
      const v1Has = new Set(v1Months);
      for (const o of members.observations) {
        if (o.value === null && v1Has.has(o.period_start.slice(0, 7))) {
          tally.unexplained.push(`${key} [${w.from}..${w.to}] ${o.period}: a gap where v1 has a value`);
        }
      }
      const observed = page.observed(key);
      tally.windows++;
      const onQuarters = [1, 4, 7, 10].includes(Number(w.from.slice(5))) && [3, 6, 9, 12].includes(Number(w.to.slice(5)));

      for (const name of TRANSFORMS) {
        const v1 = page.transformV1(key, V1_MODE[name], i0, i1);
        const v2: TransformResult = transform(input, name, window);
        const v2Values = v2.ok ? v2.observations.map((o) => o.value) : native.map(() => null);
        const where = `${key} ${name} [${w.from}..${w.to}]`;

        // Rows v1 showed that are not Observations. Each must be demonstrably a repeated value:
        // a month v1 itself holds no value for (D5), or one of approval's extra months (D4).
        const memberMonths = new Set(at);
        for (let i = i0; i <= i1; i++) {
          if (v1[i] == null || memberMonths.has(i)) continue;
          if (observed[i] === null) tally.plotFill++;
          else if (key === "approval") tally.approvalMonths++;
          else tally.unexplained.push(`${where}: v1 answers for an observation the engine leaves out`);
        }

        let differs = false;
        members.observations.forEach((o, n) => {
          let theirs = v1[at[n]!] ?? null;
          if (o.value === null) {
            // An explicit gap. v2 must be empty; if v1 shows a number here it is a repeated one (D5).
            if (v2Values[n] !== null) tally.unexplained.push(`${where} ${o.period}: a value where the observation is missing`);
            if (theirs !== null) tally.plotFill++;
            return;
          }
          if (name === "log" && theirs !== null) {
            theirs = Math.log(theirs); // D6
            tally.logMapped++;
          }
          tally.compared++;
          if (same(v2Values[n]!, theirs)) tally.equal++;
          else differs = true;
        });
        if (!differs) continue;

        // A difference. It must be a declared one, and then v2 must be what v1's own function
        // gives at the Series' real cadence.
        const nativeFn = (fn: "rebase" | "zscore" | "drawdown"): Arr => Stats[fn](native, 0, native.length - 1);
        const matchesNative = (expected: Arr): boolean => expected.every((value, n) => same(v2Values[n]!, value));
        const firstValue = native.find((value) => value !== null) ?? null;
        let cls: Deliberate | null = null;
        let sound = false;
        if (name === "rebase" && !v2.ok && v2.reason === "base_not_positive" && firstValue !== null && firstValue < 0) {
          cls = "D1";
          sound = true;
        } else if (name === "z" && entry.continuity === "held") {
          cls = "D2";
          sound = matchesNative(nativeFn("zscore"));
        } else if (name === "pc1" && file.freq === "irregular") {
          cls = "D3";
          sound = !v2.ok && v2.reason === "frequency_not_supported";
        } else if (key === "approval" && !onQuarters && (name === "rebase" || name === "z" || name === "drawdown")) {
          cls = "D4";
          sound = matchesNative(nativeFn(name === "z" ? "zscore" : name));
        }
        if (cls === null) tally.unexplained.push(where);
        else {
          tally.deliberate[cls]++;
          if (!sound) tally.wronglyFixed.push(`${where} (${cls})`);
        }
      }
    }
  }
  return tally;
}

let legacy: LegacyFixture;
let release: OpenedRelease;
let tally: Tally;

beforeAll(async () => {
  legacy = buildLegacyRelease();
  const opened = await createReleaseReader({ root: legacy.root, surface: "local" }).current();
  if (!opened.ok) throw new Error(`the legacy release could not be opened: ${opened.kind}: ${opened.reason}`);
  release = opened.release;
  tally = compare(release, legacy.v1, v1Stats());
}, 120_000);

describe("v1's data through the release reader, Query and the catalog (PLAN M2, 6.1)", () => {
  it("the local surface lists all 126 series with a latest value, every one marked as v1's legacy output", () => {
    const view = catalogView(release, "local", parseCatalogFilters({}));
    expect(view.total).toBe(126);
    expect(view.rows.every((row) => row.legacy && row.state === "shown" && row.latest !== null && row.rights === "Not settled")).toBe(true);
    expect(view.facets.freq.map((f) => [f.label, f.count])).toEqual([
      ["Monthly", 105],
      ["Quarterly", 13],
      ["Annual", 6],
      ["Irregular", 2],
    ]);
    expect(releaseHoldsLegacy(release)).toBe(true);
  });

  it("Query answers on the local surface and names the lineage of a computed series, both inputs included", () => {
    const answer = query(release, "local", { series: ["gold_eur"], transform: "lin", permission: "display" });
    if (!answer.ok) throw new Error(answer.code);
    expect(answer.series[0]!.representation).toBe("legacy_monthly_rounded");
    expect(answer.rights_used.map((row) => row.channel).sort()).toEqual(["computed", "fred", "yahoo"]);
    expect(new Set(answer.rights_used.map((row) => row.representation))).toEqual(new Set(["legacy_monthly_rounded"]));
  });

  it("no other surface gets a value out of it: the gate denies, and the reader refuses the release outright", async () => {
    for (const surface of ["staging", "production"] as const) {
      // Only named fields are compared: were the gate to fail, the answer would hold v1's values,
      // and a whole-object assertion would print them (PLAN 6.1).
      const answer = query(release, surface, { series: ["unrate"], transform: "lin", permission: "display" });
      expect(answer.ok).toBe(false);
      expect(answer.ok ? null : [answer.status, answer.code]).toEqual([403, "not_permitted"]);
      const rows = catalogView(release, surface, parseCatalogFilters({})).rows;
      expect(rows.every((row) => row.latest === null && row.first === null)).toBe(true);
      const opened = await createReleaseReader({ root: legacy.root, surface }).current();
      expect(opened.ok).toBe(false);
      expect(opened.ok ? null : opened.kind).toBe("refused");
    }
  });
});

describe("the six transforms match v1's stats.js for every v1 series", () => {

  it("reads all 126 series through the release reader, with a quarterly, an annual and a held one among them", () => {
    expect(release.catalog.series).toHaveLength(126);
    expect(release.manifest.profile).toBe("local");
    const kinds = new Set(release.catalog.series.map((e) => `${e.freq}/${e.continuity}`));
    expect([...kinds].sort()).toEqual(["annual/discrete", "irregular/held", "monthly/discrete", "quarterly/discrete"]);
  });

  it("uses three recorded windows", () => {
    expect(WINDOWS.map((w) => [w.from, w.to])).toEqual([
      ["2000-01", "2026-10"],
      ["2007-10", "2010-10"],
      ["2019-06", "2022-06"],
    ]);
  });

  it("has no difference from v1 that is not a listed, deliberate fix", () => {
    expect(tally.unexplained).toEqual([]);
    expect(tally.windows).toBe(126 * 3); // every series, every window: membership checked against v1's months
    expect(tally.compared).toBeGreaterThan(100_000);
  });

  it("every deliberate difference is what v1's own function gives at the series' real cadence", () => {
    expect(tally.wronglyFixed).toEqual([]);
  });

  it("each listed difference really occurs, so the list in transforms.md is not stale", () => {
    for (const cls of ["D1", "D2", "D3", "D4"] as const) expect(tally.deliberate[cls], cls).toBeGreaterThan(0);
    expect(tally.plotFill, "D5").toBeGreaterThan(0);
    expect(tally.approvalMonths, "D4 months").toBeGreaterThan(0);
    expect(tally.logMapped, "D6").toBeGreaterThan(0);
    const doc = readFileSync(join(REPO, "docs", "method", "transforms.md"), "utf8");
    for (const cls of ["D1", "D2", "D3", "D4", "D5", "D6"]) expect(doc).toContain(`**${cls}**`);
  });

  it("reports how much was compared (counts only)", () => {
    const { compared, equal, deliberate, plotFill, logMapped } = tally;
    console.info(`v1 parity: ${compared} values compared, ${equal} equal; deliberate differences by series x transform x window: ${JSON.stringify(deliberate)}; plot-fill rows not carried (D5): ${plotFill}; log values mapped (D6): ${logMapped}`);
    expect(equal).toBeLessThanOrEqual(compared);
  });
});
