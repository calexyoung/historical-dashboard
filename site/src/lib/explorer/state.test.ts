/**
 * The Explorer's address (PLAN section 3 and M4): what an address says, how a view is written
 * back as one, and what v1's hash links become. The expectations for v1's links were recorded
 * from v1's own page (checks/v1-links.json, scripts/record-v1-links.py), not written from this code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explorerQuery, parseExplorerParams, v1HashToQuery, type ExplorerState } from "./state";

const parse = (query: string): ExplorerState => parseExplorerParams(new URLSearchParams(query));

type Recorded = {
  v1_axis: { first_month: string; last_month: string };
  links: { hash: string; v1: { sel: string[]; mode: string; from: string; to: string; recessions: boolean; events: boolean; event_categories: string[]; bands: string; highlighted_event: null | { title: string }; compare_from: string | null; max_min: boolean; basis: string; lag: number; sx: string | null; sy: string | null; roll: number } }[];
};
const recorded = JSON.parse(readFileSync(new URL("../../../../checks/v1-links.json", import.meta.url), "utf8")) as Recorded;
const V1_MODE: Record<string, string> = { raw: "lin", log: "log", rebase: "rebase", z: "z", yoy: "pc1", dd: "drawdown" };

describe("what an address says", () => {
  it("names series, mode, window, layers, a pinned date and a chosen event", () => {
    const state = parse("s=spx,unrate&mode=pc1&from=2019-06&to=2022-06&layers=rec,ev.policy,gov.pres&at=2020-04-01&event=event-2020-03-11-who-declares-a-pandemic");
    expect(state).toMatchObject({
      series: ["spx", "unrate"],
      mode: "pc1",
      from: "2019-06",
      to: "2022-06",
      layers: ["rec", "ev.policy", "gov.pres"],
      at: "2020-04-01",
      event: "event-2020-03-11-who-declares-a-pandemic",
      notes: [],
    });
  });

  it("says nothing where the address says nothing, which is not the same as saying 'none'", () => {
    expect(parse("")).toMatchObject({ series: null, mode: null, from: null, to: null, layers: null, at: null, event: null });
    expect(parse("s=&layers=none")).toMatchObject({ series: [], layers: [] });
  });

  it("reads a form's repeated fields as one list (a GET form sends a name once per ticked box)", () => {
    const state = parse("s=&s=spx&s=unrate&layers=&layers=rec&layers=ev.financial");
    expect(state.series).toEqual(["spx", "unrate"]);
    expect(state.layers).toEqual(["rec", "ev.financial"]);
  });

  it("a form with every box cleared says 'none', not 'nothing said'", () => {
    expect(parse("s=&layers=").series).toEqual([]);
    expect(parse("s=&layers=").layers).toEqual([]);
  });

  it("names a series once however often it is written", () => {
    expect(parse("s=spx,unrate,spx").series).toEqual(["spx", "unrate"]);
  });

  it("ignores what it cannot read, and says so", () => {
    const state = parse("s=spx,NOT A KEY&mode=sideways&from=2019-13&to=soon&at=2020-02-30&layers=rec,<script>&event=../x");
    expect(state).toMatchObject({ series: ["spx"], mode: null, from: null, to: null, at: null, layers: ["rec"], event: null });
    expect(state.notes.length).toBeGreaterThanOrEqual(5);
    for (const note of state.notes) expect(note).not.toMatch(/[<>]/);
  });

  it("a window that ends before it starts is no window", () => {
    const state = parse("s=spx&from=2022-06&to=2019-06");
    expect([state.from, state.to]).toEqual([null, null]);
    expect(state.notes.join(" ")).toMatch(/ends before it starts/);
  });

  it("a month is enough to pin a date", () => {
    expect(parse("at=2020-04").at).toBe("2020-04-01");
  });
});

describe("a view written back as an address", () => {
  it.each([
    "s=spx,unrate&mode=z&from=2019-06&to=2022-06&layers=rec,ev.policy,gov.pres&at=2020-04-01&event=event-a",
    "s=fx_price_index",
    "s=&layers=none",
    "s=spx,unrate,wti&mode=rebase&from=2007-10&to=2010-10&cmp=2020-01",
    "s=fedfunds,gs10&mode=lin&from=2010-01&hi=3&basis=lvl&lag=6&sx=fedfunds&sy=gs10&roll=24&ext=1",
    "s=fx_price_index&at=2024-05-01&table=1&pick=1",
    "",
  ])("%s reads back as the same view", (query) => {
    const state = parse(query);
    expect(explorerQuery(state)).toBe(query);
    expect(parse(explorerQuery(state))).toEqual(state);
  });

  it("is written in one order, with commas, whatever order it arrived in", () => {
    expect(explorerQuery(parse("to=2022-06&mode=z&s=spx&s=unrate&from=2019-06&layers=ev.policy&layers=rec"))).toBe("s=spx,unrate&mode=z&from=2019-06&to=2022-06&layers=ev.policy,rec");
  });

  it("reads a second range, the marks at the extremes and the relationship settings, and nothing it does not know", () => {
    const state = parse("s=spx&cmp=2020-01&roll=24&basis=lvl&lag=-3&sx=spx&sy=vix&ext=1&utm_source=x");
    expect(state).toMatchObject({ cmp: "2020-01", levels: true, lag: -3, sx: "spx", sy: "vix", roll: 24, ext: true, notes: [] });
    expect(explorerQuery(state)).toBe("s=spx&cmp=2020-01&basis=lvl&lag=-3&sx=spx&sy=vix&roll=24&ext=1");
  });

  it("with none of them said: no second range, no marks, changes, no lag, a 36-month rolling window", () => {
    expect(parse("s=spx")).toMatchObject({ cmp: null, ext: false, levels: false, lag: 0, sx: null, sy: null, roll: 36 });
    expect(parse("s=spx&basis=bogus&roll=12&ext=yes&lag=0")).toMatchObject({ levels: false, roll: 36, ext: false, lag: 0 });
  });

  it("notes a lag or a second range it cannot read", () => {
    expect(parse("s=spx&lag=25").notes.join(" ")).toMatch(/lag/);
    expect(parse("s=spx&lag=25").lag).toBe(0);
    expect(parse("s=spx&cmp=2020").notes.join(" ")).toMatch(/compare/);
  });
});

describe("v1's hash links (the shim)", () => {
  it("is not a v1 link without a selection", () => {
    expect(v1HashToQuery("")).toBeNull();
    expect(v1HashToQuery("#main")).toBeNull();
    expect(v1HashToQuery("#mode=z")).toBeNull();
  });

  it.each(recorded.links)("$hash opens v1's mode, range, layers and extras", ({ hash, v1 }) => {
    const query = v1HashToQuery(hash);
    expect(query).not.toBeNull();
    const state = parse(query!);
    expect(state.notes).toEqual([]);
    expect(state.mode).toBe(V1_MODE[v1.mode]);
    expect(state.from ?? recorded.v1_axis.first_month).toBe(v1.from);
    expect(state.to ?? recorded.v1_axis.last_month).toBe(v1.to);
    const layers = state.layers!;
    expect(layers.includes("rec")).toBe(v1.recessions);
    const categories = layers.filter((l) => l.startsWith("ev.")).map((l) => l.slice(3)).sort();
    expect(categories).toEqual(v1.events ? v1.event_categories : []);
    expect(layers.filter((l) => l.startsWith("gov."))).toEqual(v1.bands === "none" ? [] : [`gov.${v1.bands}`]);
    expect(state.hi !== null).toBe(v1.highlighted_event !== null);
    expect(state.cmp).toBe(v1.compare_from);
    expect(state.ext).toBe(v1.max_min);
    expect(state.levels ? "lvl" : "chg").toBe(v1.basis);
    expect(state.lag).toBe(v1.lag);
    expect(state.sx).toBe(v1.sx);
    expect(state.sy).toBe(v1.sy);
    expect(state.roll).toBe(v1.roll);
    // The selection is checked against a release (view.legacy.test.ts): v1 dropped series it did
    // not have before counting to eight, and only a release knows which those are.
    expect(state.series!.filter((k) => v1.sel.includes(k))).toEqual(v1.sel);
  });

  it("every band set v1 had, and v1's oldest spelling of presidential terms", () => {
    for (const set of ["pres", "house", "senate", "fed_chair", "treasury", "shutdowns"]) {
      expect(parse(v1HashToQuery(`#sel=spx&bands=${set}`)!).layers).toContain(`gov.${set}`);
    }
    expect(parse(v1HashToQuery("#sel=spx&bands=none")!).layers!.some((l) => l.startsWith("gov."))).toBe(false);
    expect(parse(v1HashToQuery("#sel=spx&bands=bogus&shPres=1")!).layers).toContain("gov.pres");
    expect(parse(v1HashToQuery("#sel=spx&shPres=0")!).layers!.some((l) => l.startsWith("gov."))).toBe(false);
  });

  it("v1's switches: only '1' is on, and a link that says nothing leaves v1's defaults on", () => {
    expect(parse(v1HashToQuery("#sel=spx")!).layers).toEqual(["rec", "ev.political", "ev.financial", "ev.geopolitical", "ev.health", "ev.policy"]);
    expect(parse(v1HashToQuery("#sel=spx&shRec=0&shEv=0")!).layers).toEqual([]);
    expect(parse(v1HashToQuery("#sel=spx&shRec=1&shEv=1&ev=health")!).layers).toEqual(["rec", "ev.health"]);
    expect(parse(v1HashToQuery("#sel=spx&shRec=yes")!).layers).not.toContain("rec");
  });

  it("v1 opened a link with no mode, or one it did not know, as z-scores", () => {
    expect(parse(v1HashToQuery("#sel=spx")!).mode).toBe("z");
    expect(parse(v1HashToQuery("#sel=spx&mode=percent")!).mode).toBe("z");
  });

  it("v1 threw away a range under six months: a difference of five is thrown away, six is kept", () => {
    expect(parse(v1HashToQuery("#sel=spx&from=2024-01&to=2024-06")!)).toMatchObject({ from: null, to: null });
    expect(parse(v1HashToQuery("#sel=spx&from=2024-01&to=2024-07")!)).toMatchObject({ from: "2024-01", to: "2024-07" });
    expect(parse(v1HashToQuery("#sel=spx&from=2024-07&to=2024-01")!)).toMatchObject({ from: null, to: null });
  });

  it("a month v1's axis did not have meant the end of the axis on that side", () => {
    expect(parse(v1HashToQuery("#sel=spx&from=1990-01&to=2010-01")!)).toMatchObject({ from: null, to: "2010-01" });
    expect(parse(v1HashToQuery("#sel=spx&from=2005-01&to=never")!)).toMatchObject({ from: "2005-01", to: null });
  });

  it("writes nothing a page could run", () => {
    const query = v1HashToQuery('#sel=spx,<img src=x onerror=alert(1)>&mode=z&bands="><script>&hi=1e9&sx=<b>')!;
    expect(query).not.toMatch(/[<>"' ]/);
  });
});

describe("M18: as of, a common frequency and a pinned Release", () => {
  it("reads as_of as a date or an instant, freq as a slower frequency and pin as a release id", () => {
    expect(parse("s=unrate&as_of=2025-12-13&freq=quarterly&pin=20260101T000000Z-0000000")).toMatchObject({ asOf: "2025-12-13", freq: "quarterly", pin: "20260101T000000Z-0000000", notes: [] });
    expect(parse("as_of=2025-12-13T14:30:00Z").asOf).toBe("2025-12-13T14:30:00Z");
    expect(parse("")).toMatchObject({ asOf: null, freq: null, pin: null });
  });

  it("leaves unsaid what it cannot read, and says so; a pin it cannot read is kept as unreadable, never dropped", () => {
    const state = parse("as_of=yesterday&freq=hourly&pin=latest");
    expect(state).toMatchObject({ asOf: null, freq: null, pin: null, pinUnread: true });
    expect(state.notes).toHaveLength(2); // the pin is the gate's to refuse, not a note
    expect(parse("as_of=1850-01-01").asOf).toBeNull();
    expect(parse("as_of=2025-02-30").asOf).toBeNull();
  });

  it("writes them back in one fixed place, after the window and before the layers", () => {
    const query = "s=unrate&mode=pch&from=2020-01&to=2021-01&freq=annual&as_of=2025-12-13&layers=rec&pin=20260101T000000Z-0000000";
    expect(explorerQuery(parse(query))).toBe(query);
  });

  it("offers the engine's other changes as modes", () => {
    for (const mode of ["chg", "ch1", "pch", "pca"]) expect(parse(`mode=${mode}`).mode).toBe(mode);
  });

  it("gives a v1 link none of them", () => {
    expect(v1HashToQuery("#sel=spx&mode=z")).not.toMatch(/as_of|freq|pin/);
  });
});
