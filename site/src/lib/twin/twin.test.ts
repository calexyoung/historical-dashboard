/**
 * Twins (PLAN section 7 and M17): `/data/{key}.csv | .json | .metadata.json | .md`. Add a suffix
 * to a page's address and get the data behind the page, from the same Query, behind the same
 * gate. Tested through `seriesTwin()` on the synthetic fixture release, and against the page's
 * own HTML.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { createRightsGate, SEMANTICS_VERSION } from "@macro-atlas/core";
import { SeriesPage } from "@/components/SeriesPage";
import { parseCsv } from "../export";
import { STATE_INFO } from "../figure";
import { stateOfStatus } from "../figure/states";
import { periodWords } from "../figure/words";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { FIXTURE_ID, FIXTURE_ROOT, fixtureRegister } from "../release/testing";
import { seriesPageView } from "../series-page";
import { seriesTwin, twinOf, TWIN_FORMATS, type TwinFormat } from "./index";

let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});

const ADDRESS = "http://localhost:3000/macro-atlas";
const twin = (key: string, format: TwinFormat, search = "", surface: "local" | "staging" | "production" = "local", gate?: ReturnType<typeof createRightsGate>) =>
  seriesTwin(release, surface, key, format, new URLSearchParams(search), { address: ADDRESS, gate });
const json = (key: string, search = "") => {
  const answer = twin(key, "json", search);
  if (answer.status !== 200) throw new Error(`${key}: ${answer.status} ${answer.body}`);
  return JSON.parse(answer.body);
};
const SHOWN = ["fx_price_index", "fx_output_quarterly", "fx_poverty_rate_annual", "fx_vote_margin", "fx_price_index_yoy", "fx_payrolls_break", "fx_permits_stale"];

/** The rows of the page's own table of values, read back from its HTML. */
function htmlRows(key: string, search: string): { label: string; value: number | null; state: string }[] {
  const answer = seriesPageView(release, "local", key, { search: new URLSearchParams(search), address: ADDRESS });
  if (answer.kind !== "page") throw new Error(`${key}: ${answer.kind}`);
  const html = renderToStaticMarkup(createElement(SeriesPage, { view: answer.view, basePath: "/macro-atlas" }));
  const table = /<table data-figure-table="[^"]*"[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1];
  if (table === undefined) return [];
  const text = (cell: string) => cell.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  return [...table.matchAll(/<tr><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)].map((row) => {
    const exact = /<data value="([^"]*)">/.exec(row[2]!)?.[1];
    const shown = text(row[2]!);
    const value = shown === "No value" ? null : Number(exact ?? shown.replace(/−/g, "-").replace(/,/g, ""));
    return { label: text(row[1]!), value, state: text(row[3]!) };
  });
}

describe("the same values in the HTML table, the JSON and the CSV (M17's first criterion)", () => {
  const cases = [
    ...SHOWN.map((key) => [key, ""] as const),
    ["fx_price_index", "transform=pc1&start=2025-01-01"] as const,
    ["fx_price_index", "freq=quarterly&agg=last"] as const,
    ["fx_price_index", "as_of=2025-12-13"] as const,
    ["fx_output_quarterly", "as_of=2025-11-20&transform=chg"] as const,
    ["fx_price_index_yoy", "as_of=2025-12-11&end=2025-10-31"] as const,
  ];
  it.each(cases)("%s %s", (key, search) => {
    const doc = json(key, search);
    const fromJson = doc.observations.map((o: { period: string; value: number | null; status: string }) => [o.period, o.value, o.status]);
    expect(fromJson.length).toBeGreaterThan(0);

    const csv = twin(key, "csv", search);
    expect(csv.status).toBe(200);
    const rows = parseCsv(csv.body.split("\n").filter((line) => !line.startsWith("#")).join("\n"));
    expect(rows[0]).toEqual(["series", "period", "period_start", "period_end", "value", "status", "basis", "note"]);
    const fromCsv = rows.slice(1).map((r) => [r[1], r[4] === "" ? null : Number(r[4]), r[5]]);
    expect(fromCsv).toEqual(fromJson);
    expect(rows.slice(1).every((r) => r[0] === key)).toBe(true);

    const html = htmlRows(key, search);
    expect(html.map((r) => r.value)).toEqual(fromJson.map((o: unknown[]) => o[1]));
    expect(html.map((r) => r.label)).toEqual(doc.observations.map((o: { period: string; period_start: string }) => periodWords(doc.frequency, o, "short")));
    // A Status the page marks is the Status the files carry.
    doc.observations.forEach((o: { status: string }, i: number) => { // (a Period a Transform cannot answer keeps its Status in the files only)
      const state = stateOfStatus(o.status);
      if (state && doc.observations[i].value !== null) expect(html[i]!.state).toContain(STATE_INFO[state].word);
    });

    const md = twin(key, "md", search);
    expect(md.status).toBe(200);
    for (const o of doc.observations.slice(-3)) expect(md.body).toContain(`| ${o.period} | ${o.value ?? ""} |`);
  });
});

describe("what a twin carries", () => {
  it("JSON: provenance, rights, the release and the engine's version", () => {
    const doc = json("fx_price_index");
    expect(doc).toMatchObject({
      key: "fx_price_index",
      name: "Fixture price index",
      unit: "index, 2024-01 = 100",
      frequency: "monthly",
      release_id: FIXTURE_ID,
      semantics_version: SEMANTICS_VERSION,
      as_of: null,
      basis: null,
      provenance: { origin: { producer: "Macro Atlas fixture (synthetic)", dataset: "fixture", origin_id: "FX-PRICE" }, channel: { via: "fixture" }, representation: "native" },
      rights: { status: "public_domain", attribution: "Synthetic test data, Macro Atlas project", permission: "redistribute" },
      address: `${ADDRESS}/data/fx_price_index`,
    });
    expect(doc.citation).toContain("Fixture price index");
    expect(doc.observations.at(-1)).toEqual({ period: "2025-12", period_start: "2025-12-01", period_end: "2025-12-31", value: 109.9, status: "preliminary" });
  });

  it("an as-of answer says its Basis, its Capture gap and the same-day flag, and each Observation its own evidence", () => {
    const doc = json("fx_price_index", "as_of=2025-12-13");
    expect(doc).toMatchObject({
      as_of: "2025-12-13",
      basis: "uncertain",
      cutoff: { instant: "2025-12-13T05:00:00Z" },
      capture_gap: { missed_days: 1 },
      same_day_release: false,
      request: { as_of: "2025-12-13" },
    });
    expect(doc.observations.at(-1)).toMatchObject({ period: "2025-11", value: 109.5, basis: "uncertain", known_from: "2025-12-10T15:45:00Z" });
    const csv = twin("fx_price_index", "csv", "as_of=2025-12-13").body;
    expect(csv).toContain("# As known before 13 December 2025");
    expect(csv.trimEnd().split("\n").at(-1)).toBe("fx_price_index,2025-11,2025-11-01,2025-11-30,109.5,preliminary,uncertain,");
  });

  it("a date without coverage is an answer that holds no Observation and says why", () => {
    const doc = json("fx_price_index", "as_of=2025-12-01");
    expect(doc).toMatchObject({ basis: "unavailable", reason: "no_coverage", observations: [] });
    expect(twin("fx_price_index", "csv", "as_of=2025-12-01").body).not.toMatch(/^fx_price_index,/m);
  });

  it("a transform and a slower frequency are named in the file", () => {
    const doc = json("fx_price_index", "transform=pc1&freq=quarterly");
    expect(doc).toMatchObject({ frequency: "quarterly", native_frequency: "monthly", aggregated: { from: "monthly", to: "quarterly", method: "mean" }, transform: { name: "pc1" }, unit: "percent change from a year earlier" });
    expect(twin("fx_price_index", "csv", "transform=pc1&freq=quarterly").body).toContain("# Shown as: percent change from a year earlier · brought from monthly to quarterly by mean");
  });

  it("on the local surface every file is stamped, in its content and its name", () => {
    expect(json("fx_price_index").notice).toMatch(/not for publication/i);
    const csv = twin("fx_price_index", "csv");
    expect(csv.body.split("\n")[0]).toBe("# Macro Atlas · NOT FOR PUBLICATION");
    expect(csv).toMatchObject({ filename: "macro-atlas_fx_price_index_not-for-publication.csv", disposition: "attachment" });
    expect(twin("fx_price_index", "json")).toMatchObject({ filename: "macro-atlas_fx_price_index_not-for-publication.json", disposition: "inline" });
    expect(twin("fx_price_index", "md")).toMatchObject({ filename: "macro-atlas_fx_price_index_not-for-publication.md", disposition: "inline" });
    expect(twin("fx_price_index", "md").body).toMatch(/not for publication/i);
  });

  it("metadata: the catalog's record of the Series and no value", () => {
    const answer = twin("fx_payrolls_break", "metadata.json");
    const doc = JSON.parse(answer.body);
    expect(doc).toMatchObject({
      key: "fx_payrolls_break",
      frequency: "monthly",
      measure_kind: "stock",
      state: "shown",
      breaks: [{ period: "2025-01" }],
      source: { origin: { producer: "Macro Atlas fixture (synthetic)" }, channel: { via: "fixture" } },
      rights: { status: "public_domain" },
      coverage: { first_period: "2024-01", last_period: "2025-12" },
      twins: { csv: `${ADDRESS}/data/fx_payrolls_break.csv` },
    });
    expect(answer.body).not.toMatch(/"value"|observations"/);
    // Only fields this file names: nothing rides along from a catalog entry.
    expect(Object.keys(doc.source.channel).sort()).toEqual(["adapter", "via"]);
  });

  it("Markdown: the page in words, with its table, citation and links", () => {
    const md = twin("fx_price_index", "md").body;
    expect(md).toMatch(/^# Fixture price index\n/);
    expect(md).toContain("| Period | Value | Status |");
    expect(md).toContain("## Provenance");
    expect(md).toContain(`${ADDRESS}/data/fx_price_index.csv`);
  });
});

describe("text from a Release is text in every file", () => {
  it("a name, a description or a note cannot bring markup, a link, a heading or a formula with it", () => {
    const NAME = '<img src=x onerror=alert(1)> [click](javascript:alert(1)) | **x**';
    const hostile = {
      ...release,
      catalog: {
        series: release.catalog.series.map((e) =>
          e.key === "fx_payrolls_break"
            ? { ...e, name: NAME, description: "# Heading\n\n[Injected link](javascript:alert(1)) <script>alert(1)</script>", unit: "=HYPERLINK(1)", breaks: [{ period: "2025-01", note: "| a | b |\n|---|---|\n`code` <b>bold</b>" }] }
            : e,
        ),
      },
    };
    const of = (format: TwinFormat) => seriesTwin(hostile, "local", "fx_payrolls_break", format, new URLSearchParams(), { address: ADDRESS });
    const md = of("md").body;
    expect(md).not.toMatch(/<img|<script|<b>/);
    expect(md).not.toMatch(/(^|[^\\])\[click\]\(javascript:|(^|[^\\])\[Injected link\]/);
    expect(md).not.toMatch(/^# Heading/m);
    const listy = { ...release, catalog: { series: release.catalog.series.map((e) => (e.key === "fx_payrolls_break" ? { ...e, description: "- a list item ~~struck~~", name: "1. numbered" } : e)) } };
    const plain = seriesTwin(listy, "local", "fx_payrolls_break", "md", new URLSearchParams(), { address: ADDRESS }).body;
    expect(plain).toContain("\\- a list item \\~\\~struck\\~\\~");
    expect(plain).toMatch(/^# \\1\. numbered$/m);
    expect(md.split("\n").filter((line) => /^#+ /.test(line)).map((line) => line.replace(/^#+ /, "").slice(0, 12))).toEqual(["&lt;img src=", "Definition", "Provenance", "Breaks and n", "Values", "Cite and dow"]);
    // The table of values keeps its three columns: nothing from the Catalog opened a cell.
    const table = md.slice(md.indexOf("| Period | Value | Status |"));
    for (const row of table.split("\n").filter((line) => line.startsWith("| 20"))) expect(row.split(/(?<!\\)\|/).length).toBe(5);
    expect(md).toContain("&lt;img src=x onerror=alert\\(1\\)&gt;".replace(/\\\(/g, "(").replace(/\\\)/g, ")"));
    // CSV: a comment line stays one line and no cell begins as a formula; JSON is JSON.
    const csv = of("csv").body;
    expect(csv.split("\n").filter((line) => !line.startsWith("#") && line !== "")).toHaveLength(1 + 24);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(JSON.parse(of("json").body).name).toBe(NAME);
  });
});

describe("the address", () => {
  it.each([
    ["/data/fx_price_index.csv", "fx_price_index", "csv"],
    ["/data/fx_price_index.json", "fx_price_index", "json"],
    ["/data/fx_price_index.metadata.json", "fx_price_index", "metadata.json"],
    ["/data/fx_price_index.md", "fx_price_index", "md"],
  ])("%s is a twin", (path, key, format) => {
    expect(twinOf(path)).toEqual({ key, format });
  });
  it.each(["/data/fx_price_index", "/data/fx_price_index.xml", "/data/a/b.csv", "/data/.csv", "/data/../x.csv", "/explore.csv", "/data/fx.csv/", "/data/FX.csv"])("%s is not", (path) => {
    expect(twinOf(path)).toBeNull();
  });

  it.each([
    ["an unknown transform", "transform=sqrt", "transform: one of lin, chg"],
    ["an unknown parameter", "window=5", "there is no parameter called"],
    ["a bad date", "start=2025-02-30", "start: a calendar date"],
    ["a bad as-of", "as_of=yesterday", "as_of:"],
    ["a parameter given twice", "start=2025-01-01&start=2025-02-01", "more than once"],
    ["a pinned release", "pin=20260101T000000Z-0000000", "pin:"],
  ])("refuses %s with 400 and the allowlist", (_, search, says) => {
    for (const format of ["csv", "json", "md"] as const) {
      const answer = twin("fx_price_index", format, search);
      expect(answer.status).toBe(400);
      expect(answer.body).toContain(says);
      expect(answer.body).not.toMatch(/109\.9/);
    }
  });

  it("a transform the Series does not offer, or a frequency it cannot be brought to, is 400 with the reason", () => {
    expect(twin("fx_price_index_yoy", "json", "transform=rebase")).toMatchObject({ status: 400 });
    expect(JSON.parse(twin("fx_price_index_yoy", "json", "transform=rebase").body).error).toMatchObject({ code: "not_offered" });
    expect(JSON.parse(twin("fx_poverty_rate_annual", "json", "freq=monthly").body).error).toMatchObject({ code: "not_slower" });
  });

  it("an unknown key is 404; a renamed key moves to its permanent address, question and all", async () => {
    expect(twin("nope", "csv")).toMatchObject({ status: 404 });
    const { addRelease, promote, tempRoot } = await import("../release/testing");
    const root = tempRoot();
    addRelease(root, { id: "20260201T000000Z-2222222", edit: { fx_permits_stale: (_, entry) => (entry.aliases = ["fx_old_permits"]) } });
    promote(root, "20260201T000000Z-2222222");
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const moved = seriesTwin(opened.release, "local", "fx_old_permits", "csv", new URLSearchParams("start=2024-01-01"), { address: ADDRESS });
    expect(moved).toMatchObject({ status: 308, location: "/data/fx_permits_stale.csv?start=2024-01-01" });
  });
});

describe("the rights gate (PLAN 6.1, section 7)", () => {
  it("the withheld Series has its metadata by name and reason, and no file of values", () => {
    for (const format of ["csv", "json", "md"] as const) {
      const answer = twin("fx_exchange_index", format);
      expect(answer.status).toBe(403);
      expect(answer.body).toContain("does not allow redistribution");
    }
    const meta = JSON.parse(twin("fx_exchange_index", "metadata.json").body);
    expect(meta).toMatchObject({ key: "fx_exchange_index", name: "Fixture exchange index", state: "withheld", reason: "The licence does not allow redistribution." });
    expect(meta.coverage).toBeNull();
  });

  it("a display-only Series: its page renders with its values, its downloads answer 403 with the reason (M17's second criterion)", () => {
    const gate = createRightsGate(fixtureRegister({ display: true, redistribute: false }));
    const answer = seriesPageView(release, "staging", "fx_price_index", { search: new URLSearchParams(), address: ADDRESS, gate });
    if (answer.kind !== "page") throw new Error(answer.kind);
    expect(answer.view.state).toBe("shown");
    expect(answer.view.latest?.value).toBe("109.9");
    expect(answer.view.downloads).toMatchObject({ permitted: false });
    expect(answer.view.downloads.reason).toContain("does not allow redistribute");
    const html = renderToStaticMarkup(createElement(SeriesPage, { view: answer.view, basePath: "/macro-atlas-staging" }));
    expect(html).toContain("109.9");
    expect(html).toContain("does not allow redistribute");
    expect(html).not.toMatch(/href="[^"]*fx_price_index\.(csv|json|md)"/);
    expect(html).toMatch(/href="[^"]*fx_price_index\.metadata\.json"/);

    for (const format of ["csv", "json", "md"] as const) {
      const refused = twin("fx_price_index", format, "", "staging", gate);
      expect(refused.status, format).toBe(403);
      expect(refused.body).toContain("does not allow redistribute");
      expect(refused.body).not.toMatch(/109\.9|observations/);
      expect(refused.cacheable).toBe(false);
    }
    const meta = twin("fx_price_index", "metadata.json", "", "staging", gate);
    expect(JSON.parse(meta.body)).toMatchObject({ state: "shown", downloads: { permitted: false } });
    // The same gate, allowing both: the files are served, unstamped.
    const open = createRightsGate(fixtureRegister({ display: true, redistribute: true }));
    const served = twin("fx_price_index", "csv", "", "staging", open);
    expect(served).toMatchObject({ status: 200, filename: "macro-atlas_fx_price_index.csv" });
    expect(served.body).not.toMatch(/NOT FOR PUBLICATION/);
  });

  it("on a public surface the committed register permits nothing: every twin of values is 403", () => {
    for (const surface of ["staging", "production"] as const) {
      for (const format of TWIN_FORMATS.filter((f) => f !== "metadata.json")) {
        const answer = twin("fx_price_index", format, "", surface);
        expect(answer.status).toBe(403);
        expect(answer.body).not.toMatch(/109\.9/);
      }
      expect(JSON.parse(twin("fx_price_index", "metadata.json", "", surface).body)).toMatchObject({ state: "not_permitted", coverage: null });
    }
  });

  it("a file larger than the cap is refused", () => {
    const answer = seriesTwin(release, "local", "fx_price_index", "json", new URLSearchParams(), { address: ADDRESS, maxBytes: 500 });
    expect(answer).toMatchObject({ status: 422 });
    expect(answer.body).not.toMatch(/109\.9/);
  });
});
