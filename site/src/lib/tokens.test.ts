/** The design tokens in globals.css hold the contrast DESIGN.md promises, in both themes. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(after: string): Record<string, string> {
  const start = css.indexOf(after);
  if (start < 0) throw new Error(`globals.css has no block ${after}`);
  const body = css.slice(css.indexOf("{", start + after.length - 1) + 1, css.indexOf("}", start + after.length));
  return Object.fromEntries([...body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
}

const light = block("@theme {");
const darkByOs = block(':root:not([data-theme="light"]) {');
const darkByChoice = block(':root[data-theme="dark"] {');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const TEXT = ["ink", "ink-2", "ink-3", "accent", "nominal", "delayed", "outage", "unknown"];
const GROUNDS = ["void", "panel", "raised"];
const MARKS = ["control", "accent", ...Array.from({ length: 8 }, (_, i) => `series-${i + 1}`)];

describe("contrast holds in both themes (WCAG 2.2: text 4.5:1, marks and control borders 3:1)", () => {
  it("has the same contrast arithmetic as the WCAG examples", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("the dark theme is one set of tokens, whether the OS or the reader chose it", () => {
    expect(darkByOs).toEqual(darkByChoice);
  });

  it("the dark theme redefines every colour the light theme defines", () => {
    expect(Object.keys(darkByChoice).sort()).toEqual(Object.keys(light).sort());
  });

  for (const [name, theme] of [["light", light], ["dark", darkByChoice]] as const) {
    it.each(TEXT.flatMap((t) => GROUNDS.map((g) => [t, g] as const)))(`${name}: text %s on %s is at least 4.5:1`, (t, g) => {
      expect(theme[t], `--color-${t}`).toBeDefined();
      expect(contrast(theme[t]!, theme[g]!)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(MARKS)(`${name}: %s is at least 3:1 against the page`, (mark) => {
      expect(theme[mark], `--color-${mark}`).toBeDefined();
      expect(contrast(theme[mark]!, theme.void!)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: no series colour is the interactive navy, and all eight differ`, () => {
      const series = MARKS.filter((m) => m.startsWith("series-")).map((m) => theme[m]!);
      expect(new Set(series).size).toBe(8);
      expect(series).not.toContain(theme.accent);
    });
  }
});
