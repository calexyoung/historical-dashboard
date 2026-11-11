/**
 * Export (PLAN M5): CSV and the chart, through one function that asks the rights gate. On the
 * local surface every export is allowed and is stamped "not for publication"; on any other
 * surface it is refused (until M6's register says otherwise) and nothing of the data leaves.
 * On the synthetic fixture release.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import { parseExplorerParams } from "../explorer/state";
import { explorerView } from "../explorer/view";
import { PRINT_COLORS } from "../figure/print";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { FIXTURE_ROOT } from "../release/testing";
import { EXPORT_FORMATS, exportView, parseCsv, type ExportFormat } from "./index";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const ADDRESS = "http://localhost:3000/macro-atlas/explore";
const state = (query: string) => parseExplorerParams(new URLSearchParams(query));
const run = (query: string, format: ExportFormat, surface = "local") => exportView(release, surface, state(query), format, { address: ADDRESS });
const ok = (query: string, format: ExportFormat) => {
  const result = run(query, format);
  if (!result.ok) throw new Error(result.message);
  return result;
};
const table = (body: string) => parseCsv(body.split("\n").filter((line) => !line.startsWith("#")).join("\n"));

describe("the CSV of a view", () => {
  const q = "s=fx_price_index,fx_output_quarterly&mode=rebase&from=2024-01&to=2025-06";

  it("holds the values on screen: every row of the chart's table, and nothing else", () => {
    const view = explorerView(release, "local", state(q));
    const [header, ...rows] = table(ok(q, "csv").body);
    expect(header).toEqual(["series", "name", "run", "period", "period_start", "period_end", "value", "unit", "shown_as", "shown_value", "shown_unit", "status"]);
    const onScreen = view.figure!.tables.flatMap((t) => t.rows.map((row) => `${t.key}|${row.period}|${row.exact ?? ""}`));
    const exported = rows.map((r) => `${r[0]}${r[2] === "comparison" ? ".compared" : ""}|${r[3]}|${r[9]}`);
    expect(onScreen.length).toBeGreaterThan(20);
    expect(exported).toEqual(onScreen);
  });

  it("carries the series' own value beside the value as drawn, with unit, period bounds and status", () => {
    const rows = table(ok(q, "csv").body);
    expect(rows[1]).toEqual(["fx_price_index", "Fixture price index", "window", "2024-01", "2024-01-01", "2024-01-31", "100", "index, 2024-01 = 100", "rebase", "100", "index, first value in the window = 100", "final"]);
    const gap = rows.find((r) => r[0] === "fx_price_index" && r[3] === "2025-03")!;
    expect([gap[6], gap[9], gap[11]]).toEqual(["", "", "missing"]);
    const quarter = rows.find((r) => r[0] === "fx_output_quarterly")!;
    expect(quarter.slice(3, 7)).toEqual(["2024-Q1", "2024-01-01", "2024-03-31", "540.1"]);
  });

  it("in a comparison, says which run a row belongs to, and still holds what is on screen", () => {
    const q2 = "s=fx_price_index&mode=rebase&from=2024-01&to=2024-06&cmp=2025-04";
    const rows = table(ok(q2, "csv").body);
    const onScreen = explorerView(release, "local", state(q2)).figure!.tables.flatMap((t) => t.rows.map((row) => `${t.key}|${row.period}|${row.exact ?? ""}`));
    expect(rows.slice(1).map((r) => `${r[0]}${r[2] === "comparison" ? ".compared" : ""}|${r[3]}|${r[9]}`)).toEqual(onScreen);
    expect(rows.slice(1).map((r) => r[2])).toEqual([...Array<string>(6).fill("window"), ...Array<string>(6).fill("comparison")]);
    expect(rows[7]!.slice(0, 4)).toEqual(["fx_price_index", "Fixture price index", "comparison", "2025-04"]);
  });

  it("is stamped not for publication, in the file and in its name, and says what it is", () => {
    const result = ok(q, "csv");
    const preamble = result.body.split("\n").filter((line) => line.startsWith("#"));
    expect(preamble[0]).toBe("# Macro Atlas · NOT FOR PUBLICATION");
    expect(preamble.join("\n")).toContain(`# Release ${release.id} · engine semantics ${SEMANTICS_VERSION}`);
    expect(preamble.join("\n")).toContain(`# View: ${ADDRESS}?s=fx_price_index,fx_output_quarterly&mode=rebase&from=2024-01&to=2025-06`);
    expect(preamble.join("\n")).toMatch(/# Shown as: Index: start of the window = 100 · Jan 2024 to Jun 2025/);
    expect(preamble.join("\n")).toMatch(/# Source: .*fixture/i);
    expect(result.filename).toBe("macro-atlas_rebase_2024-01_2025-06_not-for-publication.csv");
    expect(result.contentType).toBe("text/csv; charset=utf-8");
  });

  it("quotes what needs quoting", () => {
    expect(ok(q, "csv").body).toContain('"index, 2024-01 = 100"');
  });

  it("leaves a withheld series out and says so", () => {
    const result = ok("s=fx_price_index,fx_exchange_index", "csv");
    expect(new Set(table(result.body).slice(1).map((r) => r[0]))).toEqual(new Set(["fx_price_index"]));
    expect(result.body).toMatch(/# Not in this file: Fixture exchange index \(withheld/i);
  });

  it("has nothing to give when nothing is drawn", () => {
    expect(run("", "csv")).toMatchObject({ ok: false, status: 422 });
    expect(run("s=fx_exchange_index", "csv")).toMatchObject({ ok: false, status: 422 });
  });
});

describe("the chart as a file", () => {
  it("is one standalone drawing: every plot, its series by name, the unit, the source and the release", () => {
    const { body, filename, contentType } = ok("s=fx_price_index,fx_output_quarterly&layers=rec", "svg");
    expect(contentType).toBe("image/svg+xml; charset=utf-8");
    expect(filename).toBe("macro-atlas_lin_2022-01_2025-12_not-for-publication.svg");
    expect(body.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(body.match(/data-layout="wide"/g)).toHaveLength(2);
    expect(body).not.toMatch(/data-layout="(narrow|medium)"/);
    for (const text of ["Fixture price index", "Fixture output", "billions of fixture dollars", "Source", release.id, "Jan 2022 to Dec 2025"]) expect(body, text).toContain(text);
  });

  it("is stamped in the image itself", () => {
    expect(ok("s=fx_price_index", "svg").body.match(/NOT FOR PUBLICATION/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("stands alone: no colour is left to a stylesheet it will not have, and the ground is opaque", () => {
    const { body } = ok("s=fx_price_index,fx_output_quarterly,fx_vote_margin&ext=1&cmp=2023-01&from=2024-01", "svg");
    expect(body).not.toContain("var(--");
    expect(body).toContain(`fill="${PRINT_COLORS["--color-panel"]}"`);
    expect(body).toMatch(/font-family="[^"]*system-ui/);
  });

  it("prints in the light theme's own colours (globals.css)", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const theme = css.slice(css.indexOf("@theme static"), css.indexOf("}", css.indexOf("@theme static")));
    for (const [name, value] of Object.entries(PRINT_COLORS)) expect(theme, name).toContain(`${name}: ${value};`);
  });
});

describe("every series as one file (v1's All data CSV)", () => {
  it("holds the whole history of every series that may be handed out, and names the rest", () => {
    const result = ok("", "all");
    const [header, ...rows] = table(result.body);
    expect(header).toEqual(["series", "name", "unit", "frequency", "period", "period_start", "period_end", "value", "status"]);
    const files = { ...release.series, ...release.derived };
    const withheld = new Set(release.manifest.withheld.map((w) => w.key));
    const expected = release.catalog.series.filter((e) => !withheld.has(e.key)).reduce((n, e) => n + files[e.key]!.observations.length, 0);
    expect(rows).toHaveLength(expected);
    expect(new Set(rows.map((r) => r[0])).has("fx_exchange_index")).toBe(false);
    expect(result.body).toMatch(/# Not in this file: Fixture exchange index \(withheld/);
    expect(result.body.split("\n")[0]).toBe("# Macro Atlas · NOT FOR PUBLICATION");
    expect(result.filename).toBe(`macro-atlas_all_${release.id}_not-for-publication.csv`);
  });
});

describe("the gate", () => {
  it.each(["staging", "production", "nowhere"])("on the %s surface every export is refused, and the refusal carries no data", (surface) => {
    for (const format of EXPORT_FORMATS) {
      const result = run("s=fx_price_index", format, surface);
      expect(result).toMatchObject({ ok: false, status: 403 });
      expect(JSON.stringify(result)).not.toMatch(/109\.9|100\.4|"body"/);
    }
  });

  it("asks for the permission to redistribute, with the lineage of everything in the file", () => {
    const result = ok("s=fx_price_index_yoy", "csv");
    expect(result.rightsUsed.every((row) => row.permission === "redistribute")).toBe(true);
    expect(result.series).toEqual(["fx_price_index", "fx_price_index_yoy"]); // the derived series and its input
  });

  it("an unknown format is refused before anything is read", () => {
    expect(exportView(release, "local", state("s=fx_price_index"), "xlsx" as ExportFormat, { address: ADDRESS })).toMatchObject({ ok: false, status: 400 });
  });
});
