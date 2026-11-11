/**
 * The series palette under colour-vision deficiency, in both themes (PLAN section 8; DESIGN.md).
 *
 * Eight colours cannot all stay apart for every reader, so colour is never the only channel:
 * a Series also has a line style and a symbol. The rule checked here: any two palette colours
 * that come close under protanopia, deuteranopia or tritanopia (or with full colour vision) must
 * differ in BOTH line style and symbol, so a line-drawn pair and a point-drawn pair can each be
 * told apart. Simulation: Machado, Oliveira and Fernandes (2009), severity 1.0, on linear RGB;
 * distance: CIE76 in CIELAB (D65). The matrices are the published ones, typed in by hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { styleFor } from "./plot";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
function palette(after: string): string[] {
  const start = css.indexOf(after);
  const body = css.slice(css.indexOf("{", start + after.length - 1) + 1, css.indexOf("}", start + after.length));
  const found = Object.fromEntries([...body.matchAll(/--color-series-(\d):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
  return Array.from({ length: 8 }, (_, i) => found[String(i + 1)]!);
}

type Matrix = [number, number, number][];
const VISION: Record<string, Matrix> = {
  "full colour vision": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const linear = (hex: string): number[] =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
const seen = (rgb: number[], m: Matrix): number[] => m.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0]! + row[1] * rgb[1]! + row[2] * rgb[2]!)));
function lab([r, g, b]: number[]): [number, number, number] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r! + 0.3576 * g! + 0.1805 * b!) / 0.95047);
  const y = f(0.2126 * r! + 0.7152 * g! + 0.0722 * b!);
  const z = f((0.0193 * r! + 0.1192 * g! + 0.9505 * b!) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const distance = (a: string, b: string, m: Matrix): number => {
  const [p, q] = [lab(seen(linear(a), m)), lab(seen(linear(b), m))];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** Below this, two colours are treated as ones a reader may confuse. */
const APART = 16;

describe("the colour arithmetic", () => {
  it("agrees with known values", () => {
    expect(lab(linear("#ffffff"))[0]).toBeCloseTo(100, 1);
    expect(lab(linear("#000000"))[0]).toBeCloseTo(0, 5);
    // Pure red and pure green are far apart with full vision and close under deuteranopia.
    expect(distance("#ff0000", "#00ff00", VISION["full colour vision"]!)).toBeGreaterThan(150);
    expect(distance("#ff0000", "#00ff00", VISION.deuteranopia!)).toBeLessThan(distance("#ff0000", "#00ff00", VISION["full colour vision"]!) / 3);
  });
});

describe.each([
  ["light", palette("@theme {")],
  ["dark", palette(':root[data-theme="dark"] {')],
])("the series palette, %s theme", (_theme, colours) => {
  it("has eight colours", () => {
    expect(colours.filter(Boolean)).toHaveLength(8);
  });

  it("any two colours a reader may confuse differ in line style and in symbol", () => {
    const failures: string[] = [];
    let confusable = 0;
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const closest = Math.min(...Object.values(VISION).map((m) => distance(colours[i]!, colours[j]!, m)));
        if (closest >= APART) continue;
        confusable++;
        const [a, b] = [styleFor(i), styleFor(j)];
        if (a.dash === b.dash || a.symbol === b.symbol) failures.push(`series-${i + 1} and series-${j + 1} (distance ${closest.toFixed(1)})`);
      }
    }
    expect(failures).toEqual([]);
    expect(confusable).toBeGreaterThan(0); // the second and third channels are doing real work
  });

  it("the first four colours, a phone's soft cap, stay apart with full colour vision", () => {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expect(distance(colours[i]!, colours[j]!, VISION["full colour vision"]!), `series-${i + 1} and series-${j + 1}`).toBeGreaterThanOrEqual(APART);
    }
  });

  it("neighbours in the palette never share a line style or a symbol", () => {
    for (let i = 0; i < 7; i++) {
      const [a, b] = [styleFor(i), styleFor(i + 1)];
      expect(a.dash, `series-${i + 1} and its neighbour`).not.toBe(b.dash);
      expect(a.symbol).not.toBe(b.symbol);
    }
  });
});
