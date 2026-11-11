/**
 * What the Explorer asks of the figure beyond an Explained figure (PLAN M4): one time axis shared
 * by every plot, Annotation layers, a pinned date, and a logarithmic axis. Structure only.
 */
import { describe, expect, it } from "vitest";
import { LAYOUTS, renderFigure, type FigureSpec, type LayoutName, type SvgNode } from "./index";
import { textOf, walk } from "./svg";
import { CREATED, observations, onDays, series } from "./testing";

const find = (root: SvgNode, test: (n: SvgNode) => boolean): SvgNode[] => [...walk(root)].filter(test);
const layer = (root: SvgNode, name: string) => find(root, (n) => n.attrs["data-layer"] === name);
const EACH_LAYOUT = Object.keys(LAYOUTS) as LayoutName[];
const num = (n: SvgNode, attr: string) => Number(n.attrs[attr]);
const area = (root: SvgNode) => find(root, (n) => n.attrs["data-plot-area"] !== undefined)[0]!;

const rate = series({ key: "fx_rate", name: "Fixture rate", unit: "%", observations: observations("monthly", "2024-01", [4, 4.1, 4.2, 4.1, 4, 3.9, 3.8, 3.9, 4, 4.1, 4.2, 4.3]) });
const output = series({ key: "fx_output", name: "Fixture output", unit: "billions of fixture dollars", freq: "quarterly", observations: observations("quarterly", "2024-Q1", [1_250_000, 1_260_000, 1_275_000, 1_290_000]) });
const spec = (over: Partial<FigureSpec> = {}): FigureSpec => ({ created: CREATED, domain: { from: "2024-01-01", to: "2024-12-31" }, takeaway: false, endLabels: false, ...over });

/** Where a date falls in a drawing, from what the drawing itself says about its time axis. */
function xOf(root: SvgNode, date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  const [t0, t1, x0, x1] = ["data-t0", "data-t1", "data-x0", "data-x1"].map((a) => num(root, a)) as [number, number, number, number];
  return x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
}

describe("small multiples: one plot per unit on one time axis", () => {
  const f = renderFigure(spec(), [rate, output]);

  it("draws a plot per unit, never two units on one axis", () => {
    expect(f.plots.map((p) => p.unit)).toEqual(["%", "billions of fixture dollars"]);
    expect(f.plots.map((p) => p.series.map((s) => s.key))).toEqual([["fx_rate"], ["fx_output"]]);
  });

  it("every plot covers the window asked for, so one date is at one place in all of them", () => {
    for (const layout of EACH_LAYOUT) {
      const [a, b] = f.plots.map((p) => p.layouts[layout]) as [SvgNode, SvgNode];
      for (const attr of ["data-t0", "data-t1", "data-x0", "data-x1"]) expect(a.attrs[attr], `${layout} ${attr}`).toBe(b.attrs[attr]);
      expect(new Date(num(a, "data-t0")).toISOString().slice(0, 10)).toBe("2024-01-01");
      expect(new Date(num(a, "data-t1")).toISOString().slice(0, 10)).toBe("2024-12-31");
      expect(area(a).attrs.x).toBe(area(b).attrs.x); // the wider tick labels set the margin for both
      expect(area(a).attrs.width).toBe(area(b).attrs.width);
    }
  });

  it("names no Series at the end of a line when the page lists them itself", () => {
    const two = renderFigure(spec(), [rate, series({ ...rate, observations: [...rate.observations], key: "fx_other", name: "Other rate" })]);
    expect(two.plots[0]!.endLabels).toBe(false);
    expect(find(two.plots[0]!.layouts.wide, (n) => n.attrs["data-end-label"] !== undefined)).toEqual([]);
  });

  it("writes no takeaway and gives no reason for its absence when asked for none", () => {
    expect(f.takeaway).toBeNull();
    expect(f.silence).toBeNull();
  });

  it("a held value standing when the window opens is drawn from the window's edge, not from outside the plot", () => {
    const held = series({ freq: "irregular", continuity: "held", observations: onDays({ "2020-11-03": 4.5, "2024-11-05": -1.5 }) });
    const root = renderFigure(spec(), [held]).plots[0]!.layouts.wide;
    const [step] = find(root, (n) => n.attrs["data-drawn"] === "step");
    const first = Number(/M\s*(-?[\d.]+)/.exec(String(step!.attrs.d))![1]);
    expect(first).toBeGreaterThanOrEqual(num(area(root), "x"));
  });
});

describe("annotation layers are drawn from dates, behind and over the Series", () => {
  const layers = {
    bands: [
      { start: "2023-01-20", end: "2024-06-30", label: "First holder", tint: "a" as const },
      { start: "2024-07-01", end: null, label: "Second holder", tint: "b" as const },
      { start: "2019-01-01", end: "2020-12-31", label: "Before the window", tint: "a" as const },
    ],
    recessions: [{ start: "2024-03-01", end: "2024-05-31" }],
    events: [
      { id: "event-a", date: "2024-09-18" },
      { id: "event-outside", date: "2025-02-01" },
    ],
    highlight: { id: "event-a", date: "2024-09-18", label: "Fixture central bank changes its rate" },
  };
  const f = renderFigure(spec({ layers }), [rate, output]);

  it.each(EACH_LAYOUT)("%s: a band is clipped to the window and one outside it is not drawn", (layout) => {
    for (const plot of f.plots) {
      const root = plot.layouts[layout];
      const bands = layer(root, "band");
      expect(bands).toHaveLength(2);
      const [first, second] = bands.map((g) => find(g, (n) => n.tag === "rect")[0]!) as [SvgNode, SvgNode];
      expect(num(first, "x")).toBeCloseTo(num(root, "data-x0"), 1); // began before the window
      expect(num(first, "x") + num(first, "width")).toBeCloseTo(xOf(root, "2024-07-01"), 1); // its last day is inclusive
      expect(num(second, "x")).toBeCloseTo(xOf(root, "2024-07-01"), 1);
      expect(num(second, "x") + num(second, "width")).toBeCloseTo(num(root, "data-x1"), 1); // still running
      expect(bands.map((g) => g.attrs["data-tint"])).toEqual(["a", "b"]);
    }
  });

  it("a band is named on the plot where its name fits", () => {
    const names = layer(f.plots[0]!.layouts.wide, "band").map((g) => textOf(g));
    expect(names).toEqual(["First holder", "Second holder"]);
  });

  it("a recession is a band from its first day to its last", () => {
    const root = f.plots[0]!.layouts.wide;
    const [rect] = layer(root, "recession").map((g) => find(g, (n) => n.tag === "rect")[0]!);
    expect(num(rect!, "x")).toBeCloseTo(xOf(root, "2024-03-01"), 1);
    expect(num(rect!, "x") + num(rect!, "width")).toBeCloseTo(xOf(root, "2024-06-01"), 1);
  });

  it("an event in the window is a tick at its date; one outside is not drawn", () => {
    for (const layout of EACH_LAYOUT) {
      const root = f.plots[1]!.layouts[layout];
      const [ticks] = layer(root, "events");
      expect(ticks!.attrs["data-count"]).toBe(1);
      const at = [...String(ticks!.attrs.d).matchAll(/M(-?[\d.]+)/g)].map((m) => Number(m[1]));
      expect(at).toHaveLength(1);
      expect(at[0]).toBeCloseTo(xOf(root, "2024-09-18"), 1);
    }
  });

  it("the chosen event is a line the height of the plot with its name, inside the drawing", () => {
    for (const layout of EACH_LAYOUT) {
      const root = f.plots[0]!.layouts[layout];
      const [chosen] = layer(root, "chosen-event");
      expect(chosen).toBeDefined();
      const line = find(chosen!, (n) => n.tag === "line")[0]!;
      expect(num(line, "y2") - num(line, "y1")).toBeCloseTo(num(area(root), "height"), 1);
      const label = find(chosen!, (n) => n.tag === "rect")[0]!;
      expect(num(label, "x")).toBeGreaterThanOrEqual(0);
      expect(num(label, "x") + num(label, "width")).toBeLessThanOrEqual(LAYOUTS[layout].width);
      expect(textOf(chosen!).length).toBeGreaterThan(0);
    }
  });

  it("no layer is drawn in a colour of the series palette or with an animation", () => {
    const root = f.plots[0]!.layouts.wide;
    for (const name of ["band", "recession", "events", "chosen-event"]) {
      for (const g of layer(root, name)) {
        for (const n of walk(g)) {
          expect(JSON.stringify(n.attrs)).not.toMatch(/--color-series-/);
          expect(n.tag).not.toMatch(/^animate/);
        }
      }
    }
  });

  it("layers come before the Series in the drawing, the chosen event and the pin after", () => {
    const root = renderFigure(spec({ layers, pin: "2024-05-01" }), [rate]).plots[0]!.layouts.wide;
    const order = root.children.filter((c): c is SvgNode => typeof c !== "string").map((c) => String(c.attrs["data-layer"] ?? c.attrs["data-series"] ?? c.attrs["data-pin"] ?? ""));
    const at = (name: string) => order.indexOf(name);
    expect(at("band")).toBeLessThan(at("fx_rate"));
    expect(at("recession")).toBeLessThan(at("fx_rate"));
    expect(at("chosen-event")).toBeGreaterThan(order.lastIndexOf("fx_rate"));
    expect(at("2024-05-01")).toBeGreaterThan(order.lastIndexOf("fx_rate"));
  });
});

describe("a pinned date", () => {
  it("is one upright line at that date in every plot and layout", () => {
    const f = renderFigure(spec({ pin: "2024-05-01" }), [rate, output]);
    for (const plot of f.plots) {
      for (const layout of EACH_LAYOUT) {
        const root = plot.layouts[layout];
        const pins = find(root, (n) => n.attrs["data-pin"] !== undefined);
        expect(pins).toHaveLength(1);
        expect(num(find(pins[0]!, (n) => n.tag === "line")[0]!, "x1")).toBeCloseTo(xOf(root, "2024-05-01"), 1);
      }
    }
  });

  it("outside the window is not drawn", () => {
    const f = renderFigure(spec({ pin: "2030-01-01" }), [rate]);
    expect(find(f.plots[0]!.layouts.wide, (n) => n.attrs["data-pin"] !== undefined)).toEqual([]);
  });
});

describe("a logarithmic axis", () => {
  // Natural logs of 80 … 12,000, as the engine's `log` returns them.
  const values = [80, 150, 400, 900, 2500, 6000, 12000];
  const logged = series({ unit: "index, on a logarithmic scale", scale: "ln", observations: observations("monthly", "2024-01", values.map(Math.log)) });
  const f = renderFigure(spec(), [logged]);

  it("labels its ticks with the values themselves, at round steps of 1, 2 and 5", () => {
    const root = f.plots[0]!.layouts.wide;
    const labels = find(root, (n) => n.attrs["data-axis"] === "y")[0]!.children.filter((c): c is SvgNode => typeof c !== "string" && c.tag === "text").map(textOf);
    expect(labels).toContain("100");
    expect(labels).toContain("1,000");
    expect(labels).toContain("10,000");
    for (const label of labels) expect(label.replace(/,/g, "")).toMatch(/^[125]0*$/);
  });

  it("places equal ratios at equal distances", () => {
    const root = f.plots[0]!.layouts.wide;
    const ticks = find(root, (n) => n.attrs["data-axis"] === "y")[0]!.children.filter((c): c is SvgNode => typeof c !== "string" && c.tag === "text");
    const y = (label: string) => Number(ticks.find((t) => textOf(t) === label)!.attrs.y);
    expect(y("100") - y("1,000")).toBeCloseTo(y("1,000") - y("10,000"), 0);
  });

  it("says so under 'how to read this'", () => {
    expect(f.howToRead.map((l) => l.text).join(" ")).toMatch(/logarithmic.*equal distances.*equal percent changes/i);
  });

  it("a narrow range still gets at least two distinct labels", () => {
    const narrow = series({ unit: "index, on a logarithmic scale", scale: "ln", observations: observations("monthly", "2024-01", [4012, 4051, 4033, 4090].map(Math.log)) });
    const root = renderFigure(spec(), [narrow]).plots[0]!.layouts.narrow;
    const labels = find(root, (n) => n.attrs["data-axis"] === "y")[0]!.children.filter((c): c is SvgNode => typeof c !== "string" && c.tag === "text").map(textOf);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});
