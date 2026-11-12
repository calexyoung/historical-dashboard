/**
 * The Explorer on a public-profile Release of agency Series (PLAN M18's acceptance criteria).
 *
 * The Release is made by the real capture kit and release writer from the recorded exchanges in
 * fixtures/capture (invented values), under a test register in which every capturing row carries
 * a decision; the same table is the gate handed to the view. On a gate with no signed row this
 * Release shows nothing on a public Surface, and on the app's own gate it shows a Series only
 * where Alex has signed the row of its Origin in the committed register: both are tested here
 * too, the second from the rows the committed file holds signed (PLAN 6.1, D2).
 *
 * v1's side of each comparison was recorded from v1's own page (checks/v1-links.json).
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAgencyRelease, type AgencyFixture } from "../release/agency-testing";
import { createRightsGate } from "@macro-atlas/core";
import { exportAllowed, exportView, parseCsv } from "../export";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { parseExplorerParams, v1HashToQuery } from "./state";
import { explorerView, V1_PRESETS, type ExplorerView } from "./view";

type V1State = { sel: string[]; mode: string; from: string; to: string; to_is_last_month: boolean; compare_from?: string | null };
type Recorded = { v1_axis: { first_month: string; last_month: string }; presets: { name: string; v1: V1State }[]; links: { hash: string; v1: V1State }[] };
const recorded = JSON.parse(readFileSync(new URL("../../../../checks/v1-links.json", import.meta.url), "utf8")) as Recorded;
const V1_MODE: Record<string, string> = { raw: "lin", log: "log", rebase: "rebase", z: "z", yoy: "pc1", dd: "drawdown" };

let fixture: AgencyFixture;
let release: OpenedRelease;
beforeAll(async () => {
  fixture = buildAgencyRelease();
  // Opened as production opens it: the reader's own guard passes a public-profile Release.
  const opened = await createReleaseReader({ root: fixture.root, surface: "production" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
}, 180_000);

const view = (query: string): ExplorerView => explorerView(release, "production", parseExplorerParams(new URLSearchParams(query)), { gate: fixture.gate });
const held = (key: string): boolean => release.catalog.series.some((e) => e.key === key || (e.aliases ?? []).includes(key));

/**
 * The same view as v1 arrived at, as far as this Release holds its Series; every Series it does
 * not hold is named with a reason. Nothing v1 showed is dropped without a word.
 */
function expectSameViewOrNamed(v: ExplorerView, want: V1State): void {
  expect(v.selection.map((s) => s.key)).toEqual(want.sel.filter(held));
  expect(v.absent.map((a) => a.key)).toEqual(want.sel.filter((k) => !held(k)));
  for (const a of v.absent) {
    expect(a.name, a.key).not.toBe(a.key);
    expect(a.reason.length, a.key).toBeGreaterThan(20);
  }
  // A Series this Release holds is drawn, or says why not (a mode it has no answer for in this window).
  for (const s of v.selection) expect(s.state === "drawn" || (s.state === "not_drawn" && s.reason !== null), `${s.key}: ${s.state}`).toBe(true);
  expect(v.selection.filter((s) => s.state === "withheld" || s.state === "not_permitted")).toEqual([]);
  expect(v.mode).toBe(V1_MODE[want.mode]);
  if (v.window.from !== null || want.from !== recorded.v1_axis.first_month) expect(v.window.from).toBe(want.from);
  if (want.to_is_last_month) expect(v.window.to).toBeNull();
  else expect(v.window.to).toBe(want.to);
  // The link a reader copies from this view still names every Series v1 showed.
  expect(new Set(v.resolved.series)).toEqual(new Set(want.sel));
}

describe("a public-profile release", () => {
  it("is public-profile, holds no legacy series, and has agency series at four frequencies", () => {
    expect(release.manifest.profile).toBe("public");
    expect(release.catalog.series.every((e) => e.representation === "native")).toBe(true);
    const freqs = new Set(release.catalog.series.map((e) => e.freq));
    for (const freq of ["business_daily", "weekly", "monthly", "quarterly"]) expect(freqs.has(freq as never), freq).toBe(true);
  });

  it("shows nothing on a gate with no signed row", () => {
    const unsigned = createRightsGate({ ...fixture.register, rows: fixture.register.rows.map((row) => ({ ...row, decision: null })) });
    const v = explorerView(release, "production", parseExplorerParams(new URLSearchParams("s=unrate,gs10")), { gate: unsigned });
    expect(v.selection.map((s) => s.state)).toEqual(["not_permitted", "not_permitted"]);
    expect(v.figure).toBeNull();
    expect(v.runs).toEqual([]);
  });

  it("shows on the app's own gate only a Series whose Origin's row Alex has signed in the committed register", () => {
    // Read from the file, so that the next row Alex signs changes no test: unrate is the Bureau
    // of Labor Statistics', gs10 the Federal Reserve Board's.
    const committed = JSON.parse(readFileSync(new URL("../../../../schema/rights-register.json", import.meta.url), "utf8")) as { rows: { id: string; decision: { display?: boolean } | null }[] };
    const displays = (id: string): boolean => committed.rows.find((row) => row.id === id)?.decision?.display === true;
    const rowOf = { unrate: "bls", gs10: "fed-board" } as const;
    const v = explorerView(release, "production", parseExplorerParams(new URLSearchParams("s=unrate,gs10")));
    expect(v.selection.map((s) => s.key)).toEqual(["unrate", "gs10"]);
    for (const s of v.selection) expect(s.state !== "not_permitted", s.key).toBe(displays(rowOf[s.key as keyof typeof rowOf]));
    if (!displays("bls") && !displays("fed-board")) {
      expect(v.figure).toBeNull();
      expect(v.runs).toEqual([]);
    }
  });
});

describe("v1's presets on a public-profile release", () => {
  it("are all offered, by v1's names, in v1's order", () => {
    expect(view("").presets.map((p) => p.name)).toEqual(recorded.presets.map((p) => p.name));
    expect(V1_PRESETS.map((p) => p.name)).toEqual(recorded.presets.map((p) => p.name));
  });

  it.each(recorded.presets)("$name opens the same view, or names each series this release does not hold", ({ name, v1: want }) => {
    const preset = view("").presets.find((p) => p.name === name)!;
    const v = view(preset.query);
    expectSameViewOrNamed(v, want);
    expect(parseExplorerParams(new URLSearchParams(preset.query)).cmp).toBe(want.compare_from ?? null);
  });

  it("v1's opening view names the series it cannot show", () => {
    const v = view("");
    expect(v.selection.map((s) => s.key)).toEqual(["unrate", "wti", "cpi_yoy"]);
    expect(v.absent.map((a) => a.name)).toEqual(["S&P 500"]);
    expect(v.mode).toBe("z");
  });
});

describe("v1's recorded hash links on a public-profile release", () => {
  it.each(recorded.links)("$hash", ({ hash, v1: want }) => {
    const query = v1HashToQuery(hash);
    expect(query).not.toBeNull();
    expectSameViewOrNamed(view(query!), want);
  });
});

describe("native frequency", () => {
  it("draws a business-daily, a weekly, a monthly and a quarterly series each at its own frequency", () => {
    const v = view("s=gs10,gas,unrate,gdp&from=2026-01&to=2026-11");
    expect(v.selection.map((s) => [s.key, s.state, s.freq])).toEqual([
      ["gs10", "drawn", "business_daily"],
      ["gas", "drawn", "weekly"],
      ["unrate", "drawn", "monthly"],
      ["gdp", "drawn", "quarterly"],
    ]);
    const runs = Object.fromEntries(v.runs.map((r) => [r.series, r]));
    expect(runs.gs10!.rows[0]!.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Monday to Friday only: a business-daily series has no weekend Period.
    expect(runs.gs10!.rows.every((r) => ![0, 6].includes(new Date(`${r.period}T00:00:00Z`).getUTCDay()))).toBe(true);
    expect(runs.gas!.rows[0]!.period).toMatch(/^\d{4}-W\d{2}$/);
    expect(runs.gdp!.rows[0]!.period).toMatch(/^\d{4}-Q[1-4]$/);
    expect(runs.unrate!.rows[0]!.period).toMatch(/^\d{4}-\d{2}$/);
    // One Period, one row: nothing is spread over a monthly axis.
    expect(runs.gdp!.rows.length).toBeLessThanOrEqual(4);
    expect(runs.gs10!.rows.length).toBeGreaterThan(15);
  });

  it("brings a daily series to months by its declared rule when a common frequency is asked for", () => {
    const daily = view("s=gs10&from=2026-10&to=2026-10").runs[0]!.rows.filter((r) => r.value !== null);
    const v = view("s=gs10,gdp&from=2026-10&to=2026-10&freq=monthly");
    expect(v.selection[0]!.combined).toEqual({ from: "business_daily", to: "monthly", method: "mean" });
    const month = v.runs.find((r) => r.series === "gs10")!.rows;
    expect(month.map((r) => r.period)).toEqual(["2026-10"]);
    expect(month[0]!.value).toBeCloseTo(daily.reduce((sum, r) => sum + r.value!, 0) / daily.length, 9);
    // The quarterly series is slower than a month: it is drawn as it is, and the page says so.
    expect(v.selection[1]!.freq).toBe("quarterly");
    expect(v.notes.join(" ")).toMatch(/quarterly and is drawn as it is/);
  });

  it("lets a daily and a weekly series take part in relationships, combined once from their own periods", () => {
    const v = view("s=gs10,gas,gdp&sx=gs10&sy=gdp");
    expect(v.relationships.left_out).toEqual([]);
    const words = v.relationships.matrix.flat().map((c) => c.words).join(" ");
    expect(words).not.toMatch(/must be brought/);
    expect(v.relationships.pair!.facts[0]).toMatch(/quarterly \(.*business daily, averaged over each quarter/);
    const weekly = view("s=gas,unrate&sx=gas&sy=unrate");
    expect(weekly.relationships.pair!.facts[0]).toMatch(/monthly \(.*weekly, averaged over each month/);
    expect(weekly.relationships.pair!.answer).not.toBeNull();
  });

  it("the quarterly figure a daily series is compared at is combined from its days, not from monthly means", () => {
    const v = view("s=gs10,gdp&basis=lvl&sx=gs10&sy=gdp&table=1");
    const days = view("s=gs10&from=2026-10&to=2026-12").runs[0]!.rows.filter((r) => r.value !== null);
    const months = new Map<string, number[]>();
    for (const r of days) months.set(r.period.slice(0, 7), [...(months.get(r.period.slice(0, 7)) ?? []), r.value!]);
    const ofDays = days.reduce((s, r) => s + r.value!, 0) / days.length;
    const ofMonths = [...months.values()].map((m) => m.reduce((a, b) => a + b, 0) / m.length).reduce((a, b) => a + b, 0) / months.size;
    expect(months.size).toBeGreaterThan(1);
    expect(ofDays).not.toBeCloseTo(ofMonths, 6); // the two rules differ on this fixture, so the test can tell them apart
    const quarter = view("s=gs10&from=2026-10&to=2026-12&freq=quarterly").runs[0]!.rows[0]!;
    expect(quarter.value).toBeCloseTo(ofDays, 9);
    expect(v.relationships.pair!.facts.join(" ")).toMatch(/quarterly/);
  });

  it("a change on the year of a weekly series is taken on months, and every row then has the series' own monthly value beside it", () => {
    const v = view("s=gas&mode=pc1");
    expect(v.selection[0]).toMatchObject({ state: "drawn", freq: "monthly", combined: { from: "weekly", to: "monthly", method: "mean" } });
    const rows = v.runs[0]!.rows;
    expect(v.runs[0]!.freq).toBe("monthly");
    expect(rows.every((r) => /^\d{4}-\d{2}$/.test(r.period))).toBe(true);
    const drawn = rows.filter((r) => r.shown !== null);
    expect(drawn.length).toBeGreaterThan(3);
    expect(drawn.every((r) => r.value !== null)).toBe(true);
    expect(v.readout.series[0]!.freq).toBe("monthly");
  });

  it("answers as of a date from the release's own history", () => {
    const v = view("s=unrate&as_of=2026-11-12");
    expect(v.selection[0]!.basis).toMatch(/atlas_observed|uncertain/);
    const before = view("s=unrate&as_of=2020-01-01");
    expect(before.selection[0]).toMatchObject({ state: "not_drawn", basis: "unavailable" });
    expect(before.runs).toEqual([]);
  });
});

describe("export honours rights, series by series", () => {
  const ADDRESS = "https://example.invalid/macro-atlas/explore";
  const state = (query: string) => parseExplorerParams(new URLSearchParams(query));
  /** The test register with one Origin's row narrowed to display only. */
  const without = (id: string) => createRightsGate({ ...fixture.register, rows: fixture.register.rows.map((row) => (row.id === id && row.decision ? { ...row, decision: { ...row.decision, redistribute: false } } : row)) });

  it("a display-only release renders and exports nothing, with the gate's reason", () => {
    const shown = explorerView(release, "production", state("s=unrate,gs10"), { gate: fixture.displayOnly });
    expect(shown.selection.map((s) => s.state)).toEqual(["drawn", "drawn"]);
    const result = exportView(release, "production", state("s=unrate,gs10"), "csv", { address: ADDRESS, gate: fixture.displayOnly });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect((result as { message: string }).message).toMatch(/redistribute/);
  });

  it("a file holds only the series that may be redistributed, and names the rest with the reason", () => {
    const gate = without("bls");
    const q = "s=unrate,gs10&from=2026-10&to=2026-11";
    const whole = explorerView(release, "production", state(q), { gate });
    const result = exportView(release, "production", state(q), "csv", { address: ADDRESS, gate });
    if (!result.ok) throw new Error(result.message);
    const rows = parseCsv(result.body.split("\n").filter((line) => !line.startsWith("#")).join("\n")).slice(1);
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(["gs10"]));
    expect(rows.map((r) => r[3])).toEqual(whole.runs.find((r) => r.series === "gs10")!.rows.map((r) => r.period));
    const left = result.body.split("\n").find((line) => line.startsWith("# Not in this file"))!;
    expect(left).toMatch(/Unemployment rate.*may not be redistributed here.*redistribute/);
    expect(result.series).toEqual(["gs10"]);
    const svg = exportView(release, "production", state(q), "svg", { address: ADDRESS, gate });
    if (!svg.ok) throw new Error(svg.message);
    expect(svg.body).toMatch(/Not in this picture/);
    expect(svg.body).toMatch(/Unemployment rate/);
    // The window is the view's own, not the narrower one the remaining series would open.
    expect(result.body).toMatch(/from=2026-10&to=2026-11/);
    const offer = exportAllowed(release, "production", ["unrate", "gs10"], { gate });
    expect(offer).toMatchObject({ allowed: true, leftOut: [expect.objectContaining({ key: "unrate" })] });
  });

  it("a derived series is held to the rights of what it is computed from", () => {
    const result = exportView(release, "production", state("s=cpi_yoy"), "csv", { address: ADDRESS, gate: without("bls") });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("an as-of export asks about the series' past as well", () => {
    const result = exportView(release, "production", state("s=gs10&as_of=2026-11-12"), "csv", { address: ADDRESS, gate: fixture.gate });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rightsUsed.length).toBeGreaterThan(0);
  });
});
