/**
 * The drawing, the Data-state marks, the table and the words under an Explained figure
 * (PLAN section 3 and 8; M3's acceptance criteria). Assertions are on structure: what is drawn,
 * as what, and where; never on a picture.
 */
import { describe, expect, it } from "vitest";
import { DATA_STATES, LAYOUTS, MARK_NAMES, STATE_INFO, mark, renderFigure, svgString, type LayoutName, type SvgNode } from "./index";
import { textOf, walk } from "./svg";
import { CREATED, observations, onDays, series } from "./testing";

const figure = (...list: Parameters<typeof series>[0][]) => renderFigure({ created: CREATED }, list.map(series));
const find = (root: SvgNode, test: (n: SvgNode) => boolean): SvgNode[] => [...walk(root)].filter(test);
const drawn = (root: SvgNode, key: string) => find(root, (n) => n.attrs["data-series"] === key);
const marks = (root: SvgNode, name: string) => find(root, (n) => n.attrs["data-mark"] === name);
const EACH_LAYOUT = Object.keys(LAYOUTS) as LayoutName[];

/** The x of every point a path visits ("M x y", "L x y", "H x"), in order. */
const xs = (d: string): number[] => [...d.matchAll(/[MLH]\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
const subpaths = (d: string): number => (d.match(/M/g) ?? []).length;

describe("a Series is drawn at its real cadence, never as an invented monthly line", () => {
  it("monthly: one line, broken where a value is missing", () => {
    const f = figure({ observations: observations("monthly", "2025-01", [1, 2, 3, null, 5, 6, 7, 8, 9, 10, 11, 12]) });
    expect(f.plots[0]!.series[0]!.drawnAs).toBe("line");
    for (const layout of EACH_LAYOUT) {
      const [line] = drawn(f.plots[0]!.layouts[layout], "fx_rate").filter((n) => n.attrs["data-drawn"] === "line");
      expect(line, layout).toBeDefined();
      expect(subpaths(String(line!.attrs.d))).toBe(2); // Jan to Mar, May to Dec: nothing bridges April
      expect(xs(String(line!.attrs.d))).toHaveLength(11);
    }
  });

  it("quarterly: one point per quarter and no line between them", () => {
    const f = figure({ freq: "quarterly", observations: observations("quarterly", "2022-Q1", [5, 6, null, 8, 9, 10, 11, 12]) });
    expect(f.plots[0]!.series[0]!.drawnAs).toBe("points");
    for (const layout of EACH_LAYOUT) {
      const nodes = drawn(f.plots[0]!.layouts[layout], "fx_rate");
      expect(nodes.filter((n) => n.attrs["data-drawn"] === "line" || n.attrs["data-drawn"] === "step")).toEqual([]);
      const [points] = nodes.filter((n) => n.attrs["data-drawn"] === "points");
      expect(points!.attrs["data-count"]).toBe(7); // seven values; the missing quarter has no point
    }
  });

  it("annual: points; a held Series: steps", () => {
    expect(figure({ freq: "annual", observations: observations("annual", "2012", [15, 14.8, 13.5]) }).plots[0]!.series[0]!.drawnAs).toBe("points");
    expect(figure({ freq: "irregular", observations: onDays({ "2012-11-06": 3.9, "2016-11-08": 2.1 }) }).plots[0]!.series[0]!.drawnAs).toBe("points");
  });

  it("held: each value stands until the next, and the last until the release was made", () => {
    const f = figure({ freq: "irregular", continuity: "held", observations: onDays({ "2012-11-06": 3.9, "2016-11-08": 2.1, "2020-11-03": 4.5, "2024-11-05": -1.5 }) });
    expect(f.plots[0]!.series[0]!.drawnAs).toBe("step");
    const root = f.plots[0]!.layouts.wide;
    const [step] = drawn(root, "fx_rate").filter((n) => n.attrs["data-drawn"] === "step");
    const d = String(step!.attrs.d);
    expect(d).not.toMatch(/[CQSA]/); // only straight, axis-parallel moves
    const visited = xs(d);
    const plot = find(root, (n) => n.attrs["data-plot-area"] !== undefined)[0]!;
    // The last x is the release date, at the right edge of the plot, beyond the last Observation.
    expect(visited.at(-1)).toBeCloseTo(Number(plot.attrs.x) + Number(plot.attrs.width), 1);
    expect(drawn(root, "fx_rate").find((n) => n.attrs["data-drawn"] === "points")!.attrs["data-count"]).toBe(4);
  });

  it("held: a missing Observation ends the hold", () => {
    const f = figure({ freq: "annual", continuity: "held", observations: observations("annual", "2020", [1, 2, null, 4]) });
    const [step] = drawn(f.plots[0]!.layouts.wide, "fx_rate").filter((n) => n.attrs["data-drawn"] === "step");
    expect(subpaths(String(step!.attrs.d))).toBe(2);
  });

  it("no value is drawn that the Series does not hold: as many points as values", () => {
    const values = [510.2, 514.8, 517.3, 521.9, 524.4, 529.0, null, 536.7];
    const f = figure({ freq: "quarterly", observations: observations("quarterly", "2022-Q1", values) });
    const [points] = drawn(f.plots[0]!.layouts.narrow, "fx_rate").filter((n) => n.attrs["data-drawn"] === "points");
    expect(subpaths(String(points!.attrs.d))).toBe(7);
  });
});

describe("every Data state has a mark and a word", () => {
  it("nine states, ten marks (suppressed is a Status with its own), all different shapes and words", () => {
    expect(DATA_STATES).toEqual(["preliminary", "revised", "estimate", "projected", "partial", "stale", "missing", "break", "withheld"]);
    expect(new Set(MARK_NAMES.map((name) => STATE_INFO[name].word)).size).toBe(10);
    expect(new Set(MARK_NAMES.map((name) => STATE_INFO[name].shape)).size).toBe(10);
    const shapes = MARK_NAMES.map((name) => svgString(mark(name, 0, 0)).replace(/ data-mark="[a-z]+"/, ""));
    expect(new Set(shapes).size).toBe(10);
  });

  it("a mark carries no colour of its own: it is drawn in the ink it sits in", () => {
    for (const name of MARK_NAMES) {
      const text = svgString(mark(name, 8, 8));
      expect(text).not.toMatch(/#[0-9a-f]{3,6}|var\(--color-(series|nominal|delayed|outage)/);
      expect(text).toContain("currentColor");
    }
  });

  const statuses = { "2025-08": "revised", "2025-09": "estimate", "2025-10": "projected", "2025-11": "partial", "2025-12": "preliminary" };
  const everything = () =>
    renderFigure({ created: CREATED }, [
      series({
        maxLag: "P1M",
        breaks: [{ period: "2025-03", note: "New population controls." }],
        observations: [
          ...observations("monthly", "2025-01", [1, 2, 3, null, null, 6, 7, 8, 9, 10, 11, 12], { ...statuses, "2025-05": "suppressed" }).slice(0, 11),
        ],
      }),
      { key: "fx_exchange_index", name: "Fixture exchange index", heldBack: "withheld", reason: "The licence does not allow redistribution." },
    ]);

  it.each(["preliminary", "revised", "estimate", "projected", "partial", "stale", "missing", "break", "suppressed"] as const)(
    "%s: drawn in the chart with its mark, and named under it with its word",
    (state) => {
      const f = everything();
      for (const layout of EACH_LAYOUT) expect(marks(f.plots[0]!.layouts[layout], state).length, `${state} in ${layout}`).toBeGreaterThan(0);
      const note = f.states.find((n) => n.mark === state);
      expect(note, state).toBeDefined();
      expect(note!.word).toBe(STATE_INFO[state].word);
    },
  );

  it("withheld: named with its mark, word and reason, and no values anywhere", () => {
    const f = everything();
    const note = f.states.find((n) => n.mark === "withheld")!;
    expect(note).toEqual({ mark: "withheld", word: "Withheld", series: "Fixture exchange index", text: "The licence does not allow redistribution." });
    expect(f.tables.map((t) => t.key)).toEqual(["fx_rate"]);
    expect(JSON.stringify(f.plots)).not.toContain("fx_exchange_index");
  });

  it("a Series not allowed on this Surface is named the same way, in its own words", () => {
    const f = renderFigure({ created: CREATED }, [{ key: "k", name: "K", heldBack: "not_permitted", reason: "only the local surface may show values" }]);
    expect(f.states).toEqual([{ mark: "withheld", word: "Not shown here", series: "K", text: "only the local surface may show values" }]);
    expect(f.plots).toEqual([]);
    expect(f.takeaway).toBeNull();
  });

  it("the state line says which Periods, in words", () => {
    const f = everything();
    const text = (state: string) => f.states.find((n) => n.mark === state)!.text;
    expect(text("revised")).toBe("Aug 2025");
    expect(text("missing")).toBe("Apr 2025");
    expect(text("suppressed")).toBe("May 2025");
    expect(text("break")).toBe("at Mar 2025. New population controls.");
    expect(text("stale")).toBe("the latest value is for Nov 2025; the limit for this series ran out on 31 December 2025.");
  });

  it("a long run of one state is marked at its two ends and described as a span", () => {
    const all = Object.fromEntries(observations("quarterly", "2020-Q1", Array(20).fill(1)).map((o) => [o.period, "estimate"]));
    const f = figure({ freq: "quarterly", observations: observations("quarterly", "2020-Q1", Array.from({ length: 20 }, (_, i) => 40 + i), all) });
    expect(marks(f.plots[0]!.layouts.wide, "estimate")).toHaveLength(2);
    expect(f.states.find((n) => n.mark === "estimate")!.text).toBe("2020 Q1 to 2024 Q4 (20 periods)");
  });

  it("the table names the state of every row that has one", () => {
    const f = everything();
    const rows = Object.fromEntries(f.tables[0]!.rows.map((r) => [r.period, r]));
    expect(rows["2025-12"]).toBeUndefined(); // the Series ends in November
    expect(rows["2025-11"]!.states).toEqual([{ mark: "partial", word: "Partial period" }]);
    expect(rows["2025-04"]).toMatchObject({ value: null, exact: null, states: [{ mark: "missing", word: "Missing" }] });
    expect(rows["2025-05"]!.states).toEqual([{ mark: "suppressed", word: "Suppressed" }]);
    expect(rows["2025-03"]!.states).toEqual([{ mark: "break", word: "Break", note: "New population controls." }]);
    expect(rows["2025-01"]!.states).toEqual([]);
  });
});

describe("the table holds the same values as the drawing", () => {
  it("every Observation is a row, in Period order, gaps included", () => {
    const values = [100, 100.4, null, 101.1];
    const f = figure({ unit: "index", unitKind: "index", observations: observations("monthly", "2024-01", values) });
    expect(f.tables[0]!.rows.map((r) => [r.period, r.label, r.value, r.exact])).toEqual([
      ["2024-01", "Jan 2024", "100.0", "100"],
      ["2024-02", "Feb 2024", "100.4", "100.4"],
      ["2024-03", "Mar 2024", null, null],
      ["2024-04", "Apr 2024", "101.1", "101.1"],
    ]);
    expect(f.tables[0]).toMatchObject({ decimals: 1, rounded: false });
  });

  it("a value is never rounded away: the exact value is kept beside a readable one", () => {
    const f = figure({ unit: "ratio", unitKind: "ratio", observations: observations("annual", "2020", [5.000000000000004, 0.00001, 0.00000002, 12345678.5]), freq: "annual" });
    const t = f.tables[0]!;
    expect(t).toMatchObject({ decimals: 6, rounded: true });
    expect(t.rows.map((r) => [r.value, r.exact])).toEqual([
      ["5.000000", "5.000000000000004"],
      ["0.000010", "0.00001"],
      ["2e-8", "2e-8"],
      ["12,345,678.500000", "12345678.5"],
    ]);
  });
});

describe("layout at each width: nothing is clipped", () => {
  /** A generous width for 12px system text, tabular figures included. */
  const width = (text: string) => text.length * 7;
  function extents(root: SvgNode): { text: string; left: number; right: number; y: number; size: number }[] {
    return find(root, (n) => n.tag === "text").map((n) => {
      const text = textOf(n);
      const x = Number(n.attrs.x);
      const anchor = n.attrs["text-anchor"] ?? "start";
      const left = anchor === "end" ? x - width(text) : anchor === "middle" ? x - width(text) / 2 : x;
      return { text, left, right: left + width(text), y: Number(n.attrs.y), size: Number(n.attrs["font-size"]) };
    });
  }
  const cases: [string, ReturnType<typeof figure>][] = [
    ["two years of months", figure({ observations: observations("monthly", "2024-01", Array.from({ length: 24 }, (_, i) => 100 + i * 0.4)) })],
    ["seventy-five years of quarters", figure({ freq: "quarterly", observations: observations("quarterly", "1950-Q1", Array.from({ length: 300 }, (_, i) => 200 + i * 97.3)) })],
    ["four elections", figure({ freq: "irregular", continuity: "held", observations: onDays({ "2012-11-06": 3.9, "2016-11-08": 2.1, "2020-11-03": 4.5, "2024-11-05": -1.5 }) })],
    ["one value", figure({ observations: observations("monthly", "2025-12", [4.3]) })],
    ["very large values", figure({ unit: "dollars", unitKind: "currency", observations: observations("annual", "2000", Array.from({ length: 25 }, (_, i) => 1.2e12 + i * 3.4e11)), freq: "annual" })],
    ["very small values", figure({ observations: observations("monthly", "2025-01", [0.00012, 0.00015, 0.00011, 0.00019]) })],
    ["negative and positive", figure({ observations: observations("monthly", "2020-01", Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 12345.6)) })],
    ["all the same value", figure({ observations: observations("monthly", "2025-01", [2, 2, 2, 2]) })],
  ];

  it.each(cases)("%s", (_name, f) => {
    for (const layout of EACH_LAYOUT) {
      const root = f.plots[0]!.layouts[layout];
      const { width: w, height: hgt } = LAYOUTS[layout];
      expect(root.attrs.viewBox).toBe(`0 0 ${w} ${hgt}`);
      const labels = extents(root);
      expect(labels.length, `${layout}: tick labels`).toBeGreaterThanOrEqual(4);
      for (const label of labels) {
        expect(label.size, `${layout}: ${label.text}`).toBeGreaterThanOrEqual(12);
        expect(label.left, `${layout}: ${label.text} left`).toBeGreaterThanOrEqual(0);
        expect(label.right, `${layout}: ${label.text} right`).toBeLessThanOrEqual(w);
        expect(label.y, `${layout}: ${label.text} y`).toBeLessThanOrEqual(hgt - 2);
        expect(label.y - label.size, `${layout}: ${label.text} top`).toBeGreaterThanOrEqual(-1);
      }
      // Labels on one line (the time axis) do not run into each other.
      const axis = labels.filter((l) => l.y === Math.max(...labels.map((x) => x.y))).sort((a, b) => a.left - b.left);
      expect(axis.length, `${layout}: time axis labels`).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < axis.length; i++) expect(axis[i]!.left - axis[i - 1]!.right, `${layout}: ${axis[i - 1]!.text} | ${axis[i]!.text}`).toBeGreaterThanOrEqual(4);
      // Everything drawn for a Series lies inside the plot area.
      const plot = find(root, (n) => n.attrs["data-plot-area"] !== undefined)[0]!;
      for (const node of find(root, (n) => n.attrs["data-series"] !== undefined && typeof n.attrs.d === "string")) {
        for (const x of xs(String(node.attrs.d))) {
          expect(x).toBeGreaterThanOrEqual(Number(plot.attrs.x) - 0.01);
          expect(x).toBeLessThanOrEqual(Number(plot.attrs.x) + Number(plot.attrs.width) + 0.01);
        }
      }
    }
  });

  it("the drawing has a name for assistive technology and no script or style of its own", () => {
    const f = figure({ observations: observations("monthly", "2024-01", [1, 2, 3]) });
    const root = f.plots[0]!.layouts.narrow;
    expect(root.attrs.role).toBe("img");
    expect(String(root.attrs["aria-label"])).toBe("Chart of Fixture rate, Jan 2024 to Mar 2024. Every value is in the table below.");
    const text = svgString(root);
    expect(text).not.toMatch(/<script|<style|<animate|\son[a-z]+=|href=/);
  });
});

describe("more than one Series", () => {
  const a = { key: "a", name: "Rate A", observations: observations("monthly", "2025-01", [4.2, 4.3, 4.1, 4.0]) };
  const b = { key: "b", name: "Rate B", observations: observations("monthly", "2025-01", [3.0, 3.1, 3.3, 3.2]) };

  it("Series in one unit share a plot; each has its own colour, line style and symbol", () => {
    const f = figure(a, b);
    expect(f.plots).toHaveLength(1);
    const [first, second] = f.plots[0]!.series;
    expect([first!.color, second!.color]).toEqual([1, 2]);
    expect(first!.dash).not.toBe(second!.dash);
    expect(first!.symbol).not.toBe(second!.symbol);
    const root = f.plots[0]!.layouts.wide;
    expect(String(drawn(root, "a")[0]!.attrs.stroke)).toBe("var(--color-series-1)");
    expect(String(drawn(root, "b")[0]!.attrs.stroke)).toBe("var(--color-series-2)");
  });

  it("Series in different units never share an axis", () => {
    const f = figure(a, { ...b, unit: "index", unitKind: "index" });
    expect(f.plots.map((p) => [p.unit, p.series.map((s) => s.key)])).toEqual([["%", ["a"]], ["index", ["b"]]]);
    expect(f.plots[1]!.series[0]!.color).toBe(2); // a Series keeps its colour across plots
  });

  it("where there is room, the wide layout names each Series at the end of its line", () => {
    const f = figure(a, b);
    expect(f.plots[0]!.endLabels).toBe(true);
    const labels = find(f.plots[0]!.layouts.wide, (n) => n.attrs["data-end-label"] !== undefined).map(textOf);
    expect(labels.sort()).toEqual(["Rate A", "Rate B"]);
    expect(find(f.plots[0]!.layouts.narrow, (n) => n.attrs["data-end-label"] !== undefined)).toEqual([]);
  });
});

describe("the words under the drawing", () => {
  it("the unit line gives the unit, the adjustments that are recorded, and the cadence", () => {
    const f = figure({ unit: "index, 2024-01 = 100", unitKind: "index", priceBasis: "real", observations: observations("monthly", "2024-01", [100, 101]) });
    expect(f.plots[0]!.unitLine).toBe("index, 2024-01 = 100 · seasonally adjusted · in real terms · monthly");
    const legacy = figure({ representation: "legacy_monthly_rounded", seasonalAdjustment: undefined, priceBasis: undefined, observations: observations("monthly", "2024-01", [100, 101]) });
    expect(legacy.plots[0]!.unitLine).toBe("% · monthly · v1's rounded output");
  });

  it("the source line names the source, how far the data runs and when it was obtained", () => {
    const f = renderFigure({ created: CREATED, retrieved: "retrieved 11 Nov 2026" }, [series({ observations: observations("monthly", "2025-11", [4.2, null]) })]);
    expect(f.sourceLine).toBe("Source: Macro Atlas fixture (synthetic) · data to Nov 2025 · retrieved 11 Nov 2026");
  });

  it("how to read this: what the drawing is, where the axis starts, and each state present", () => {
    const f = figure({ freq: "quarterly", observations: observations("quarterly", "2025-Q1", [510.2, null, 517.3, 521.9], { "2025-Q4": "estimate" }) });
    const lines = f.howToRead.map((l) => l.text);
    expect(lines[0]).toBe("Each point is one quarter, placed at the start of the quarter it describes. Points are not joined: the series holds nothing between them.");
    expect(lines).toContain("The vertical axis runs from 510 to 522. It does not start at zero.");
    expect(f.howToRead.filter((l) => l.mark).map((l) => [l.mark, l.text])).toEqual([
      ["estimate", "Estimate. The value was estimated, not measured or counted."],
      ["missing", "Missing. There is no value for this period. Nothing is filled in or carried forward."],
    ]);
    expect(lines.at(-1)).toBe("The table holds every value drawn here.");
  });
});
