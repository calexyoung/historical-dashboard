/**
 * The Explorer's view of a Release (PLAN section 3 and M4), on the synthetic fixture release.
 * Everything the page shows comes from `explorerView(release, surface, state)`; values reach it
 * only through Query, so the rights gate decides.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createRightsGate, type Surface } from "@macro-atlas/core";
import type { SvgNode } from "../figure";
import { textOf, walk } from "../figure/svg";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { FIXTURE_ROOT, fixtureRegister } from "../release/testing";
import { readoutAt } from "./readout";
import { explorerQuery, parseExplorerParams } from "./state";
import { explorerView, type ExplorerView } from "./view";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const view = (query: string, surface: Surface = "local"): ExplorerView => explorerView(release, surface, parseExplorerParams(new URLSearchParams(query)));
const nodes = (root: SvgNode, test: (n: SvgNode) => boolean) => [...walk(root)].filter(test);
const layerNodes = (v: ExplorerView, name: string) => v.figure!.plots.flatMap((p) => nodes(p.layouts.wide, (n) => n.attrs["data-layer"] === name));

describe("the selection", () => {
  it("draws the series asked for, in the order asked, each named with its unit", () => {
    const v = view("s=fx_output_quarterly,fx_price_index");
    expect(v.selection.map((s) => [s.key, s.state])).toEqual([["fx_output_quarterly", "drawn"], ["fx_price_index", "drawn"]]);
    expect(v.selection[1]).toMatchObject({ name: "Fixture price index", unit: "index, 2024-01 = 100" });
    expect(v.selection[0]!.style).not.toEqual(v.selection[1]!.style);
  });

  it("with nothing asked and none of v1's default series in the release, is empty and says how to begin", () => {
    const v = view("");
    expect(v.selection).toEqual([]);
    expect(v.figure).toBeNull();
    expect(v.mode).toBe("lin");
  });

  it("leaves out a key the release does not have, and says so by key", () => {
    const v = view("s=fx_price_index,no_such_series");
    expect(v.selection.map((s) => s.key)).toEqual(["fx_price_index"]);
    expect(v.notes.join(" ")).toContain("no_such_series");
  });

  it("a withheld series stays in the selection by name with the reason, and no value of it is anywhere", () => {
    const v = view("s=fx_exchange_index,fx_price_index");
    expect(v.selection[0]).toMatchObject({ key: "fx_exchange_index", state: "withheld", reason: "The licence does not allow redistribution." });
    expect(v.figure!.plots.flatMap((p) => p.series.map((s) => s.key))).toEqual(["fx_price_index"]);
    expect(v.readout.series[0]).toMatchObject({ key: "fx_exchange_index", rows: [] });
  });

  it("on a surface where nothing is permitted, every series is named and none has a value", () => {
    const v = view("s=fx_price_index,fx_output_quarterly", "production");
    expect(v.selection.map((s) => s.state)).toEqual(["not_permitted", "not_permitted"]);
    expect(v.figure).toBeNull();
    expect(JSON.stringify(v.readout)).not.toMatch(/10[0-9]\.\d/);
  });

  it("takes at most eight, counted after unknown keys are left out, as v1 did", () => {
    const eight = ["fx_price_index", "fx_output_quarterly", "fx_poverty_rate_annual", "fx_vote_margin", "fx_price_index_yoy", "fx_exchange_index", "fx_payrolls_break", "fx_permits_stale"];
    const v = view(`s=nope,${eight.join(",")},also_nope`);
    expect(v.selection.map((s) => s.key)).toEqual(eight);
  });

  it("each selected series can be removed by an address that keeps everything else", () => {
    const v = view("s=fx_price_index,fx_output_quarterly&mode=z&from=2024-01&layers=rec");
    expect(v.selection[0]!.removeQuery).toBe("s=fx_output_quarterly&mode=z&from=2024-01&layers=rec");
  });
});

describe("modes and which series offer them", () => {
  it("a series that does not offer the mode stays selected, is not drawn, and says why", () => {
    const v = view("s=fx_price_index,fx_price_index_yoy&mode=rebase");
    expect(v.selection.map((s) => s.state)).toEqual(["drawn", "not_drawn"]);
    expect(v.selection[1]!.reason).toMatch(/does not offer/i);
    expect(v.figure!.plots).toHaveLength(1);
  });

  it("a series the engine cannot answer for is not drawn, with the engine's reason", () => {
    const v = view("s=fx_vote_margin&mode=pc1");
    expect(v.selection[0]).toMatchObject({ state: "not_drawn" });
    expect(v.selection[0]!.reason).toMatch(/irregular/);
    expect(v.figure).toBeNull();
  });

  it("says for each mode how many of the selected series offer it", () => {
    const v = view("s=fx_price_index,fx_price_index_yoy&mode=lin");
    const offered = Object.fromEntries(v.modes.map((m) => [m.value, m.offered]));
    expect(offered).toMatchObject({ lin: 2, z: 2, rebase: 1, pc1: 1 });
    expect(v.modes.find((m) => m.current)!.value).toBe("lin");
  });
});

describe("small multiples for mixed units", () => {
  it("as values: one plot per unit", () => {
    const v = view("s=fx_price_index,fx_output_quarterly,fx_payrolls_break");
    expect(v.figure!.plots.map((p) => p.unit)).toEqual(["index, 2024-01 = 100", "billions of fixture dollars", "thousands of jobs"]);
  });

  it("re-expressed in one unit: one plot", () => {
    for (const mode of ["rebase", "z", "drawdown"]) {
      const v = view(`s=fx_price_index,fx_output_quarterly,fx_payrolls_break&mode=${mode}`);
      expect(v.figure!.plots, mode).toHaveLength(1);
      expect(v.figure!.plots[0]!.series).toHaveLength(3);
    }
  });

  it("every plot is on the window's time axis", () => {
    const v = view("s=fx_price_index,fx_output_quarterly&from=2024-01&to=2025-06");
    for (const plot of v.figure!.plots) {
      expect(new Date(Number(plot.layouts.wide.attrs["data-t0"])).toISOString().slice(0, 10)).toBe("2024-01-01");
      expect(new Date(Number(plot.layouts.wide.attrs["data-t1"])).toISOString().slice(0, 10)).toBe("2025-06-30");
    }
    expect(v.window).toMatchObject({ from: "2024-01", to: "2025-06", start: "2024-01-01", end: "2025-06-30" });
  });

  it("an open window runs over everything the selected series hold", () => {
    const v = view("s=fx_price_index,fx_output_quarterly");
    expect(v.window).toMatchObject({ from: null, to: null, start: "2022-01-01", end: "2025-12-31" });
  });

  it("periods a mode has no answer for are not called missing", () => {
    const v = view("s=fx_price_index&mode=pc1");
    expect(v.figure!.states.filter((s) => s.mark === "missing").map((s) => s.text).join(" ")).not.toMatch(/2024/);
    expect(v.notes.join(" ")).toMatch(/Fixture price index.*no value a year earlier/);
  });
});

describe("annotation layers", () => {
  it("offers what the release's annotations hold: recessions, each event category, each band set", () => {
    const v = view("s=fx_price_index");
    expect(v.layers.toggles.map((t) => [t.token, t.label, t.on])).toEqual([
      ["rec", "Recessions", true],
      ["ev.policy", "Economic policy", true],
    ]);
    expect(v.layers.bands.map((b) => [b.token, b.label, b.on])).toEqual([
      ["", "None", true],
      ["gov", "Terms of government", false],
      ["pol", "Policy periods", false],
    ]);
  });

  it("draws what is switched on and nothing that is switched off", () => {
    const all = view("s=fx_price_index,fx_output_quarterly&layers=rec,ev.policy,gov");
    expect(layerNodes(all, "recession").length).toBe(2); // once in each plot
    expect(layerNodes(all, "events").map((n) => n.attrs["data-count"])).toEqual([1, 1]);
    expect(layerNodes(all, "band").length).toBe(4); // two terms, in each plot

    const none = view("s=fx_price_index,fx_output_quarterly&layers=none");
    for (const name of ["recession", "events", "band"]) expect(layerNodes(none, name), name).toEqual([]);
    expect(none.layers.toggles.every((t) => !t.on)).toBe(true);
    expect(none.events).toEqual([]);
  });

  it("one band set at a time: a second one in the address is ignored", () => {
    const v = view("s=fx_price_index&layers=gov,pol");
    expect(v.layers.bands.filter((b) => b.on).map((b) => b.token)).toEqual(["gov"]);
  });

  it("names a band with its holder and the party in words", () => {
    const v = view("s=fx_output_quarterly&layers=gov");
    expect(v.bands.map((b) => b.label)).toEqual(["Fixture head of government, first term (Fixture Party A)", "Fixture head of government, second term (Fixture Party B)"]);
    expect(v.bands.map((b) => b.when)).toEqual(["20 Jan 2021 to 19 Jan 2025", "20 Jan 2025 on"]);
  });

  it("lists the events in the window with date, category and source; outside the window there are none", () => {
    const v = view("s=fx_price_index");
    expect(v.events).toHaveLength(1);
    expect(v.events[0]).toMatchObject({ id: "event-2024-09-18-fixture-rate-decision", when: "18 Sep 2024", category: "Economic policy", label: "Fixture central bank changes its rate", chosen: false });
    expect(v.events[0]!.query).toBe("s=fx_price_index&event=event-2024-09-18-fixture-rate-decision");
    expect(view("s=fx_price_index&from=2025-01").events).toEqual([]);
  });

  it("a chosen event is drawn with its name, and choosing it again lets it go", () => {
    const v = view("s=fx_price_index&event=event-2024-09-18-fixture-rate-decision");
    expect(v.events[0]).toMatchObject({ chosen: true, query: "s=fx_price_index" });
    expect(layerNodes(v, "chosen-event")).toHaveLength(1);
  });

  it("v1's way of choosing an event, by its place in the list, becomes the event itself", () => {
    const v = view("s=fx_price_index&hi=0");
    expect(v.events[0]!.chosen).toBe(true);
    expect(v.resolvedQuery).toContain("event=event-2024-09-18-fixture-rate-decision");
    expect(v.resolvedQuery).not.toContain("hi=");
  });
});

describe("the readout", () => {
  it("stands at the latest date in the window until a date is pinned", () => {
    const v = view("s=fx_price_index,fx_output_quarterly");
    expect(v.pinned).toBeNull();
    expect(v.shownAt).toBe("2025-12-01");
    const rows = readoutAt(v.readout, v.shownAt!).rows;
    expect(rows.map((r) => [r.key, r.value, r.period])).toEqual([
      ["fx_price_index", "109.9", "Dec 2025"],
      ["fx_output_quarterly", "566.4", "2025 Q4"],
    ]);
  });

  it("at a pinned date gives each series the observation whose period contains it", () => {
    const v = view("s=fx_price_index,fx_output_quarterly,fx_poverty_rate_annual,fx_vote_margin&at=2024-05-01");
    expect(v.pinned).toBe("2024-05-01");
    const rows = readoutAt(v.readout, v.pinned!).rows;
    expect(rows.map((r) => [r.value, r.period])).toEqual([
      ["101.6", "May 2024"],
      ["543.6", "2024 Q2"],
      ["10.6", "2024"],
      ["4.5", "3 Nov 2020"], // the result standing in May 2024
    ]);
  });

  it("always has one row per selected series, whatever the date", () => {
    const v = view("s=fx_price_index,fx_exchange_index,fx_permits_stale");
    for (const date of ["2024-01-01", "2025-03-01", "2025-12-01"]) expect(readoutAt(v.readout, date).rows).toHaveLength(3);
    const march = readoutAt(v.readout, "2025-03-01").rows;
    expect(march[0]).toMatchObject({ value: null, note: "No value", period: "Mar 2025" }); // the gap is said, not filled
    expect(march[1]).toMatchObject({ value: null, note: "Withheld: The licence does not allow redistribution." });
    expect(march[2]).toMatchObject({ value: null, note: "No observation covers this date" });
  });

  it("gives the value as drawn beside the series' own when a mode re-expresses it", () => {
    const v = view("s=fx_price_index&mode=rebase&from=2025-01&at=2025-06-01");
    const [row] = readoutAt(v.readout, "2025-06-01").rows;
    expect(row).toMatchObject({ value: "107.2", drawn: "102.1 index" }); // 107.2 / 105.0
  });

  it("draws the pin in every plot, and a pin outside the window is not a pin", () => {
    const v = view("s=fx_price_index,fx_output_quarterly&at=2024-05-01");
    for (const plot of v.figure!.plots) expect(nodes(plot.layouts.narrow, (n) => n.attrs["data-pin"] === "2024-05-01")).toHaveLength(1);
    const outside = view("s=fx_price_index&at=2031-01-01");
    expect(outside.pinned).toBeNull();
    expect(outside.notes.join(" ")).toMatch(/pinned date.*outside/i);
  });

  it("can stop at every period start in the window, of any selected series", () => {
    const v = view("s=fx_output_quarterly,fx_vote_margin&from=2024-01&to=2025-12");
    expect(v.readout.stops).toEqual(["2024-01-01", "2024-04-01", "2024-07-01", "2024-10-01", "2024-11-05", "2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01"]);
  });
});

describe("the address", () => {
  it("is written back as it was read", () => {
    const query = "s=fx_price_index,fx_output_quarterly&mode=z&from=2024-01&to=2025-06&layers=rec&at=2024-05-01";
    expect(view(query).query).toBe(query);
  });

  it("the link to copy says everything outright, so it opens the same view whatever the defaults are", () => {
    const v = view("s=fx_price_index,fx_output_quarterly");
    expect(v.resolvedQuery).toBe("s=fx_price_index,fx_output_quarterly&mode=lin&from=2022-01&to=2025-12&layers=rec,ev.policy");
    const again = view(v.resolvedQuery);
    expect(again.selection.map((s) => s.key)).toEqual(v.selection.map((s) => s.key));
    expect(again.window).toMatchObject({ start: v.window.start });
    expect(again.resolvedQuery).toBe(v.resolvedQuery);
    expect(JSON.stringify(again.figure!.plots.map((p) => p.layouts.wide))).toBe(JSON.stringify(v.figure!.plots.map((p) => p.layouts.wide)));
  });

  it("changing one thing keeps the rest", () => {
    const v = view("s=fx_price_index&mode=z&from=2024-01&layers=rec&at=2024-05-01&cmp=2020-01");
    expect(v.queryWith({ mode: "lin" })).toBe("s=fx_price_index&mode=lin&from=2024-01&layers=rec&at=2024-05-01&cmp=2020-01");
    expect(v.queryWith({ at: null })).toBe("s=fx_price_index&mode=z&from=2024-01&layers=rec&cmp=2020-01");
  });

  it("passes on what the address could not be read for", () => {
    expect(view("s=fx_price_index&mode=sideways").notes.join(" ")).toMatch(/mode/);
  });
});

describe("the picker", () => {
  it("lists every series of the release by segment, ticked where selected; a withheld one cannot be ticked", () => {
    const v = view("s=fx_price_index");
    const all = v.picker.flatMap((g) => g.series);
    expect(all).toHaveLength(release.catalog.series.length);
    expect(v.picker.map((g) => g.label)).toEqual(["Economy & jobs", "Markets & money", "Infrastructure", "Governance & politics"]);
    expect(all.filter((s) => s.checked).map((s) => s.key)).toEqual(["fx_price_index"]);
    expect(all.find((s) => s.key === "fx_exchange_index")).toMatchObject({ available: false, detail: "Withheld" });
  });
});

describe("one release, and nothing but what was asked", () => {
  it("holds values only of series that were selected", () => {
    const v = view("s=fx_poverty_rate_annual");
    const text = JSON.stringify({ ...v, picker: v.picker, queryWith: undefined });
    expect(text).not.toContain("566.4"); // the last quarterly value
    expect(text).not.toContain("109.9"); // the last price index value
  });

  it("has no presets on a release that holds none of their series", () => {
    expect(view("s=fx_price_index").presets).toEqual([]);
  });

  it("round-trips through the state's own writer", () => {
    const state = parseExplorerParams(new URLSearchParams("s=fx_price_index&mode=z"));
    expect(explorerView(release, "local", state).query).toBe(explorerQuery(state));
  });
});

describe("stale is said of a series' latest value only", () => {
  it("a window that closes before the series ends does not call its last value in the window stale", () => {
    expect(view("s=fx_permits_stale").figure!.states.some((s) => s.mark === "stale")).toBe(true);
    expect(view("s=fx_permits_stale&to=2023-12").figure!.states.some((s) => s.mark === "stale")).toBe(false);
  });
});

describe("found in review", () => {
  it("the link to copy keeps a stale mark: a window that still shows the series' latest value still says it is stale", () => {
    const v = view("s=fx_permits_stale");
    expect(v.figure!.states.some((s) => s.mark === "stale")).toBe(true);
    const copied = view(v.resolvedQuery);
    expect(copied.figure!.states.some((s) => s.mark === "stale")).toBe(true);
    expect(JSON.stringify(copied.figure!.plots.map((p) => p.layouts))).toBe(JSON.stringify(v.figure!.plots.map((p) => p.layouts)));
  });

  it("a held value standing through a window that holds no observation of its own can still be read out and pinned", () => {
    const v = view("s=fx_vote_margin&from=2025-01&to=2025-12");
    expect(v.figure).not.toBeNull();
    expect(v.readout.stops).toEqual(["2025-01-01"]);
    expect(v.shownAt).toBe("2025-01-01");
    expect(readoutAt(v.readout, v.shownAt!).rows[0]).toMatchObject({ value: "−1.5", period: "5 Nov 2024" });
  });
});

// --- Explorer II (PLAN M5) ----------------------------------------------------------------------

describe("clearing the selection (v1's \"Clear all\")", () => {
  it("an address that says no series is not the same as one that does not say: it stays empty", () => {
    const v = view("s=fx_price_index,fx_output_quarterly&mode=z");
    const cleared = v.queryWith({ series: [], sx: null, sy: null });
    expect(cleared).toBe("s=&mode=z");
    expect(view(cleared).selection).toEqual([]);
    expect(view(cleared).figure).toBeNull();
  });
});

describe("the snapshot table", () => {
  it("gives each series' first and latest value in the window, the change, and the low and high, each with its period", () => {
    const [row] = view("s=fx_price_index").snapshot;
    expect(row).toMatchObject({
      first: { value: "100.0", period: "Jan 2024" },
      last: { value: "109.9", period: "Dec 2025" },
      change: "+9.9%",
      low: { value: "100.0", period: "Jan 2024" },
      high: { value: "109.9", period: "Dec 2025" },
      latest: "Dec 2025",
      note: null,
    });
    expect(row!.source).toMatch(/fixture/i);
  });

  it("is read from the series' own values, whatever the mode, and follows the window", () => {
    const [row] = view("s=fx_price_index&mode=z&from=2024-06&to=2024-12").snapshot;
    expect(row).toMatchObject({ first: { value: "102.0", period: "Jun 2024" }, last: { value: "104.5", period: "Dec 2024" }, change: "+2.5%" });
  });

  it("gives the change of a percentage in points, and a quarterly series at its own periods", () => {
    const rows = view("s=fx_poverty_rate_annual,fx_output_quarterly,fx_vote_margin").snapshot;
    expect(rows[0]).toMatchObject({ first: { value: "15.0", period: "2012" }, last: { value: "10.4", period: "2025" }, change: "−4.60 pts", low: { period: "2025" }, high: { period: "2012" } });
    expect(rows[1]).toMatchObject({ first: { value: "510.2", period: "2022 Q1" }, last: { value: "566.4", period: "2025 Q4" }, change: "+11.0%" });
    expect(rows[2]).toMatchObject({ first: { value: "3.9" }, last: { value: "−1.5" }, change: "−5.40 pts" });
  });

  it("names a withheld series and gives it no figures", () => {
    const row = view("s=fx_exchange_index").snapshot[0]!;
    expect(row).toMatchObject({ first: null, last: null, change: null });
    expect(row.note).toMatch(/^Withheld: /);
  });
});

describe("marks at the highest and lowest value (ext=1)", () => {
  const marks = (v: ExplorerView) => nodes(v.figure!.plots[0]!.layouts.wide, (n) => n.attrs["data-extreme"] !== undefined).map((n) => [n.attrs["data-extreme"], textOf(n)]);

  it("are off unless asked for", () => {
    expect(marks(view("s=fx_price_index"))).toEqual([]);
    expect(view("s=fx_price_index").extremes).toBe(false);
  });

  it("mark each drawn series' highest and lowest value with the series' own value and period", () => {
    const v = view("s=fx_price_index&ext=1");
    expect(marks(v)).toEqual([["max", "max 109.9 · Dec 2025"], ["min", "min 100.0 · Jan 2024"]]);
    for (const layout of ["narrow", "medium"] as const) expect(nodes(v.figure!.plots[0]!.layouts[layout], (n) => n.attrs["data-extreme"] !== undefined)).toHaveLength(2);
    expect(v.resolvedQuery).toMatch(/&ext=1$/);
  });

  it("are chosen by the value as drawn and named by the value as published (v1's rule)", () => {
    // Furthest below the running peak is not the lowest value.
    const v = view("s=fx_output_quarterly&mode=z&ext=1");
    expect(marks(v)).toEqual([["max", "max 566.4 · 2025 Q4"], ["min", "min 510.2 · 2022 Q1"]]);
  });
});

describe("compare ranges (cmp=)", () => {
  const q = "s=fx_price_index&mode=rebase&from=2024-01&to=2024-06&cmp=2025-04&layers=rec,gov";
  const runs = (v: ExplorerView, run: string) => v.figure!.plots.flatMap((p) => nodes(p.layouts.wide, (n) => n.attrs["data-run"] === run || (run === "window" && n.attrs["data-series"] !== undefined && n.attrs["data-run"] === undefined)));

  it("is a second range of the same length, starting at the month given", () => {
    const v = view(q);
    expect(v.compare).toMatchObject({ from: "2025-04", to: "2025-09", words: "Apr 2025 to Sep 2025", offset: 15 });
    expect(v.compare!.offQuery).toBe("s=fx_price_index&mode=rebase&from=2024-01&to=2024-06&layers=rec,gov");
    expect(v.resolvedQuery).toContain("&cmp=2025-04");
  });

  it("draws each series twice, the second run pale and wide in the same colour, in one plot", () => {
    const v = view(q);
    expect(v.figure!.plots).toHaveLength(1);
    const [first] = runs(v, "window");
    const [second] = runs(v, "comparison");
    expect(second!.attrs.stroke).toBe(first!.attrs.stroke);
    expect(Number(second!.attrs["stroke-width"])).toBeGreaterThan(Number(first!.attrs["stroke-width"]));
    expect(v.figure!.plots[0]!.series.map((s) => [s.name, s.ghost ?? false])).toEqual([["Fixture price index", false], ["Fixture price index, from Apr 2025", true]]);
    expect(v.selection).toHaveLength(1);
    expect(v.selection[0]!.compared).toEqual({ drawn: true, reason: null });
  });

  it("applies the mode to each range on its own: an index is 100 at the start of each", () => {
    const v = view(q);
    const second = v.runs.find((r) => r.run === "comparison")!;
    expect(second.rows.map((r) => r.period)).toEqual(["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09"]);
    expect(second.rows[0]).toMatchObject({ value: 106.3, shown: 100 });
    expect(second.rows[5]!.shown).toBeCloseTo((108.4 / 106.3) * 100, 9);
    expect(v.runs.find((r) => r.run === "window")!.rows[0]).toMatchObject({ period: "2024-01", value: 100, shown: 100 });
  });

  it("the table and the readout name the second run's own periods, not where it is drawn", () => {
    const v = view(q);
    expect(v.figure!.tables.map((t) => [t.name, t.rows[0]!.label])).toEqual([["Fixture price index", "Jan 2024"], ["Fixture price index, from Apr 2025", "Apr 2025"]]);
    const rows = readoutAt(v.readout, "2024-03-01").rows;
    expect(rows.map((r) => [r.name, r.period, r.value])).toEqual([["Fixture price index", "Mar 2024", "100.9"], ["Fixture price index, from Apr 2025", "Jun 2025", "107.2"]]);
  });

  it("draws no layer while two ranges share the axis, and says so", () => {
    const v = view(q);
    for (const name of ["recession", "events", "band"]) expect(layerNodes(v, name), name).toEqual([]);
    expect(v.notes.join(" ")).toMatch(/Layers are not drawn while two ranges are compared/);
    expect(view("s=fx_price_index&from=2024-01&to=2024-06&layers=rec,gov").notes.join(" ")).not.toMatch(/Layers are not drawn/);
  });

  it("a second range that runs past the data is drawn as far as the data goes", () => {
    const v = view("s=fx_price_index&from=2024-01&to=2024-06&cmp=2025-10");
    expect(v.runs.find((r) => r.run === "comparison")!.rows.map((r) => r.period)).toEqual(["2025-10", "2025-11", "2025-12"]);
  });

  it("a series with nothing in the second range is still drawn once, with the reason", () => {
    const v = view("s=fx_price_index&from=2024-01&to=2024-06&cmp=2030-01");
    expect(v.figure!.plots[0]!.series).toHaveLength(1);
    expect(v.selection[0]!.compared).toEqual({ drawn: false, reason: "This series has no value in the range compared with." });
  });

  it("a mode that has no answer over the second range leaves only that run out", () => {
    // The fixture begins in 2024-01, so nothing in the second range has a value a year earlier.
    const v = view("s=fx_price_index&mode=pc1&from=2025-01&to=2025-06&cmp=2024-01");
    expect(v.selection[0]).toMatchObject({ state: "drawn", compared: { drawn: false } });
  });

  it("each run stands on its own: a second run is drawn even when the mode has no answer over the window", () => {
    // Nothing in the first half of 2024 has a value a year earlier; the first half of 2025 does.
    const v = view("s=fx_price_index&mode=pc1&from=2024-01&to=2024-06&cmp=2025-01");
    expect(v.figure).not.toBeNull();
    expect(v.runs.map((r) => r.run)).toEqual(["comparison"]);
    expect(v.selection[0]).toMatchObject({ state: "not_drawn", compared: { drawn: true, reason: null } });
    expect(v.figure!.plots[0]!.series).toMatchObject([{ name: "Fixture price index, from Jan 2025", ghost: true, color: 1 }]);
  });

  it("a period laid over the window covers the whole of the month it is drawn over, whatever their lengths", () => {
    // February 2025 (28 days) is drawn over January 2024 (31): the 30th is still that observation.
    const v = view("s=fx_price_index&from=2024-01&to=2024-06&cmp=2025-02&at=2024-01-30");
    expect(readoutAt(v.readout, "2024-01-30").rows.map((r) => [r.period, r.value])).toEqual([["Jan 2024", "100.0"], ["Feb 2025", "105.2"]]);
    expect(readoutAt(v.readout, "2024-02-29").rows[1]).toMatchObject({ period: "Mar 2025", note: "No value" });
  });

  it("a break is marked in a run only if it falls inside that run's own range", () => {
    const breaksIn = (v: ExplorerView) => v.figure!.plots.flatMap((p) => nodes(p.layouts.wide, (n) => n.attrs["data-mark"] === "break")).length;
    // The payrolls break is at Jan 2025: before a second range that starts in February.
    const after = view("s=fx_payrolls_break&from=2024-01&to=2024-06&cmp=2025-02");
    expect(breaksIn(after)).toBe(0);
    expect(after.figure!.tables.flatMap((t) => t.rows.flatMap((row) => row.states.map((st) => st.mark)))).not.toContain("break");
    // Inside the second range it is drawn where January 2025 is laid: over the window's third month.
    const inside = view("s=fx_payrolls_break&from=2024-01&to=2024-06&cmp=2024-11");
    const marks = inside.figure!.plots.flatMap((p) => nodes(p.layouts.wide, (n) => n.attrs["data-mark"] === "break"));
    expect(marks).toHaveLength(1);
    expect(inside.figure!.tables[1]!.rows.find((row) => row.period === "2025-01")!.states.map((st) => st.mark)).toContain("break");
    // And in the window itself a break from before it is no longer drawn at its edge.
    expect(breaksIn(view("s=fx_payrolls_break&from=2025-03&to=2025-12"))).toBe(0);
    expect(breaksIn(view("s=fx_payrolls_break&from=2024-06&to=2025-12"))).toBe(1);
  });

  it("a second range that starts where the window starts is not one", () => {
    const v = view("s=fx_price_index&from=2024-01&to=2024-06&cmp=2024-01");
    expect(v.compare).toBeNull();
    expect(v.notes.join(" ")).toMatch(/nothing to compare/);
  });

  it("works across frequencies and for a held value: every run starts at the left edge", () => {
    const v = view("s=fx_output_quarterly,fx_vote_margin&from=2022-01&to=2023-12&cmp=2024-01");
    expect(v.runs.filter((r) => r.run === "comparison").map((r) => [r.series, r.rows.map((x) => x.period)])).toEqual([
      ["fx_output_quarterly", ["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]],
      ["fx_vote_margin", ["2020-11-03", "2024-11-05"]],
    ]);
  });
});

describe("relationships", () => {
  const pairQ = "s=fx_price_index,fx_payrolls_break";

  it("needs two series", () => {
    const r = view("s=fx_price_index").relationships;
    expect(r.empty).toMatch(/at least two series/);
    expect(r.pair).toBeNull();
  });

  it("gives r for every pair on changes, with n, and the diagonal is left empty", () => {
    const r = view(pairQ).relationships;
    expect(r.basis).toBe("chg");
    expect(r.matrix).toHaveLength(2);
    expect(r.matrix[0]![0]).toMatchObject({ self: true, r: null, query: null });
    // 24 months; the index has no change in Mar and Apr 2025 (a gap), the payrolls none in Jan 2024
    // (nothing before) or Jan 2025 (a break): 20 months have both.
    expect(r.matrix[0]![1]).toMatchObject({ n: 20, self: false, chosen: true });
    expect(r.matrix[0]![1]!.r).toMatch(/^−?[01]\.\d\d$/);
    expect(r.matrix[0]![1]!.words).toMatch(/^Fixture price index and .+: r = .+ over 20 months\.$/);
    expect(r.matrix[1]![0]!.r).toBe(r.matrix[0]![1]!.r);
  });

  it("the chosen pair is the first two series unless the address names one; a cell's link chooses it", () => {
    const three = "s=fx_price_index,fx_payrolls_break,fx_permits_stale";
    expect(view(three).relationships.pair).toMatchObject({ x: { key: "fx_price_index" }, y: { key: "fx_payrolls_break" } });
    expect(view(three).relationships.matrix[2]![0]!.query).toBe(`${three}&sx=fx_permits_stale&sy=fx_price_index`);
    expect(view(`${three}&sx=fx_permits_stale&sy=fx_price_index`).relationships.pair).toMatchObject({ x: { key: "fx_permits_stale" }, y: { key: "fx_price_index" } });
    // A pair that names a series no longer selected falls back, as v1's did.
    expect(view(`${pairQ}&sx=fx_permits_stale&sy=fx_price_index`).relationships.pair).toMatchObject({ x: { key: "fx_price_index" }, y: { key: "fx_payrolls_break" } });
    expect(view(`${pairQ}&sx=fx_payrolls_break&sy=fx_payrolls_break`).relationships.pair).toMatchObject({ x: { key: "fx_payrolls_break" }, y: { key: "fx_price_index" } });
  });

  it("says what the answer rests on: basis, frequency, window, pairs and gaps", () => {
    const pair = view(pairQ).relationships.pair!;
    expect(pair.answer).toMatchObject({ n: 20 });
    expect(pair.answer!.r).toMatch(/^−?[01]\.\d{3}$/);
    expect(pair.facts).toEqual([
      "Compared on percent change from the month before, monthly.",
      "Window: Jan 2024 to Dec 2025, 24 months.",
      "20 of 24 months have a value for both; 4 do not.",
    ]);
  });

  it("on levels says so, and warns about shared trends", () => {
    const r = view(`${pairQ}&basis=lvl`).relationships;
    expect(r.basis).toBe("lvl");
    expect(r.pair!.facts[0]).toBe("Compared on levels, monthly.");
    expect(r.pair!.answer).toMatchObject({ n: 23 });
    expect(r.guard.join(" ")).toMatch(/both rise or both fall/);
  });

  it("a lag pairs X with Y that many periods later, and every lag is a link", () => {
    const pair = view(`${pairQ}&lag=2`).relationships.pair!;
    expect(pair.facts[2]).toMatch(/^Lag \+2: each month of Fixture price index is paired with .+ 2 months later\. \d+ of the 22 pairs/);
    expect(pair.lags.rows).toHaveLength(49);
    expect(pair.lags.rows.filter((row) => row.current).map((row) => row.lag)).toEqual([2]);
    expect(pair.lags.rows[0]).toMatchObject({ lag: -24, label: "−24 months", r: null });
    expect(pair.lags.rows[23]!.query).toBe(`${pairQ}&lag=-1&sx=fx_price_index&sy=fx_payrolls_break`);
    expect(pair.lags.strongest).toMatch(/Largest \|r\| of the \d+ lags with an answer: .+ It is not evidence|not evidence that one series leads/);
  });

  it("the rolling window is counted in the pair's own periods, and says when it does not fit", () => {
    const short = view(`${pairQ}&roll=24`).relationships.pair!.rolling;
    expect(short).toMatchObject({ span: 24, periods: 24, note: null });
    expect(short.drawing).not.toBeNull();
    const long = view(pairQ).relationships.pair!.rolling;
    expect(long).toMatchObject({ span: 36, periods: 36, drawing: null });
    expect(long.note).toMatch(/window of 36 months inside the range shown/);
  });

  it("a monthly and a quarterly series meet at the quarter, and too few pairs is said, not hidden", () => {
    const r = view("s=fx_price_index,fx_output_quarterly").relationships;
    expect(r.pair!.facts[0]).toBe("Compared on percent change from the quarter before, quarterly (Fixture price index is monthly, averaged over each quarter).");
    expect(r.pair!.answer).toBeNull();
    expect(r.pair!.noAnswer).toBe("No answer: 5 pairs, and fewer than 8 is too few.");
    expect(r.matrix[0]![1]).toMatchObject({ r: null, n: 5 });
    expect(r.pair!.rolling.note).toMatch(/window of 12 quarters/);
  });

  it("two quarterly or annual series have a correlation on changes at their own frequency (v1 had none)", () => {
    const r = view("s=fx_poverty_rate_annual,fx_output_quarterly&basis=lvl").relationships;
    expect(r.pair!.facts[0]).toBe("Compared on levels, annual (Fixture output is quarterly, summed over each year).");
    // An annual window is two or three years: fewer than a correlation needs, and it says so.
    expect(r.pair!.rolling).toMatchObject({ drawing: null, periods: 3 });
    expect(r.pair!.rolling.note).toBe("A window of 36 months is 3 years: fewer than the 8 pairs a correlation needs.");
  });

  it("a held series takes no part, with the reason; a withheld one is named apart", () => {
    const r = view("s=fx_price_index,fx_vote_margin,fx_exchange_index").relationships;
    expect(r.series.map((s) => s.key)).toEqual(["fx_price_index", "fx_vote_margin"]);
    expect(r.left_out).toEqual([{ key: "fx_exchange_index", name: "Fixture exchange index", reason: "The licence does not allow redistribution." }]);
    expect(r.matrix[0]![1]!.words).toMatch(/no answer\. A series whose values stand until the next one/);
    expect(r.pair!.noAnswer).toMatch(/stand until the next one/);
  });

  it("the tables behind the scatter and the rolling line are sent only when the table is asked for", () => {
    const off = view(`${pairQ}&roll=24`).relationships.pair!;
    expect(off.scatter!.rows).toEqual([]);
    expect(off.rolling.rows).toEqual([]);
    const on = view(`${pairQ}&roll=24&table=1`).relationships.pair!;
    expect(on.scatter!.rows).toHaveLength(20);
    expect(on.scatter!.rows[0]).toMatchObject({ xPeriod: "Feb 2024", yPeriod: "Feb 2024" });
    expect(on.rolling.rows).toEqual([{ period: "Dec 2025", r: on.rolling.rows[0]!.r, n: 20 }]);
  });

  it("is guarded, always: descriptive, no cause, and no significance test", () => {
    for (const q of [pairQ, `${pairQ}&basis=lvl`, "s=fx_price_index"]) {
      const text = view(q).relationships.guard.join(" ");
      expect(text).toMatch(/do not say that one moved the other/);
      expect(text).toMatch(/no significance test is shown/);
    }
    const everything = JSON.stringify(view(`${pairQ}&table=1`).relationships);
    expect(everything).not.toMatch(/p\s*[<≥=]\s*0|statistically|strong(ly)? correlat|weak(ly)? correlat/i);
  });

  it("does not depend on the mode or on a second range", () => {
    const plain = JSON.stringify(view(pairQ).relationships.matrix.map((row) => row.map((c) => c.r)));
    expect(JSON.stringify(view(`${pairQ}&mode=log&cmp=2025-01&from=2024-01&to=2025-12`).relationships.matrix.map((row) => row.map((c) => c.r)))).toBe(plain);
  });
});

// --- M18 ------------------------------------------------------------------------------------------

describe("M18: as of a date", () => {
  it("answers with what was held before the date, says the Basis of each series, and keeps as_of in every address", () => {
    const v = view("s=fx_price_index&as_of=2025-12-10");
    expect(v.asOf).toMatchObject({ date: "2025-12-10", basis: "atlas_observed" });
    expect(v.selection[0]).toMatchObject({ state: "drawn", basis: "atlas_observed" });
    // November was first held on 10 December, after the Cutoff: it is not in the answer.
    expect(v.runs[0]!.rows.at(-1)!.period).toBe("2025-10");
    expect(v.resolvedQuery).toContain("as_of=2025-12-10");
    expect(v.selection[0]!.removeQuery).toContain("as_of=2025-12-10");
    expect(v.asOf!.offQuery).not.toContain("as_of");
  });

  it("claims the weakest Basis among what is drawn", () => {
    const v = view("s=fx_price_index,fx_output_quarterly&as_of=2025-12-13");
    expect(v.selection.map((s) => s.basis)).toEqual(["uncertain", "provider"]);
    expect(v.asOf!.basis).toBe("uncertain");
  });

  it("an unavailable answer is never filled with today's figure: the series is named, with the reason, and has no value", () => {
    const v = view("s=fx_price_index&as_of=2025-01-01&cmp=2024-01&from=2025-01&to=2025-06");
    expect(v.selection[0]).toMatchObject({ state: "not_drawn", basis: "unavailable" });
    expect(v.selection[0]!.reason).toMatch(/held nothing|no coverage|not know/i);
    expect(v.figure).toBeNull();
    expect(v.runs).toEqual([]);
    expect(v.readout.series[0]!.rows).toEqual([]);
    expect(v.snapshot[0]!.first).toBeNull();
  });

  it("names a series by the unit in force then, and says which periods were still held under other metadata", () => {
    const before = view("s=fx_poverty_rate_annual&as_of=2025-12-09");
    const today = view("s=fx_poverty_rate_annual");
    expect(before.selection[0]!.unit).not.toBe(today.selection[0]!.unit);
    const after = view("s=fx_poverty_rate_annual&as_of=2025-12-13");
    expect(after.selection[0]!.unit).toBe(today.selection[0]!.unit);
    expect(after.notes.join(" ")).toMatch(/2012, 2013, 2014 and 2015/);
  });

  it("says nothing of today in an as-of view: no stale mark and no latest value", () => {
    const v = view("s=fx_permits_stale&as_of=2025-12-13");
    expect(v.figure?.plots.flatMap((p) => p.series).every((s) => !("stale" in s) || !s.stale)).not.toBe(false);
    expect(v.snapshot[0]!.latest).toBeNull();
  });

  it("an as-of date Query cannot read is refused in words, not answered with today", () => {
    const v = view("s=fx_price_index&as_of=1850-01-01");
    expect(v.asOf).toBeNull();
    expect(v.notes.join(" ")).toMatch(/as-of date/);
  });
});

describe("M18: a common frequency", () => {
  it("combines every finer series by its own declared rule and leaves a slower one as it is, saying both", () => {
    const v = view("s=fx_price_index,fx_output_quarterly,fx_poverty_rate_annual&freq=quarterly");
    const byKey = Object.fromEntries(v.runs.map((r) => [r.series, r]));
    expect(byKey.fx_price_index!.freq).toBe("quarterly");
    expect(byKey.fx_price_index!.rows[0]!.period).toMatch(/^\d{4}-Q[1-4]$/);
    expect(byKey.fx_output_quarterly!.freq).toBe("quarterly");
    expect(byKey.fx_poverty_rate_annual!.freq).toBe("annual");
    expect(v.selection[0]!.combined).toMatchObject({ from: "monthly", to: "quarterly", method: "mean" });
    expect(v.notes.join(" ")).toMatch(/Fixture price index.*monthly.*averaged over each quarter/);
    expect(v.notes.join(" ")).toMatch(/annual.*drawn as it is/i);
    expect(v.resolvedQuery).toContain("freq=quarterly");
  });

  it("a quarterly mean of a monthly index is the mean of its three months", () => {
    const monthly = view("s=fx_price_index&from=2025-04&to=2025-06").runs[0]!.rows.map((r) => r.value!);
    const quarterly = view("s=fx_price_index&from=2025-04&to=2025-06&freq=quarterly").runs[0]!.rows;
    expect(monthly).toHaveLength(3);
    expect(quarterly).toHaveLength(1);
    expect(quarterly[0]!.value).toBeCloseTo((monthly[0]! + monthly[1]! + monthly[2]!) / 3, 9);
  });

  it("a series that does not say how its periods combine is not drawn, with the reason", () => {
    const v = view("s=fx_price_index_yoy&freq=annual");
    expect(v.selection[0]).toMatchObject({ state: "not_drawn" });
    expect(v.selection[0]!.reason).toMatch(/combine|aggregat/i);
  });
});

describe("M18: a series the release does not hold, a gate handed in, a pin", () => {
  it("names a Catalog series this release does not hold, with the Catalog's reason", () => {
    const v = view("s=fx_price_index,spx,no_such_series");
    expect(v.absent).toEqual([expect.objectContaining({ key: "spx", name: "S&P 500" })]);
    expect(v.absent[0]!.reason).toMatch(/licensed/);
    expect(v.notes.join(" ")).toContain("no_such_series");
    expect(v.resolved.series).toEqual(["fx_price_index"]);
  });

  it("asks the gate it is handed (a test's own register), for values and for the picker", () => {
    const gate = createRightsGate(fixtureRegister({ display: true, redistribute: false }));
    const v = explorerView(release, "production", parseExplorerParams(new URLSearchParams("s=fx_price_index")), { gate });
    expect(v.selection[0]!.state).toBe("drawn");
    expect(v.picker.flatMap((g) => g.series).find((s) => s.key === "fx_price_index")!.available).toBe(true);
    // The committed register signs nothing: without the argument nothing is shown.
    expect(view("s=fx_price_index", "production").selection[0]!.state).toBe("not_permitted");
  });

  it("carries a pin through every address the page links to", () => {
    const pin = "20260101T000000Z-0000000";
    const v = view(`s=fx_price_index,fx_output_quarterly&pin=${pin}`);
    for (const query of [v.query, v.resolvedQuery, v.selection[0]!.removeQuery, v.queryWith({ mode: "z" }), v.queryWith({ table: true })]) expect(query).toContain(`pin=${pin}`);
  });

  it("offers the engine's other changes, each in a unit of its own", () => {
    const v = view("s=fx_price_index&mode=pch");
    expect(v.mode).toBe("pch");
    expect(v.figure!.plots[0]!.unitLine).toMatch(/percent change from the period before/i);
    expect(view("s=fx_price_index&mode=chg").figure!.plots[0]!.unitLine).toMatch(/change from the period before/i);
  });
});
