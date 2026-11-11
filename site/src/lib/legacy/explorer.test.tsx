/**
 * The Explorer on v1's data (PLAN M4's acceptance criteria): v1's eleven presets and ten
 * recorded hash links open the same selection, mode and range; every v1 Event category and
 * band set can be switched on and off and matches v1's dates.
 *
 * v1's side of each comparison was recorded from v1's own page (checks/v1-links.json) or is read
 * from v1's own files by v1's own build module. The Release is made by the real converter in a
 * temporary directory. Failure messages name Series, months and Events, never a value (PLAN 6.1).
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { parseExplorerParams, v1HashToQuery, V1_BAND_SETS, V1_EVENT_CATEGORIES } from "../explorer/state";
import { explorerView, type ExplorerView } from "../explorer/view";
import { buildLegacyRelease, type V1Data } from "./testing";

type V1State = { sel: string[]; mode: string; from: string; to: string; to_is_last_month: boolean; compare_from?: string | null; highlighted_event?: null | { month: string; day: number | null; title: string } };
type Recorded = { v1_axis: { first_month: string; last_month: string }; presets: { name: string; v1: V1State }[]; links: { hash: string; v1: V1State }[] };
const recorded = JSON.parse(readFileSync(new URL("../../../../checks/v1-links.json", import.meta.url), "utf8")) as Recorded;
const V1_MODE: Record<string, string> = { raw: "lin", log: "log", rebase: "rebase", z: "z", yoy: "pc1", dd: "drawdown" };

let release: OpenedRelease;
let v1: V1Data;
beforeAll(async () => {
  const fixture = buildLegacyRelease();
  v1 = fixture.v1;
  const opened = await createReleaseReader({ root: fixture.root, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
}, 120_000);

const view = (query: string): ExplorerView => explorerView(release, "local", parseExplorerParams(new URLSearchParams(query)));

/** The same selection, mode and range as v1 arrived at. An open end is the end of v1's axis. */
function expectSameView(v: ExplorerView, want: V1State): void {
  expect(v.selection.map((s) => s.key)).toEqual(want.sel);
  expect(v.mode).toBe(V1_MODE[want.mode]);
  // v1's axis began in 2000-01 whatever the Series held; here an open start is the first Period
  // the selected Series hold, which is never before it.
  if (v.window.from !== null || want.from !== recorded.v1_axis.first_month) expect(v.window.from).toBe(want.from);
  else expect(v.window.start! >= `${recorded.v1_axis.first_month}-01`).toBe(true);
  if (want.to_is_last_month) expect(v.window.to).toBeNull(); // runs to the latest value, as v1's did
  else expect(v.window.to).toBe(want.to);
}

describe("v1's eleven presets", () => {
  it("are all offered, by v1's names, in v1's order", () => {
    expect(recorded.presets).toHaveLength(11);
    expect(view("").presets.map((p) => p.name)).toEqual(recorded.presets.map((p) => p.name));
  });

  it.each(recorded.presets)("$name opens the selection, mode and range v1 opened", ({ name, v1: want }) => {
    const preset = view("").presets.find((p) => p.name === name)!;
    const v = view(preset.query);
    expectSameView(v, want);
    expect(v.notes.filter((n) => /left out|not one of|could not/.test(n))).toEqual([]);
    expect(parseExplorerParams(new URLSearchParams(preset.query)).cmp).toBe(want.compare_from ?? null);
    expect(v.figure, "something is drawn").not.toBeNull();
  });

  it("a preset keeps the layers the reader has, as v1's did", () => {
    const preset = view("s=spx&layers=rec,gov.pres").presets[0]!;
    expect(preset.query).toContain("layers=rec,gov.pres");
  });
});

describe("ten recorded v1 hash links", () => {
  it("are ten", () => expect(recorded.links).toHaveLength(10));

  it.each(recorded.links)("$hash opens the selection, mode and range v1 opened", ({ hash, v1: want }) => {
    const v = view(v1HashToQuery(hash)!);
    expectSameView(v, want);
    if (want.highlighted_event) {
      const chosen = release.annotations.annotations.find((a) => a.id === v.resolved.event);
      expect(chosen?.label).toBe(want.highlighted_event.title);
    } else expect(v.resolved.event).toBeNull();
  });

  it("with no address at all, opens v1's opening view", () => {
    const v = view("");
    expect(v.selection.map((s) => s.key)).toEqual(["spx", "unrate", "wti", "cpi_yoy"]);
    expect(v.mode).toBe("z");
    expect(v.window).toMatchObject({ from: null, to: null });
  });
});

describe("a copied link reproduces the view", () => {
  it.each(recorded.links.map((l) => l.hash))("%s: the link to copy opens the same drawing, and copies as itself", (hash) => {
    const first = view(v1HashToQuery(hash)!);
    const again = view(first.resolvedQuery);
    expect(again.resolvedQuery).toBe(first.resolvedQuery);
    expect(again.selection.map((s) => [s.key, s.state])).toEqual(first.selection.map((s) => [s.key, s.state]));
    expect(again.mode).toBe(first.mode);
    const drawing = (v: ExplorerView) => JSON.stringify(v.figure?.plots.map((p) => p.layouts));
    expect(drawing(again) === drawing(first), "the drawings are the same").toBe(true);
  });
});

describe("layers match v1's dates and switch on and off", () => {
  const monthBefore = (month: string): string => {
    const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 2;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  const whole = "s=spx&from=2000-01";

  it("offers v1's five event categories and six band sets, by v1's names", () => {
    const v = view(whole);
    expect(v.layers.toggles.map((t) => t.token)).toEqual(["rec", ...V1_EVENT_CATEGORIES.map((c) => `ev.${c}`)]);
    expect(v.layers.toggles.map((t) => t.label)).toEqual(["Recessions", "Political", "Financial", "Geopolitical", "Health & disaster", "Economic policy"]);
    expect(v.layers.bands.map((b) => b.token)).toEqual(["", ...V1_BAND_SETS.map((s) => `gov.${s}`)]);
    expect(v.layers.bands.map((b) => b.label)).toEqual(["None", "Presidential terms", "House control", "Senate control", "Fed chair", "Treasury secretary", "Government shutdowns"]);
  });

  it.each(V1_EVENT_CATEGORIES)("events, %s: on, exactly v1's events at v1's dates; off, none", (category) => {
    const want = v1.events
      .filter((e) => e.cat === category && e.month >= v1.first_month && e.month <= v1.last_month)
      .map((e) => [e.day ? `${e.month}-${String(e.day).padStart(2, "0")}` : `${e.month}-01`, e.title]);
    expect(want.length).toBeGreaterThan(0);
    const onView = view(`${whole}&layers=ev.${category}`);
    expect(onView.events.map((e) => [e.date, e.label]).sort()).toEqual(want.sort());
    expect(onView.events.every((e) => e.url === null || e.url.startsWith("https://"))).toBe(true);
    const [drawn] = onView.figure!.plots[0]!.layouts.wide.children.filter((c) => typeof c !== "string" && c.attrs["data-layer"] === "events");
    expect(typeof drawn !== "string" && drawn!.attrs["data-count"]).toBe(want.length);

    const others = V1_EVENT_CATEGORIES.filter((c) => c !== category).map((c) => `ev.${c}`).join(",");
    const offView = view(`${whole}&layers=${others}`);
    expect(offView.events.filter((e) => want.some(([, title]) => title === e.label))).toEqual([]);
    expect(offView.layers.toggles.find((t) => t.token === `ev.${category}`)!.on).toBe(false);
  });

  it("all five categories together are v1's 83 events", () => {
    expect(view(whole).events).toHaveLength(v1.events.filter((e) => e.month >= v1.first_month && e.month <= v1.last_month).length);
    expect(v1.events).toHaveLength(83);
  });

  it.each(V1_BAND_SETS)("bands, %s: on, v1's spans and names; off, none", (set) => {
    const rows = set === "pres" ? v1.pres : v1.bands[set]!.rows;
    // v1 wrote a band as [from, to), months; here it runs to the last day of the month before `to`.
    const want = rows.filter(([from, to]) => from <= v1.last_month && monthBefore(to) >= v1.first_month).map(([from, to, name]) => ({ from, last: monthBefore(to), name }));
    expect(want.length).toBeGreaterThan(0);
    const onView = view(`${whole}&layers=gov.${set}`);
    const spans = release.annotations.annotations.filter((a) => a.kind === "governance" && a.category === set).map((a) => a.anchor as { start: string; end: string });
    expect(spans.map((s) => [s.start.slice(0, 7), s.end.slice(0, 7)])).toEqual(rows.map(([from, to]) => [from, monthBefore(to)]));
    expect(onView.bands).toHaveLength(want.length);
    onView.bands.forEach((band, i) => expect(band.label.startsWith(want[i]!.name), `${set} ${i}`).toBe(true));
    const drawn = onView.figure!.plots[0]!.layouts.wide.children.filter((c) => typeof c !== "string" && c.attrs["data-layer"] === "band");
    expect(drawn).toHaveLength(want.length);
    expect(onView.layers.bands.filter((b) => b.on).map((b) => b.token)).toEqual([`gov.${set}`]);

    const offView = view(`${whole}&layers=rec`);
    expect(offView.bands).toEqual([]);
    expect(offView.figure!.plots[0]!.layouts.wide.children.filter((c) => typeof c !== "string" && c.attrs["data-layer"] === "band")).toEqual([]);
  });

  it("a party is named in words on its band, never left to a colour", () => {
    const v = view(`${whole}&layers=gov.pres`);
    expect(v.bands.every((b) => /\((Democratic|Republican)\)$/.test(b.label))).toBe(true);
    const drawing = JSON.stringify(v.figure!.plots[0]!.layouts.wide.children.filter((c) => typeof c !== "string" && c.attrs["data-layer"] === "band"));
    expect(drawing).not.toMatch(/#[0-9a-f]{3,6}|blue|red/i);
  });

  it("recessions: on, the months v1 shaded; off, none", () => {
    const usrec = v1.series.usrec!;
    const shaded = usrec.d.filter((_, i) => usrec.v[i] === 1);
    const v = view(`${whole}&layers=rec`);
    const covered = (month: string) => v.figure !== null && release.annotations.annotations.some((a) => a.kind === "recession" && a.anchor.type === "span" && a.anchor.start.slice(0, 7) <= month && a.anchor.end!.slice(0, 7) >= month);
    expect(usrec.d.filter(covered)).toEqual(shaded);
    expect(v.recessions.length).toBeGreaterThan(0);
    expect(view(`${whole}&layers=none`).recessions).toEqual([]);
  });
});

describe("what the page costs with eight series", () => {
  it("stays a page: the view of v1's eight busiest series over the whole axis is under 1.5 MB as data", () => {
    const eight = Object.keys(v1.series).sort((a, b) => v1.series[b]!.d.length - v1.series[a]!.d.length).slice(0, 8);
    const v = view(`s=${eight.join(",")}&mode=lin`);
    expect(v.selection.filter((s) => s.state === "drawn")).toHaveLength(8);
    expect(JSON.stringify({ figure: v.figure, readout: v.readout }).length).toBeLessThan(1_500_000);
  });
});
