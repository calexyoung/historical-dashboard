/**
 * Bulk files and discovery over HTTP, against real production builds (PLAN section 7 and M25;
 * ADR 0039): `/downloads`, a bulk file, every page's Markdown twin, `/llms.txt`, a series
 * page's JSON-LD, `/docs/method` and `/docs/rights`. Only the fixture release is served.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "@/lib/release/testing";
import { startVariant, type Running } from "./builds";

const A = "20260201T000000Z-aaaaaaa";
const B = "20260202T000000Z-bbbbbbb";
const CLAIM = "2025-12-11-a-fixture-official-on-fixture-prices";
let caller = 0;
/** Each test asks from addresses of its own, so the rate limits of one do not meet another's. */
const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init, headers: { "x-forwarded-for": `198.51.100.${(caller++ % 200) + 1}`, ...(init.headers ?? {}) } });
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
const PAGES = ["/", "/highlights", "/search?q=price", "/topics", "/topics/inflation", "/claims", `/claims/${CLAIM}`, "/events", "/data", "/data?q=price", "/data/fx_price_index", "/data/fx_price_index?as_of=2025-12-13", "/explore?s=fx_price_index", "/downloads", "/docs/method", "/docs/method/claims", "/docs/method/twins", "/docs/api", "/docs/rights", "/docs/glossary", "/docs/glossary/stale"];
const alternate = (html: string): string | null => /<link rel="alternate" type="text\/markdown" href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? null;

describe("bulk files and discovery on a local build (the fixture release)", () => {
  let atlas: Running;
  let staging: Running;
  beforeAll(async () => {
    atlas = await startVariant("local-atlas", { root: FIXTURE_ROOT });
    staging = await startVariant("local-staging", { root: FIXTURE_ROOT });
  });
  afterAll(() => Promise.all([atlas.stop(), staging.stop()]));

  it("AC: every link in llms.txt resolves, under each base path", async () => {
    for (const server of [atlas, staging]) {
      const response = await get(server.url("/llms.txt"));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const text = await response.text();
      const links = [...text.matchAll(/\]\((http[^)\s]+)\)/g)].map((m) => m[1]!);
      expect(links.length).toBeGreaterThan(40);
      for (const link of links) {
        expect(link.startsWith(`${server.origin}${server.base}/`), link).toBe(true);
        const answer = await get(link);
        expect(answer.status, link).toBe(200);
        await answer.arrayBuffer();
      }
    }
  });

  it("every page names its Markdown twin, and the twin answers with Markdown for the same question", async () => {
    for (const server of [atlas, staging]) {
      for (const path of PAGES) {
        const page = await get(server.url(path));
        expect(page.status, path).toBe(200);
        const href = alternate(await page.text());
        expect(href, path).not.toBeNull();
        const [pathname, query] = path.split("?");
        expect(href).toBe(`${server.base}${pathname === "/" ? "/index" : pathname}.md${query ? `?${query}` : ""}`);
        const twin = await get(`${server.origin}${href}`);
        expect(twin.status, href!).toBe(200);
        expect(twin.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
        expect(twin.headers.get("cache-control")).toBe("no-store");
        const body = await twin.text();
        expect(body).toMatch(/^# \S/);
        expect(body).toContain(FIXTURE_ID);
      }
    }
  });

  it("a page with no twin names none; the handler's own path is not an address", async () => {
    expect(alternate(await (await get(atlas.url("/no/such/page"))).text())).toBeNull();
    for (const path of ["/page-twin/highlights", "/page-twin/index", "/nothing.md", "/topics/no-such-topic.md"]) {
      expect((await get(atlas.url(path))).status, path).toBe(404);
    }
  });

  it("AC: a bulk file is served as the bytes the datapackage hashed, as a file, and the three formats hold the same rows", async () => {
    for (const server of [atlas, staging]) {
      const pack = (await (await get(server.url(`/downloads/${FIXTURE_ID}/datapackage.json`))).json()) as { release_id: string; resources: { path: string; bytes: number; hash: string; rows: number }[] };
      expect(pack.release_id).toBe(FIXTURE_ID);
      expect(pack.resources.length).toBeGreaterThanOrEqual(4);
      for (const resource of pack.resources) {
        const response = await get(server.url(`/downloads/${FIXTURE_ID}/${resource.path}`));
        expect(response.status, resource.path).toBe(200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(bytes.length).toBe(resource.bytes);
        expect(`sha256:${sha256(bytes)}`, resource.path).toBe(resource.hash);
        expect(response.headers.get("etag")).toBe(`"${resource.hash.slice(7)}"`);
        expect(response.headers.get("content-disposition")).toBe(`attachment; filename="macro-atlas_${FIXTURE_ID}_${resource.path}"`);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex");
      }
      const csv = gunzipSync(new Uint8Array(await (await get(server.url(`/downloads/${FIXTURE_ID}/observations.csv.gz`))).arrayBuffer())).toString("utf8").trimEnd().split("\n");
      const ndjson = gunzipSync(new Uint8Array(await (await get(server.url(`/downloads/${FIXTURE_ID}/observations.ndjson.gz`))).arrayBuffer())).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      const rows = pack.resources.find((r) => r.path === "observations.parquet")!.rows;
      expect(csv.length - 1).toBe(rows);
      expect(ndjson.length).toBe(rows);
      expect(csv[0]).toBe("key,period,period_start,period_end,value,status,frequency,kind,unit,licence,ml_use");
      expect(csv.slice(1).map((line) => line.split(",").slice(0, 2).join(" "))).toEqual(ndjson.map((row) => `${String(row.key)} ${String(row.period)}`));
      expect(ndjson.some((row) => row.key === "fx_exchange_index")).toBe(false); // Withheld
      const parquet = new Uint8Array(await (await get(server.url(`/downloads/${FIXTURE_ID}/observations.parquet`))).arrayBuffer());
      expect(Buffer.from(parquet.slice(0, 4)).toString("latin1")).toBe("PAR1");
    }
  });

  it("latest leads to the current Release's file, and a validator that matches is answered without the bytes", async () => {
    const latest = await get(atlas.url("/downloads/latest/observations.parquet"));
    expect(latest.status).toBe(302);
    expect(latest.headers.get("location")).toBe(`${atlas.base}/downloads/${FIXTURE_ID}/observations.parquet`);
    expect(latest.headers.get("cache-control")).toBe("no-store");
    const page = await get(atlas.url("/downloads/latest"));
    expect([302, 307]).toContain(page.status);
    expect(page.headers.get("location")).toBe(`${atlas.base}/downloads`);
    const first = await get(atlas.url(`/downloads/${FIXTURE_ID}/observations.csv.gz`));
    const again = await get(atlas.url(`/downloads/${FIXTURE_ID}/observations.csv.gz`), { headers: { "if-none-match": first.headers.get("etag")! } });
    expect(again.status).toBe(304);
    const head = await get(atlas.url(`/downloads/${FIXTURE_ID}/observations.csv.gz`), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("refuses a name that is not a bulk file of the Release, and an address that names no release", async () => {
    for (const name of ["observations.xlsx", "manifest.json", "..%2Fmanifest.json", "datapackage.json.bak"]) {
      expect((await get(atlas.url(`/downloads/${FIXTURE_ID}/${name}`))).status, name).toBe(404);
      expect((await get(atlas.url(`/downloads/latest/${name}`))).status, name).toBe(404);
    }
    expect((await get(atlas.url("/downloads/current/observations.parquet"))).status).toBe(400);
    expect((await get(atlas.url("/downloads/20200101T000000Z-0000000/observations.parquet"))).status).toBe(410);
  });

  it("the page lists every file with its hash, in its HTML, and the Release's own page is the same list", async () => {
    for (const path of ["/downloads", `/downloads/${FIXTURE_ID}`]) {
      const html = await (await get(atlas.url(path))).text();
      const pack = JSON.parse(readFileSync(join(FIXTURE_ROOT, "releases", FIXTURE_ID, "downloads", "datapackage.json"), "utf8")) as { resources: { path: string; hash: string }[] };
      for (const resource of pack.resources) {
        expect(html, resource.path).toContain(`href="${atlas.base}/downloads/${FIXTURE_ID}/${resource.path}"`);
        expect(html).toContain(resource.hash.slice(7));
      }
      expect(html).toContain("Fixture exchange index"); // Withheld: named, in no file
      expect(html.match(/<h1/g)).toHaveLength(1);
    }
  });

  it("a series page carries a schema.org Dataset with no value in it, and the script holds nothing else", async () => {
    const html = await (await get(atlas.url("/data/fx_price_index"))).text();
    const found = /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s.exec(html);
    expect(found).not.toBeNull();
    const doc = JSON.parse(found![1]!) as Record<string, unknown>;
    expect(doc).toMatchObject({ "@type": "Dataset", identifier: "fx_price_index", url: `${atlas.origin}${atlas.base}/data/fx_price_index`, version: FIXTURE_ID });
    expect(found![1]).not.toContain("109.9");
    const withheld = await (await get(atlas.url("/data/fx_exchange_index"))).text();
    const other = JSON.parse(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s.exec(withheld)![1]!) as { distribution: unknown[]; temporalCoverage?: string };
    expect(other.distribution).toHaveLength(1);
    expect(other.temporalCoverage).toBeUndefined();
  });

  it("the method pages and the rights page are complete in their HTML", async () => {
    const index = await (await get(atlas.url("/docs/method"))).text();
    expect(index).toContain(`href="${atlas.base}/docs/method/claims"`);
    expect(index).toContain(`href="${atlas.base}/docs/method/bulk-files"`);
    const doc = await (await get(atlas.url("/docs/method/twins"))).text();
    expect(doc).toContain("Query, series pages and their twins");
    expect(doc).toContain(`href="${atlas.base}/docs/method/vintage-resolution"`);
    expect(doc.match(/<h1/g)).toHaveLength(1);
    expect((await get(atlas.url("/docs/method/no-such-page"))).status).toBe(404);
    const rights = await (await get(atlas.url("/docs/rights"))).text();
    expect(rights).toContain("Bureau of Labor Statistics");
    expect(rights).toContain("Not decided");
    expect(rights).toMatch(/Signed <!-- -->12 November 2026|Signed 12 November 2026/);
  });
});

describe("a Release named by its id, kept and then pruned (PLAN 4.3 retention)", () => {
  let server: Running;
  const root = tempRoot();
  beforeAll(async () => {
    addRelease(root, { id: A, bulk: true });
    addRelease(root, { id: B });
    promote(root, B);
    server = await startVariant("local-atlas", { root });
  });
  afterAll(() => server.stop());

  it("serves an earlier Release's file while retention keeps it, and never the current Release's in its place", async () => {
    const kept = await get(server.url(`/downloads/${A}/observations.csv.gz`));
    expect(kept.status).toBe(200);
    expect(kept.headers.get("content-disposition")).toContain(A);
    await kept.arrayBuffer();
    // The current Release has no bulk files: its own address says so, and latest has nothing to lead to.
    expect((await get(server.url(`/downloads/${B}/observations.csv.gz`))).status).toBe(404);
    expect((await get(server.url("/downloads/latest/observations.csv.gz"))).status).toBe(404);
    const page = await (await get(server.url("/downloads"))).text();
    expect(page).toContain("data-no-bulk");
    expect(page).not.toContain("observations.csv.gz\"");
    const earlier = await (await get(server.url(`/downloads/${A}`))).text();
    expect(earlier).toContain(`href="${server.base}/downloads/${A}/observations.csv.gz"`);
  });

  it("answers 410 once the Release is pruned, with where the current files are and no byte of the file", async () => {
    mkdirSync(join(root, "trash"), { recursive: true });
    renameSync(join(root, "releases", A), join(root, "trash", A));
    const gone = await get(server.url(`/downloads/${A}/observations.csv.gz`));
    expect(gone.status).toBe(410);
    expect(await gone.text()).toContain(`${server.base}/downloads`);
    expect((await get(server.url(`/downloads/${A}`))).status).toBe(410);
  });
});

describe("bulk files and twins on the production surface (PLAN 6.1): nothing leaves that the committed register does not sign", () => {
  let server: Running;
  const root = tempRoot();
  beforeAll(async () => {
    addRelease(root, { id: A, bulk: true });
    promote(root, A);
    server = await startVariant("production", { root });
  });
  afterAll(() => server.stop());

  it("refuses every bulk data file with 403, the reason and no byte of it; the datapackage, which holds no value, is given", async () => {
    const pack = await get(server.url(`/downloads/${A}/datapackage.json`));
    expect(pack.status).toBe(200);
    const { resources } = (await pack.json()) as { resources: { path: string }[] };
    for (const resource of resources) {
      const response = await get(server.url(`/downloads/${A}/${resource.path}`));
      expect(response.status, resource.path).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain("not signed");
      expect(body.length).toBeLessThan(600);
    }
    const page = await (await get(server.url("/downloads"))).text();
    expect(page).not.toContain(`/downloads/${A}/observations.parquet`);
    expect(page).toContain("not signed");
  });

  it("every page's twin answers, and not one holds a value of a fixture Series", async () => {
    const values = (JSON.parse(readFileSync(join(FIXTURE_ROOT, "releases", FIXTURE_ID, "series", "fx_price_index.json"), "utf8")) as { observations: { value: number | null }[] }).observations.flatMap((o) => (o.value !== null && !Number.isInteger(o.value) ? [String(o.value)] : []));
    for (const path of ["/index.md", "/highlights.md", "/topics/inflation.md", "/data.md", "/topics.md", "/search.md?q=price", "/docs/rights.md", "/downloads.md"]) {
      const response = await get(server.url(path));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=300");
      const body = await response.text();
      expect(body).not.toMatch(/not for publication/i);
      for (const value of values) expect(body, `${path} ${value}`).not.toContain(value);
    }
    expect((await get(server.url("/explore.md?s=fx_price_index"))).status).toBe(403);
  });

  it("AC: every link in llms.txt resolves here too: a Series that is not handed out is listed by its metadata", async () => {
    const text = await (await get(server.url("/llms.txt"))).text();
    expect(text).not.toMatch(/\/data\/[a-z_]+\.md\)/);
    const links = [...text.matchAll(/\]\((http[^)\s]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(40);
    for (const link of links) {
      const answer = await get(link);
      expect(answer.status, link).toBe(200);
      await answer.arrayBuffer();
    }
  });
});
