/**
 * The sparkline (PLAN M22; DESIGN.md): a Series' last ten years in one small drawing, with no
 * axis. It follows the explained figure's rule for cadence, and never draws what is not held.
 */
import { describe, expect, it } from "vitest";
import { sparkline, SPARK } from "./sparkline";
import { svgString, walk, type SvgNode } from "./svg";
import { observations, onDays, series } from "./testing";

const find = (node: SvgNode, attr: string): SvgNode[] => [...walk(node)].filter((n) => attr in n.attrs);
const numbers = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("sparkline", () => {
  it("draws a monthly Series as one line and marks its last value", () => {
    const drawing = sparkline(series({ observations: observations("monthly", "2024-01", [1, 2, 3, 4, 5, 6]) }))!;
    expect(drawing.tag).toBe("svg");
    expect(drawing.attrs.viewBox).toBe(`0 0 ${SPARK.width} ${SPARK.height}`);
    const [line] = find(drawing, "data-line");
    expect(String(line!.attrs.d).match(/M/g)).toHaveLength(1);
    expect(String(line!.attrs.d).match(/L/g)).toHaveLength(5);
    expect(line!.attrs.stroke).toBe("currentColor");
    expect(find(drawing, "data-last")).toHaveLength(1);
    // Rising values rise on the page: the last point is above the first (a smaller y).
    const ys = numbers(String(line!.attrs.d)).filter((_, i) => i % 2 === 1);
    expect(ys.at(-1)!).toBeLessThan(ys[0]!);
    // Everything stays inside the drawing.
    for (const [i, n] of numbers(String(line!.attrs.d)).entries()) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(i % 2 === 0 ? SPARK.width : SPARK.height);
    }
  });

  it("names the Series and the Periods it runs between, for a reader who cannot see it", () => {
    const drawing = sparkline(series({ name: "Fixture rate", observations: observations("monthly", "2024-01", [1, 2, 3]) }))!;
    expect(drawing.attrs.role).toBe("img");
    expect(drawing.attrs["aria-label"]).toBe("Fixture rate, January 2024 to March 2024");
  });

  it("never draws across a Period that has no value", () => {
    const drawing = sparkline(series({ observations: observations("monthly", "2024-01", [1, 2, null, 4, 5]) }))!;
    expect(String(find(drawing, "data-line")[0]!.attrs.d).match(/M/g)).toHaveLength(2);
  });

  it("draws a quarterly or annual Series as points, and a held one as steps (the figure's rule for cadence)", () => {
    const annual = sparkline(series({ freq: "annual", observations: observations("annual", "2015", [1, 2, 3, 4]) }))!;
    expect(find(annual, "data-line")).toHaveLength(0);
    expect(find(annual, "data-point")).toHaveLength(4);
    const held = sparkline(series({ freq: "irregular", continuity: "held", observations: onDays({ "2020-11-03": 4, "2024-11-05": -1 }) }))!;
    expect(String(find(held, "data-line")[0]!.attrs.d)).toMatch(/H/);
  });

  it("shows the ten years to the latest value and nothing older", () => {
    // 2010-01 … 2025-12: 192 months, of which the last 121 (2015-12 … 2025-12) are drawn.
    const drawing = sparkline(series({ observations: observations("monthly", "2010-01", Array.from({ length: 192 }, (_, i) => i)) }))!;
    expect(String(find(drawing, "data-line")[0]!.attrs.d).match(/[ML]/g)).toHaveLength(121);
    expect(drawing.attrs["aria-label"]).toBe("Fixture rate, December 2015 to December 2025");
  });

  it("draws a Series that does not move as a level line, and one value as a point", () => {
    const flat = sparkline(series({ observations: observations("monthly", "2024-01", [3, 3, 3]) }))!;
    const ys = numbers(String(find(flat, "data-line")[0]!.attrs.d)).filter((_, i) => i % 2 === 1);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBe(SPARK.height / 2);
    const one = sparkline(series({ observations: observations("monthly", "2024-01", [3]) }))!;
    expect(find(one, "data-line")).toHaveLength(0);
    expect(find(one, "data-last")).toHaveLength(1);
  });

  it("is nothing for a Series with no value, and writes no value into the markup", () => {
    expect(sparkline(series({ observations: observations("monthly", "2024-01", [null, null]) }))).toBeNull();
    const markup = svgString(sparkline(series({ observations: observations("monthly", "2024-01", [4417.5, 9902.25]) }))!);
    expect(markup).not.toContain("4417");
    expect(markup).not.toContain("9902");
  });
});
