/**
 * The Markdown twin of every page (PLAN section 3 and M25; ADR 0039): made from the page's own
 * view, and a file that leaves the site, so every value in it is asked for `redistribute`.
 */
import { createRightsGate } from "@macro-atlas/core";
import { beforeAll, describe, expect, it } from "vitest";
import { highlightsView } from "../highlights";
import { methodIndex } from "../method-docs";
import { METHOD_DOCS } from "../method-docs.generated";
import { createReleaseReader, type OpenedRelease } from "../release/reader";
import { addRelease, FIXTURE_ROOT, fixtureRegister, promote, tempRoot } from "../release/testing";
import { markdownTwinOf, pageTwinOf } from "./address";
import { fileGate, PAGE_TWINS, pageTwin } from "./pages";

const ADDRESS = "https://example.org/macro-atlas";
const none = new URLSearchParams();
let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});
const all = createRightsGate(fixtureRegister({ display: true, redistribute: true }));
const displayOnly = createRightsGate(fixtureRegister({ display: true, redistribute: false }));
const twin = (page: string, search = none, surface: "local" | "production" = "local", gate?: ReturnType<typeof createRightsGate>) => pageTwin(release, surface, page, search, { address: ADDRESS, gate });

const EVERY_PAGE = ["/", "/highlights", "/topics", "/topics/inflation", "/topics/jobs", "/claims", "/events", "/data", "/explore", "/search", "/downloads", "/docs/method", "/docs/method/claims", "/docs/method/twins", "/docs/api", "/docs/rights", "/docs/glossary", "/docs/glossary/stale"];

describe("the address of a page's Markdown twin", () => {
  it("is the page's address with .md, and /index.md for the Overview; each has its page", () => {
    for (const page of EVERY_PAGE) {
      const address = markdownTwinOf(page);
      expect(address, page).toBe(page === "/" ? "/index.md" : `${page}.md`);
      expect(pageTwinOf(address!)).toBe(page);
    }
    expect(markdownTwinOf("/data/fx_price_index")).toBe("/data/fx_price_index.md");
    expect(markdownTwinOf("/claims/2025-12-11-a-fixture-official-on-fixture-prices")).toBe("/claims/2025-12-11-a-fixture-official-on-fixture-prices.md");
    expect(markdownTwinOf("/explore/")).toBe("/explore.md");
    for (const page of ["/api/health", "/explore/export", "/search/hits", "/no/such/page", "/downloads/latest"]) expect(markdownTwinOf(page), page).toBeNull();
  });
});

describe("pageTwin", () => {
  it.each(EVERY_PAGE)("%s has a twin: Markdown, with a title, the page's address and the Release", (page) => {
    const made = twin(page);
    expect(made.status).toBe(200);
    expect(made.contentType).toBe("text/markdown; charset=utf-8");
    expect(made.body).toMatch(/^# \S/);
    expect(made.body).toContain(`- Page: ${ADDRESS}${page}`);
    expect(made.body).toContain(`- Release: ${release.id}`);
    expect(made.body).toContain(`${ADDRESS}/llms.txt`);
    expect(made.body).not.toMatch(/<[a-z][^>]*>/i); // no HTML
    expect(made.body).not.toContain("undefined");
    expect(made.cacheable).toBe(false);
  });

  it("the index of pages names a twin for every page that has one", () => {
    for (const row of PAGE_TWINS) {
      expect(pageTwinOf(row.twin)).toBe(row.page);
      expect(twin(row.page).status).toBe(200);
    }
  });

  it("answers 404 for a page that is not there, in a line of text", () => {
    for (const page of ["/topics/no-such-topic", "/events/2020-01-no-such-event", "/docs/method/no-such-page", "/docs/glossary/no-such-term", "/api/health"]) {
      const made = twin(page);
      expect(made.status, page).toBe(404);
      expect(made.contentType).toMatch(/^text\/plain/);
    }
  });

  it("Highlights says what the page says: every headline Series, its latest value and its changes", () => {
    const view = highlightsView(release, "local");
    const body = twin("/highlights").body;
    const shown = view.segments.flatMap((s) => s.rows).filter((row) => row.state === "shown");
    expect(shown.length).toBeGreaterThan(2);
    for (const row of shown) {
      expect(body).toContain(`${ADDRESS}/data/${row.key})`);
      if (row.latest) expect(body).toContain(row.latest.value);
      for (const cell of row.cells ?? []) if (cell.figure) expect(body).toContain(cell.figure.words.replace(/([*_#|~[\]\\`])/g, "\\$1"));
    }
  });

  it("stamps a twin that holds values on the local Surface, in the text and in the file's name; a page of words is not stamped", () => {
    for (const page of ["/", "/highlights", "/topics/inflation", "/data"]) {
      const made = twin(page);
      expect(made.body, page).toContain("NOT FOR PUBLICATION");
      expect(made.filename).toContain("_not-for-publication.md");
    }
    for (const page of ["/docs/rights", "/docs/method", "/events", "/docs/glossary"]) {
      expect(twin(page).body, page).not.toContain("NOT FOR PUBLICATION");
      expect(twin(page).filename).not.toContain("not-for-publication");
    }
    expect(twin("/highlights", none, "production", all).body).not.toContain("NOT FOR PUBLICATION");
  });

  it("may be kept by a cache only on production", () => {
    expect(twin("/highlights", none, "production", all).cacheable).toBe(true);
    expect(twin("/highlights", none, "staging" as "production", all).cacheable).toBe(false);
  });

  it("holds no value of a Series that may be shown and not handed out: it is named, with the reason", () => {
    // What the page shows under this register, on production: every value. What the file may hold: none.
    const page = highlightsView(release, "production", { gate: displayOnly });
    const shown = page.segments.flatMap((s) => s.rows).flatMap((row) => (row.state === "shown" && row.latest ? [row] : []));
    expect(shown.length).toBeGreaterThan(2);
    for (const path of ["/", "/highlights", "/topics/inflation", "/data"]) {
      const made = twin(path, none, "production", displayOnly);
      expect(made.status, path).toBe(200);
      expect(made.body, path).toContain("does not allow redistribute");
      expect(made.body).not.toContain("NOT FOR PUBLICATION");
      for (const row of shown) {
        expect(made.body, `${path} ${row.key}`).not.toContain(row.latest!.words.replace(/([*_#|~[\]\\`])/g, "\\$1"));
      }
      // Every observation of the main fixture Series, as a file would write it.
      for (const o of release.series.fx_price_index!.observations) if (o.value !== null && !Number.isInteger(o.value)) expect(made.body, `${path} ${o.period}`).not.toContain(String(o.value));
    }
    const explore = twin("/explore", new URLSearchParams("s=fx_price_index"), "production", displayOnly);
    expect(explore.status).toBe(403);
    expect(explore.body).not.toContain("109.9");
  });

  it("holds nothing of any Series on a public Surface under the committed register, which signs no fixture row", () => {
    for (const path of ["/", "/highlights", "/topics/inflation", "/data"]) {
      const made = twin(path, none, "production");
      expect(made.status).toBe(200);
      for (const o of release.series.fx_price_index!.observations) if (o.value !== null && !Number.isInteger(o.value)) expect(made.body, `${path} ${o.period}`).not.toContain(String(o.value));
    }
    expect(twin("/explore", new URLSearchParams("s=fx_price_index"), "production").status).toBe(403);
  });

  it("names a Withheld Series with its reason and no value, as its page does", () => {
    const body = twin("/data").body;
    expect(body).toContain("`fx_exchange_index`");
    expect(body).toContain("Withheld: The licence does not allow redistribution.");
  });

  it("the Explorer's twin is the view as a table, the same rows its export gives", () => {
    const made = twin("/explore", new URLSearchParams("s=fx_price_index&from=2025-01&to=2025-12"));
    expect(made.status).toBe(200);
    expect(made.body).toContain("| series | name | run | period |");
    expect(made.body.split("\n").filter((line) => line.startsWith("| fx\\_price\\_index |")).length).toBe(12);
  });

  it("takes the page's own question: a search, a filter", () => {
    expect(twin("/search", new URLSearchParams("q=price")).body).toContain("Fixture price index");
    expect(twin("/search").body).toContain("?q=");
    const narrowed = twin("/data", new URLSearchParams("q=poverty")).body;
    expect(narrowed).toContain("`fx_poverty_rate_annual`");
    expect(narrowed).not.toContain("`fx_vote_margin`");
  });

  it("a method page's twin is the document itself", () => {
    for (const doc of METHOD_DOCS) {
      const made = twin(`/docs/method/${doc.slug}`);
      expect(made.status, doc.slug).toBe(200);
      expect(made.body.startsWith(doc.text.trimEnd().split("\n")[0]!)).toBe(true);
      expect(made.body).toContain(doc.text.replace(/^# .*\n/, "").trim());
    }
    expect(methodIndex().map((e) => e.slug)).toEqual(expect.arrayContaining(["claims", "claim-records", "twins", "bulk-files"]));
    expect(methodIndex()[0]!.slug).toBe("claims");
  });

  it("the rights page says which rows are signed and what an unsigned row means", () => {
    const body = twin("/docs/rights").body;
    expect(body).toContain("### Bureau of Labor Statistics");
    expect(body).toMatch(/Decision: All four, signed 12 November 2026/);
    expect(body).toContain("Decision: Not decided");
    expect(body).toContain("https://www.bls.gov/bls/linksite.htm");
    expect(body).not.toMatch(/Alex/);
  });

  it("the bulk files' twin lists each file with its hash, and what is in none", () => {
    const body = twin("/downloads").body;
    expect(body).toContain(`${ADDRESS}/downloads/${release.id}/observations.parquet`);
    expect(body).toContain(`${ADDRESS}/downloads/${release.id}/datapackage.json`);
    expect(body).toMatch(/`[0-9a-f]{64}`/);
    expect(body).toContain("## Withheld");
    expect(body).toContain("Fixture exchange index");
  });

  it("says so where a Release has no bulk files", async () => {
    const root = tempRoot();
    addRelease(root, { id: "20260201T000000Z-aaaaaaa", profile: "local", signed: false });
    promote(root, "20260201T000000Z-aaaaaaa");
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    const made = pageTwin(opened.release, "local", "/downloads", none, { address: ADDRESS });
    expect(made.body).toContain("Bulk files are written only for a public-profile release.");
    expect(made.body).not.toContain("observations.parquet");
  });
});

describe("fileGate", () => {
  it("asks for redistribute whatever was asked, and never allows what the gate it wraps refuses", () => {
    const row = { origin: "Macro Atlas fixture (synthetic)", dataset: "fixture", channel: "fixture", representation: "native" as const };
    expect(displayOnly.permits([{ ...row, permission: "display" }], "production").allowed).toBe(true);
    expect(fileGate(displayOnly).permits([{ ...row, permission: "display" }], "production").allowed).toBe(false);
    expect(fileGate(all).permits([{ ...row, permission: "display" }], "production").allowed).toBe(true);
    expect(fileGate().permits([{ ...row, permission: "display" }], "production").allowed).toBe(false); // the committed register signs no fixture row
    expect(fileGate(all).permits([{ ...row, representation: "legacy_monthly_rounded", permission: "display" }], "production").allowed).toBe(false);
  });
});
