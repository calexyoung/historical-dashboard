/**
 * The Explorer's view of a Release (PLAN section 3 and M4), on the synthetic fixture release.
 * Everything the page shows comes from `explorerView(release, surface, state)`; values reach it
 * only through Query, so the rights gate decides.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Surface } from "@macro-atlas/core";
import type { SvgNode } from "../figure";
import { walk } from "../figure/svg";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { FIXTURE_ROOT } from "../release/testing";
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
    expect(v.window).toMatchObject({ from: null, to: null, start: "2022-01-01", end: "2025-12-01" });
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
    expect(layerNodes(all, "event").length).toBe(2);
    expect(layerNodes(all, "band").length).toBe(4); // two terms, in each plot

    const none = view("s=fx_price_index,fx_output_quarterly&layers=none");
    for (const name of ["recession", "event", "band"]) expect(layerNodes(none, name), name).toEqual([]);
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
      ["529.0", "2024 Q2"],
      ["11.5", "2024"],
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

  it("says in one line what a v1 link asks for that the Explorer does not draw yet", () => {
    expect(view("s=fx_price_index&cmp=2020-01&ext=1").carriedNote).toMatch(/second range.*highest and lowest/i);
    expect(view("s=fx_price_index").carriedNote).toBeNull();
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
    expect(v.picker.map((g) => g.label)).toEqual(["Economy & jobs", "Markets & money", "Governance & politics"]);
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
