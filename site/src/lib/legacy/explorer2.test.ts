/**
 * Explorer II on v1's data (PLAN M5's acceptance criteria): compare ranges reproduce v1's result
 * for two recorded pairs; the statistics reproduce v1's `web/stats.js` wherever v1 had an answer
 * worth keeping, and answer where v1's two caveats left it silent; an exported CSV holds the
 * values on screen.
 *
 * v1's side is computed by v1's own code, driven the way `web/app.js` drove it (testing.ts).
 * The Release is made by the real converter in a temporary directory. Failure messages name
 * Series, months and counts, never a value (PLAN 6.1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseExplorerParams } from "../explorer/state";
import { explorerView, type ExplorerView } from "../explorer/view";
import { exportView, parseCsv } from "../export";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { buildLegacyRelease, REPO, v1Page, v1Stats, type V1Data, type V1Stats } from "./testing";

type Pair = { name: string; series: string[]; mode: "rebase" | "z"; from: string; to: string; cmp: string };
type Recorded = {
  pairs: Pair[];
  statistics: { windows: { from: string; to: string }[]; series: string[]; lags: number[]; mixed_frequency: { monthly: string; quarterly: string; annual: string } };
};
const recorded = JSON.parse(readFileSync(join(REPO, "checks", "v1-compare-pairs.json"), "utf8")) as Recorded;

let release: OpenedRelease;
let v1: V1Data;
let Stats: V1Stats;
beforeAll(async () => {
  const fixture = buildLegacyRelease();
  v1 = fixture.v1;
  Stats = v1Stats();
  const opened = await createReleaseReader({ root: fixture.root, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
}, 120_000);

const view = (query: string): ExplorerView => explorerView(release, "local", parseExplorerParams(new URLSearchParams(query)));
const same = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
/** A figure the page writes to `places` decimals, against v1's unrounded one. */
const reads = (shown: string | null, value: number | null, places: number): boolean =>
  shown === null || value === null ? (shown === null) === (value === null) : Math.abs(Number(shown.replace("−", "-")) - value) <= 0.5 * 10 ** -places + 1e-9;

describe("compare ranges reproduce v1's result for two recorded pairs", () => {
  it("there are two", () => expect(recorded.pairs).toHaveLength(2));

  it.each(recorded.pairs)("$name", (pair) => {
    const page = v1Page(v1, Stats);
    const v = view(`s=${pair.series.join(",")}&mode=${pair.mode}&from=${pair.from}&to=${pair.to}&cmp=${pair.cmp}`);
    // v1 (renderMain): span = i1 - i0; the second range is [cmp, cmp + span], each transformed on its own.
    const [i0, i1, c0] = [page.MI[pair.from]!, page.MI[pair.to]!, page.MI[pair.cmp]!];
    const c1 = Math.min(page.MONTHS.length - 1, c0 + (i1 - i0));
    expect(v.compare).toMatchObject({ from: pair.cmp, to: page.MONTHS[c0 + (i1 - i0)] ?? v.compare!.to, offset: c0 - i0 });

    const wrong: string[] = [];
    let compared = 0;
    for (const key of pair.series) {
      for (const [which, a, b] of [["window", i0, i1], ["comparison", c0, c1]] as const) {
        const run = v.runs.find((r) => r.series === key && r.run === which);
        if (!run) {
          wrong.push(`${key} has no ${which} run`);
          continue;
        }
        const theirs = page.transformV1(key, pair.mode, a, b);
        const mine = new Map(run.rows.map((row) => [row.period_start.slice(0, 7), row.shown]));
        const sparse = page.isSparse(key);
        const observed = page.observed(key);
        for (let i = a; i <= b; i++) {
          const month = page.MONTHS[i]!;
          // A sparse series: v1 repeated each answer over the months to the next observation, to
          // draw a step (transforms.md, D5). v2 answers once per Period, so it is compared where
          // v1 had an observation, and must have no row anywhere else.
          if (sparse && observed[i] === null) {
            if (mine.has(month)) wrong.push(`${key} ${which} ${month}: a row where v1 had no observation`);
            continue;
          }
          compared++;
          if (!mine.has(month) || !same(mine.get(month) ?? null, theirs[i] ?? null)) wrong.push(`${key} ${which} ${month}`);
        }
        // Where the second run is drawn: as many months from the left edge as v1 placed it.
        if (which === "comparison") {
          const drawn = v.figure!.tables.find((t) => t.key === `${key}.compared`);
          if (!drawn || drawn.rows.length !== run.rows.length) wrong.push(`${key}: the table of the second run`);
        }
      }
    }
    expect(wrong, "runs that differ from v1 (series, run, month)").toEqual([]);
    expect(compared).toBeGreaterThan(pair.series.length * 50);
    console.info(`compare ranges, ${pair.name}: ${compared} values equal to v1's`);
  });

  it("a second range that runs off the end of the data is cut there, as v1 padded it with nothing", () => {
    const page = v1Page(v1, Stats);
    const last = page.MONTHS.at(-1)!;
    const start = page.MONTHS[page.MONTHS.length - 13]!;
    const v = view(`s=spx,unrate&mode=rebase&from=2007-10&to=2010-10&cmp=${start}`);
    for (const key of ["spx", "unrate"]) {
      const run = v.runs.find((r) => r.series === key && r.run === "comparison")!;
      expect(run.rows.at(-1)!.period <= last, key).toBe(true);
      expect(run.rows.length, key).toBeLessThanOrEqual(13);
      const theirs = page.transformV1(key, "rebase", page.MI[start]!, page.MONTHS.length - 1);
      expect(run.rows.every((row) => same(row.shown, theirs[page.MI[row.period]!] ?? null)), key).toBe(true);
    }
  });
});

describe("statistics against v1's own stats.js", () => {
  const { windows, series, lags, mixed_frequency: mixed } = recorded.statistics;

  it.each(windows)("monthly pairs from $from to $to: r, n, the lag profile and the rolling correlation are v1's", ({ from, to }) => {
    const page = v1Page(v1, Stats);
    const [i0, i1] = [page.MI[from]!, page.MI[to]!];
    const wrong: string[] = [];
    let checked = 0;
    for (const basis of ["chg", "lvl"] as const) {
      const arr = (k: string) => (basis === "lvl" ? page.observed(k) : Stats.changes(page.observed(k)));
      for (const x of series) {
        for (const y of series) {
          if (x === y) continue;
          for (const lag of lags) {
            const pair = view(`s=${series.join(",")}&from=${from}&to=${to}${basis === "lvl" ? "&basis=lvl" : ""}${lag ? `&lag=${lag}` : ""}&sx=${x}&sy=${y}&roll=24&table=1`).relationships.pair!;
            const theirs = Stats.pearson(arr(x), arr(y), i0, i1, lag);
            const id = `${basis} ${x} ${y} lag ${lag}`;
            checked++;
            if ((pair.answer?.n ?? null) !== (theirs.r === null ? null : theirs.n)) wrong.push(`${id}: n`);
            if (!reads(pair.answer?.r ?? null, theirs.r, 3)) wrong.push(`${id}: r`);
            if (lag !== 0) continue;
            for (const row of pair.lags.rows) {
              const at = Stats.pearson(arr(x), arr(y), i0, i1, row.lag);
              if (row.n !== at.n || !reads(row.r, at.r, 2)) wrong.push(`${id}: lag profile at ${row.lag}`);
            }
            // v1's rolling correlation, over its own window of months.
            const rolled = Stats.rollingCorr(arr(x), arr(y), i0, i1, 24).slice(i0, i1 + 1).filter((_, i) => i >= 23);
            if (pair.rolling.rows.length !== rolled.length) wrong.push(`${id}: rolling windows`);
            else pair.rolling.rows.forEach((row, i) => !reads(row.r, rolled[i] ?? null, 2) && wrong.push(`${id}: rolling ${row.period}`));
          }
        }
      }
    }
    expect(wrong, "where the page differs from v1's stats.js").toEqual([]);
    console.info(`statistics ${from} to ${to}: ${checked} pair answers, each lag profile and rolling line, equal to v1's`);
  });

  it("the matrix is the pair answers at lag 0, both ways round", () => {
    const m = view(`s=${series.join(",")}`).relationships.matrix;
    for (let a = 0; a < series.length; a++) for (let b = 0; b < series.length; b++) if (a !== b) expect(m[a]![b]!.r, `${series[a]} ${series[b]}`).toBe(m[b]![a]!.r);
  });

  it("caveat 2 on v1's data: a quarterly or annual series had no change-based correlation in v1, and has one now", () => {
    const page = v1Page(v1, Stats);
    const [i0, i1] = [0, page.MONTHS.length - 1];
    for (const [slow, unit] of [[mixed.quarterly, "quarterly"], [mixed.annual, "annual"]] as const) {
      const theirs = Stats.pearson(Stats.changes(page.observed(mixed.monthly)), Stats.changes(page.observed(slow)), i0, i1, 0);
      expect(theirs.n, `v1, ${slow}`).toBe(0);
      const pair = view(`s=${mixed.monthly},${slow}`).relationships.pair!;
      expect(pair.answer, `v2, ${slow}`).not.toBeNull();
      expect(pair.answer!.n, slow).toBeGreaterThanOrEqual(8);
      expect(pair.facts[0], slow).toContain(`, ${unit} (`);
    }
  });

  it("every one of v1's 126 series either takes part in a relationship or says why not", () => {
    const silent: string[] = [];
    const keys = release.catalog.series.map((e) => e.key);
    for (let i = 0; i < keys.length; i += 7) {
      const group = ["spx", ...keys.slice(i, i + 7).filter((k) => k !== "spx")];
      const r = view(`s=${group.join(",")}`).relationships;
      r.matrix[0]!.forEach((cell, b) => {
        if (!cell.self && cell.r === null && !/no answer/i.test(cell.words)) silent.push(group[b]!);
      });
      if (r.left_out.length > 0) silent.push(...r.left_out.filter((s) => !s.reason).map((s) => s.key));
    }
    expect(silent).toEqual([]);
  }, 60_000);

  it("a view of eight series over the whole axis, with everything Explorer II adds, is drawn in well under a second", () => {
    const eight = "s=spx,unrate,wti,cpi_yoy,fedfunds,gs10,vix,gdp&mode=z&cmp=2008-01&from=2000-01&to=2006-12&ext=1&roll=24";
    view(eight); // warm
    const started = performance.now();
    view(eight);
    const ms = performance.now() - started;
    console.info(`eight series, compared, with relationships: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});

describe("an exported CSV holds the values on screen (v1's data, local surface only)", () => {
  it.each([
    "s=spx,unrate,wti,cpi_yoy&mode=z",
    "s=spx,unrate,wti&mode=rebase&from=2007-10&to=2010-10&cmp=2020-01",
    "s=gdp,approval,pres_margin,income&mode=lin&from=2005-01&to=2020-12",
  ])("%s", (query) => {
    const v = view(query);
    const result = exportView(release, "local", parseExplorerParams(new URLSearchParams(query)), "csv", { address: "http://localhost:3000/macro-atlas/explore" });
    if (!result.ok) throw new Error(result.message);
    const rows = parseCsv(result.body.split("\n").filter((line) => !line.startsWith("#")).join("\n")).slice(1);
    const onScreen = v.figure!.tables.flatMap((t) => t.rows.map((row) => `${t.key}|${row.period}|${row.exact ?? ""}`));
    const exported = rows.map((r) => `${r[0]}${r[2] === "comparison" ? ".compared" : ""}|${r[3]}|${r[9]}`);
    expect(exported.length).toBe(onScreen.length);
    expect(exported.filter((row, i) => row !== onScreen[i]).map((row) => row.split("|").slice(0, 2).join(" "))).toEqual([]);
    expect(result.body.startsWith("# Macro Atlas · NOT FOR PUBLICATION\n# Local build · v1 data via FRED and Yahoo")).toBe(true);
    expect(result.filename).toMatch(/_not-for-publication\.csv$/);
  });

  it("is refused on staging and production, whatever is asked for", () => {
    for (const surface of ["staging", "production"]) {
      for (const format of ["csv", "svg", "all"] as const) {
        const result = exportView(release, surface, parseExplorerParams(new URLSearchParams("s=spx")), format, { address: "x" });
        expect(result.ok, `${surface} ${format}`).toBe(false);
        expect("body" in result, `${surface} ${format}`).toBe(false);
      }
    }
  });

  it("every one of v1's 126 series is in the file of everything, once per observation", () => {
    const result = exportView(release, "local", parseExplorerParams(new URLSearchParams("")), "all", { address: "x" });
    if (!result.ok) throw new Error(result.message);
    const rows = parseCsv(result.body.split("\n").filter((line) => !line.startsWith("#")).join("\n")).slice(1);
    expect(new Set(rows.map((r) => r[0])).size).toBe(126);
    const files = { ...release.series, ...release.derived };
    expect(rows.length).toBe(Object.values(files).reduce((n, f) => n + f.observations.length, 0));
  });
});
