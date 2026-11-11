/**
 * M3's acceptance on v1's data: every one of the 126 series has a series page that is complete
 * in its HTML (no script is needed for anything on it), drawn at its real cadence, with every
 * Observation in the table.
 *
 * The Release is made by the real converter in a temporary directory (PLAN section 9). These
 * tests read v1's real values, so nothing is uploaded and no assertion can print one: every
 * check is reduced to true or false here, and a failure names the Series and the Period only
 * (PLAN 6.1).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogEntry, SeriesFile } from "@macro-atlas/core/release";
import { SeriesPage } from "@/components/SeriesPage";
import { LAYOUTS, type LayoutName, type SvgNode } from "../figure";
import { textOf, walk } from "../figure/svg";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { seriesPageView, type SeriesPageView } from "../series-page";
import { asOf } from "../release/as-of";
import { buildLegacyRelease } from "./testing";

let release: OpenedRelease;
let pages: { entry: CatalogEntry; file: SeriesFile; view: SeriesPageView; html: string }[];
const problems = (found: string[]) => expect(found.slice(0, 12), `${found.length} problem(s)`).toEqual([]);

beforeAll(async () => {
  const legacy = buildLegacyRelease();
  const opened = await createReleaseReader({ root: legacy.root, surface: "local" }).current();
  if (!opened.ok) throw new Error(`the legacy release did not open: ${opened.kind}`);
  release = opened.release;
  pages = release.catalog.series.map((entry) => {
    const answer = seriesPageView(release, "local", entry.key);
    if (answer.kind !== "page") throw new Error(`${entry.key}: no page (${answer.kind})`);
    const html = renderToStaticMarkup(<SeriesPage view={answer.view} basePath="/macro-atlas" />);
    return { entry, file: (release.series[entry.key] ?? release.derived[entry.key])!, view: answer.view, html };
  });
}, 120_000);

const count = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;
const escaped = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("series pages for all of v1's series", () => {
  it("there are 126, and each has a page with values", () => {
    expect(pages).toHaveLength(126);
    problems(pages.filter((p) => p.view.state !== "shown" || p.view.latest === null).map((p) => p.entry.key));
  });

  it("each page is complete in its HTML: name, latest value, figure, table, provenance, a door to the Explorer, and no script", () => {
    const found: string[] = [];
    for (const { entry, file, view, html } of pages) {
      const bad = (what: string) => found.push(`${entry.key}: ${what}`);
      if (/<script|\son[a-z]+=|javascript:/i.test(html)) bad("script in the markup");
      if (!html.includes(`>${escaped(entry.name)}</h1>`)) bad("no heading with the name");
      if (!html.includes("data-latest")) bad("no latest value");
      if (count(html, /<svg[^>]*role="img"/g) !== 3) bad("not exactly three drawings (one per width)");
      if (!(html.includes("data-takeaway") !== html.includes("data-silence"))) bad("neither exactly a takeaway nor exactly a reason for silence");
      if (!html.includes("data-unit-line") || !html.includes("data-source-line")) bad("no unit or source line");
      if (!html.includes("<details data-how-to-read") || !html.includes("<details data-table")) bad("how-to-read or the table is missing");
      const table = /<table data-figure-table[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";
      if (count(table, /<tr/g) - 1 !== file.observations.length) bad("the table does not have one row per observation");
      if (!html.includes(`href="/macro-atlas/explore?s=${entry.key}"`)) bad("no door into the Explorer");
      if (!html.includes(">Origin</a>") || !html.includes(">Channel</a>")) bad("origin and channel are not both named");
      if (entry.source.origin.origin_id && !html.includes(escaped(entry.source.origin.origin_id))) bad("the origin identifier is not shown");
      if (!html.includes("v1&#x27;s rounded output")) bad("the legacy representation is not named");
      if (!html.includes(">Not settled<")) bad("the rights status is not shown");
      if (view.figure.sourceLine.length < 20) bad("no source line");
    }
    problems(found);
  });

  it("the table holds exactly the values the release holds", () => {
    const found: string[] = [];
    for (const { entry, file, view } of pages) {
      const rows = view.figure.tables[0]!.rows;
      if (view.figure.tables[0]!.rounded) found.push(`${entry.key}: v1's rounded values should need no further rounding`);
      file.observations.forEach((o, i) => {
        const row = rows[i];
        const same =
          row !== undefined &&
          row.period === o.period &&
          (o.value === null ? row.value === null && row.exact === null : row.exact === String(o.value) && Number(row.value!.replace(/,/g, "")) === o.value);
        if (!same) found.push(`${entry.key} ${o.period}: the table row is not the observation`);
      });
    }
    problems(found);
  });

  it("each is drawn at its real cadence: a slow series as points or steps, never as a line through months it does not have", () => {
    const found: string[] = [];
    const tally = { line: 0, points: 0, step: 0 };
    for (const { entry, file, view } of pages) {
      const expected = entry.continuity === "held" ? "step" : ["quarterly", "annual", "irregular"].includes(entry.freq) ? "points" : "line";
      const style = view.figure.plots[0]!.series[0]!;
      if (style.drawnAs !== expected) found.push(`${entry.key}: drawn as ${style.drawnAs}, expected ${expected}`);
      tally[style.drawnAs]++;
      const valued = file.observations.filter((o) => o.value !== null).length;
      for (const layout of Object.keys(LAYOUTS) as LayoutName[]) {
        const nodes = [...walk(view.figure.plots[0]!.layouts[layout])].filter((n) => n.attrs["data-series"] === entry.key);
        const kinds = nodes.map((n) => n.attrs["data-drawn"]);
        if (expected === "points" && (kinds.includes("line") || kinds.includes("step"))) found.push(`${entry.key} ${layout}: a line joins points`);
        if (expected !== "line") {
          const points = nodes.find((n) => n.attrs["data-drawn"] === "points");
          if (points?.attrs["data-count"] !== valued) found.push(`${entry.key} ${layout}: not one point per value`);
        } else {
          const line = nodes.find((n) => n.attrs["data-drawn"] === "line");
          const vertices = (String(line?.attrs.d ?? "").match(/[ML]/g) ?? []).length;
          const lonely = Number(nodes.find((n) => n.attrs["data-drawn"] === "points")?.attrs["data-count"] ?? 0);
          // Every vertex is a value the Series holds; a value with no neighbour is a point instead.
          if (vertices > valued || (vertices !== valued && vertices + lonely < valued)) found.push(`${entry.key} ${layout}: the line does not visit exactly the values`);
        }
      }
    }
    problems(found);
    expect(tally).toEqual({ line: 105, points: 19, step: 2 });
  });

  it("no label is clipped at the narrowest width, or any other", () => {
    const found: string[] = [];
    for (const { entry, view } of pages) {
      for (const layout of Object.keys(LAYOUTS) as LayoutName[]) {
        const { width, height } = LAYOUTS[layout];
        const root: SvgNode = view.figure.plots[0]!.layouts[layout];
        const texts = [...walk(root)].filter((n) => n.tag === "text");
        if (texts.length < 4) found.push(`${entry.key} ${layout}: fewer than four axis labels`);
        for (const n of texts) {
          const w = textOf(n).length * 7;
          const x = Number(n.attrs.x);
          const left = n.attrs["text-anchor"] === "end" ? x - w : n.attrs["text-anchor"] === "middle" ? x - w / 2 : x;
          if (left < 0 || left + w > width || Number(n.attrs.y) > height - 2 || Number(n.attrs.y) < 11 || Number(n.attrs["font-size"]) < 12) {
            found.push(`${entry.key} ${layout}: a label does not fit`);
          }
        }
      }
    }
    problems(found);
  });

  it("a page's HTML stays small enough to read on a phone (ADR 0017)", () => {
    const sizes = pages.map((p) => Buffer.byteLength(p.html));
    expect(Math.max(...sizes)).toBeLessThan(100_000);
  });
});

describe("as-of questions of v1's series (M10)", () => {
  it("are answered on the legacy basis or not at all, and never with today's figures for an earlier date", () => {
    expect(release.vintages).toEqual({});
    const generated = release.manifest.inputs?.map((input) => input.generated).find((time) => typeof time === "string");
    expect(generated, "the legacy Release says when v1's output was generated").toBeTruthy();
    const dayAfter = new Date(Date.parse(generated!) + 2 * 86_400_000).toISOString().slice(0, 10);
    const wrong: string[] = [];
    for (const { entry, file } of pages) {
      for (const early of ["1999-12-31", "2008-09-15", generated!.slice(0, 10)]) {
        const answer = asOf(release, entry.key, early)!;
        if (answer.basis !== "unavailable" || answer.observations.length > 0) wrong.push(`${entry.key} as of ${early}: ${answer.basis}`);
      }
      const later = asOf(release, entry.key, dayAfter)!;
      if (later.basis !== "legacy" || later.observations.length !== file.observations.length) wrong.push(`${entry.key} as of ${dayAfter}: ${later.basis}`);
    }
    problems(wrong);
  });
});
