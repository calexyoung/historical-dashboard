/**
 * Discovery and the bulk files as the site offers them (PLAN section 7 and M25; ADR 0039):
 * `/downloads`, `/llms.txt`, a series page's JSON-LD, `/docs/method` and `/docs/rights`.
 */
import { createRightsGate } from "@macro-atlas/core";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { DownloadsPage } from "@/components/DownloadsPage";
import { Markdown } from "@/components/Markdown";
import { downloadDecision, downloadsView, downloadType } from "./downloads";
import { datasetJsonLd, jsonLdText } from "./json-ld";
import { llmsText } from "./llms";
import { parseMarkdown } from "./markdown";
import { methodBlocks, methodDoc, methodIndex, methodLinks } from "./method-docs";
import { METHOD_DOCS } from "./method-docs.generated";
import { createReleaseReader, type OpenedRelease } from "./release/reader";
import { addRelease, FIXTURE_ROOT, fixtureRegister, promote, tempRoot } from "./release/testing";
import { rightsPageView } from "./rights-page";
import { RIGHTS_ROWS } from "./rights-rows.generated";
import { pageTwinOf } from "./twin/address";
import { claimTwinOf, twinOf } from "./twin/address";

const ADDRESS = "https://example.org/macro-atlas";
let release: OpenedRelease;
beforeAll(async () => {
  const opened = await createReleaseReader({ root: FIXTURE_ROOT, surface: "local" }).current();
  if (!opened.ok) throw new Error(opened.reason);
  release = opened.release;
});
const all = createRightsGate(fixtureRegister({ display: true, redistribute: true }));
const displayOnly = createRightsGate(fixtureRegister({ display: true, redistribute: false }));

describe("a bulk file is handed out only if the gate allows it today", () => {
  it("gives every file on the local Surface, and the datapackage anywhere", () => {
    for (const resource of release.downloads!.resources) expect(downloadDecision(release, "local", resource.path)).toMatchObject({ ok: true });
    expect(downloadDecision(release, "production", "datapackage.json")).toEqual({ ok: true, resource: null });
  });

  it("gives a file on production under a register that allows redistribution of everything in it", () => {
    expect(downloadDecision(release, "production", "observations.parquet", { gate: all })).toMatchObject({ ok: true });
    expect(downloadDecision(release, "production", "vintages.parquet", { gate: all })).toMatchObject({ ok: true });
  });

  it("refuses every data file with 403 and the reason when redistribution is no longer allowed: what was allowed when the Release was written does not carry over", () => {
    for (const resource of release.downloads!.resources) {
      const decided = downloadDecision(release, "production", resource.path, { gate: displayOnly });
      expect(decided, resource.path).toMatchObject({ ok: false, status: 403 });
      if (!decided.ok) expect(decided.message).toContain("does not allow redistribute");
    }
  });

  it("refuses every data file on a public Surface under the committed register, which signs no fixture row", () => {
    for (const surface of ["staging", "production"] as const) {
      expect(downloadDecision(release, surface, "observations.csv.gz")).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("knows no file by any other name, and none in a Release without bulk files", async () => {
    for (const name of ["observations.xlsx", "../manifest.json", "", "manifest.json"]) expect(downloadDecision(release, "local", name)).toMatchObject({ ok: false, status: 404 });
    const root = tempRoot();
    addRelease(root, { id: "20260201T000000Z-aaaaaaa" });
    promote(root, "20260201T000000Z-aaaaaaa");
    const opened = await createReleaseReader({ root, surface: "local" }).current();
    if (!opened.ok) throw new Error(opened.reason);
    expect(downloadDecision(opened.release, "local", "observations.parquet")).toMatchObject({ ok: false, status: 404 });
    expect(downloadDecision(opened.release, "local", "datapackage.json")).toMatchObject({ ok: false, status: 404 });
    expect(downloadsView(opened.release, "local").none).toContain("no bulk files");
  });

  it("sends each format as what it is", () => {
    expect(downloadType("observations.parquet")).toBe("application/vnd.apache.parquet");
    expect(downloadType("observations.csv.gz")).toBe("application/gzip");
    expect(downloadType("datapackage.json")).toMatch(/^application\/json/);
  });
});

describe("/downloads", () => {
  it("lists the whole tables, then the same rows by licence, with what is in no file", () => {
    const view = downloadsView(release, "local");
    expect(view.whole.map((f) => f.name)).toEqual(["observations.parquet", "observations.csv.gz", "observations.ndjson.gz", "vintages.parquet"]);
    expect(view.byLicence.map((g) => g.label)).toEqual(["Public domain", "Citation required"]);
    expect(view.counts).toEqual({ series: 10, observations: 145, withHistory: 3, versions: 68 });
    expect(view.withheld.map((s) => s.key)).toEqual(["fx_exchange_index"]);
    const html = renderToStaticMarkup(<DownloadsPage view={view} basePath="/macro-atlas" address={ADDRESS} current />);
    expect(html).toContain(`href="/macro-atlas/downloads/${release.id}/observations.parquet"`);
    expect(html).toContain(`href="/macro-atlas/downloads/${release.id}/datapackage.json"`);
    expect(html).toContain(`${ADDRESS}/downloads/latest/observations.parquet`);
    expect(html).toContain("Fixture exchange index");
    expect(html.match(/<h1/g)).toHaveLength(1);
    // No value of any Series is on the page.
    for (const o of release.series.fx_price_index!.observations) if (o.value !== null && !Number.isInteger(o.value)) expect(html).not.toContain(`>${o.value}<`);
  });

  it("a file the gate refuses today is listed without a link, with the reason", () => {
    const view = downloadsView(release, "production", { gate: displayOnly });
    expect(view.whole.every((f) => f.refused !== null)).toBe(true);
    const html = renderToStaticMarkup(<DownloadsPage view={view} basePath="/macro-atlas" address={ADDRESS} current />);
    expect(html).not.toContain(`/downloads/${release.id}/observations.parquet`);
    expect(html).not.toContain("read_parquet");
    expect(html).toContain("does not allow redistribute");
    expect(html).toContain("datapackage.json");
  });
});

describe("/llms.txt", () => {
  it("links every page's twin, every Series, Topic, Claim, Event and method page, and holds no value", () => {
    const text = llmsText(release, "local", { address: ADDRESS });
    expect(text.startsWith("# Macro Atlas\n\n> ")).toBe(true);
    for (const path of ["/index.md", "/highlights.md", "/docs/rights.md", "/topics/inflation.md", "/data/fx_price_index.md", "/claims/2025-12-11-a-fixture-official-on-fixture-prices.md", "/docs/method/twins.md", "/api/v1/catalog.json", `/downloads/${release.id}/datapackage.json`]) {
      expect(text, path).toContain(`(${ADDRESS}${path})`);
    }
    for (const event of release.events.events) expect(text).toContain(`(${ADDRESS}/events/${event.id}.md)`);
    for (const o of release.series.fx_price_index!.observations) if (o.value !== null && !Number.isInteger(o.value)) expect(text).not.toContain(String(o.value));
  });

  it("every link is an address the site answers: a page's twin, a Series' or a Claim's, the API or a bulk file", () => {
    const text = llmsText(release, "local", { address: ADDRESS });
    const links = [...text.matchAll(/\]\((https:[^)\s]+)\)/g)].map((m) => m[1]!.slice(ADDRESS.length));
    expect(links.length).toBeGreaterThan(40);
    for (const path of links) {
      const known = pageTwinOf(path) !== null || twinOf(path) !== null || claimTwinOf(path) !== null || path.startsWith("/api/v1") || path.startsWith(`/downloads/${release.id}/`);
      expect(known, path).toBe(true);
    }
  });

  it("lists a Series whose values are not handed out by its metadata, never by a file that would answer 403", () => {
    const text = llmsText(release, "production", { address: ADDRESS, gate: displayOnly });
    expect(text).not.toMatch(/\/data\/[a-z_]+\.md\)/);
    expect(text).toContain(`(${ADDRESS}/data/fx_price_index.metadata.json)`);
    expect(text).toContain("Its values are not handed out here");
    expect(text).not.toContain("/claims/2025-12-11-a-fixture-official-on-fixture-prices.md");
    const open = llmsText(release, "local", { address: ADDRESS });
    expect(open).toContain(`(${ADDRESS}/data/fx_exchange_index.metadata.json)`); // Withheld, on any Surface
    expect(open).toContain("Withheld; this is its metadata.");
  });
});

describe("a series page's JSON-LD", () => {
  it("is a schema.org Dataset from the Catalog entry, with no value in it", () => {
    const doc = datasetJsonLd(release, "local", "fx_price_index", { address: ADDRESS })!;
    expect(doc).toMatchObject({ "@context": "https://schema.org", "@type": "Dataset", name: "Fixture price index", identifier: "fx_price_index", url: `${ADDRESS}/data/fx_price_index`, temporalCoverage: "2024-01-01/2025-12-31", repeatFrequency: "P1M", version: release.id });
    expect((doc.distribution as { contentUrl: string }[]).map((d) => d.contentUrl)).toEqual([".csv", ".json", ".md", ".metadata.json"].map((s) => `${ADDRESS}/data/fx_price_index${s}`));
    const text = jsonLdText(doc);
    for (const o of release.series.fx_price_index!.observations) if (o.value !== null && !Number.isInteger(o.value)) expect(text).not.toContain(String(o.value));
  });

  it("lists only the metadata, and no coverage, for a Series that may not be shown or handed out", () => {
    const withheld = datasetJsonLd(release, "local", "fx_exchange_index", { address: ADDRESS })!;
    expect(withheld.temporalCoverage).toBeUndefined();
    expect((withheld.distribution as unknown[]).length).toBe(1);
    const refused = datasetJsonLd(release, "production", "fx_price_index", { address: ADDRESS })!;
    expect(refused.temporalCoverage).toBeUndefined();
    expect((refused.distribution as { contentUrl: string }[]).map((d) => d.contentUrl)).toEqual([`${ADDRESS}/data/fx_price_index.metadata.json`]);
    const shownOnly = datasetJsonLd(release, "production", "fx_price_index", { address: ADDRESS, gate: displayOnly })!;
    expect(shownOnly.temporalCoverage).toBe("2024-01-01/2025-12-31");
    expect((shownOnly.distribution as unknown[]).length).toBe(1);
    expect(datasetJsonLd(release, "local", "nope", { address: ADDRESS })).toBeNull();
  });

  it("cannot close the script element it is written into", () => {
    expect(jsonLdText({ name: "</script><script>alert(1)</script>&" })).toBe('{"name":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e\\u0026"}');
  });
});

describe("/docs/method", () => {
  it("lists the reader's page first, then every method document of the repository", () => {
    const index = methodIndex();
    expect(index[0]).toMatchObject({ slug: "claims", kind: "reader", title: "How a claim record is built" });
    expect(index.filter((e) => e.kind === "contract").length).toBe(METHOD_DOCS.length - 1);
    for (const entry of index) expect(entry.summary.length, entry.slug).toBeGreaterThan(20);
    expect(methodDoc("claims")!.file).toBe("site/content/method-claims.md");
    expect(methodDoc("claim-records")!.file).toBe("docs/method/claims.md");
    expect(methodDoc("../x")).toBeNull();
  });

  it("draws a document as elements: headings, tables, code, and no markup of the document's own", () => {
    const html = renderToStaticMarkup(<Markdown blocks={methodBlocks(methodDoc("twins")!, "/macro-atlas")} skipTitle />);
    expect(html).not.toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
    const evil = renderToStaticMarkup(<Markdown blocks={parseMarkdown("# T\n\n<img src=x onerror=alert(1)> [x](javascript:alert) <script>alert(1)</script>")} />);
    expect(evil).not.toContain("<img");
    expect(evil).not.toContain("<script");
    expect(evil).not.toContain("href");
  });

  it("links one method document to another on the site, and leaves a link to any other file as words", () => {
    const resolve = methodLinks("/macro-atlas");
    expect(resolve("transforms.md")).toEqual({ href: "/macro-atlas/docs/method/transforms", external: false });
    expect(resolve("docs/method/claims.md")).toEqual({ href: "/macro-atlas/docs/method/claim-records", external: false });
    expect(resolve("/docs/glossary/basis")).toEqual({ href: "/macro-atlas/docs/glossary/basis", external: false });
    expect(resolve("https://example.org/a")).toEqual({ href: "https://example.org/a", external: true });
    for (const href of ["../adr/0031.md", "//evil.example/x", "javascript:alert(1)", "http://example.org", "CONTEXT.md"]) expect(resolve(href), href).toBeNull();
  });
});

describe("/docs/rights", () => {
  it("states every row of the register: signed or not decided, and what follows", () => {
    const view = rightsPageView();
    expect(view.total).toBe(RIGHTS_ROWS.rows.length);
    expect(view.signed).toBe(RIGHTS_ROWS.rows.filter((row) => row.decision !== null).length);
    const bls = view.origins.find((row) => row.id === "bls")!;
    expect(bls).toMatchObject({ name: "Bureau of Labor Statistics", licence: "Public domain", decided: "All four", effect: "Its values may be shown and handed out as files." });
    // Whichever Origin is still undecided: the rows Alex has signed change, the wording does not.
    const open = RIGHTS_ROWS.rows.find((row) => row.kind === "origin" && row.decision === null)!;
    const undecided = view.origins.find((row) => row.id === open.id)!;
    expect(undecided).toMatchObject({ decided: "Not decided", signed: null });
    expect(undecided.effect).toContain("nothing from it is shown");
    expect(view.channels.map((row) => row.id)).toEqual(["fred", "alfred", "yahoo"]);
    expect(view.channels.every((row) => row.signed === null)).toBe(true);
  });

  it("carries no note, quotation or name from the register: only what the page lists", () => {
    const text = JSON.stringify(RIGHTS_ROWS);
    expect(text).not.toMatch(/Alex|signed_by|quotes|open_questions|note/);
  });
});
