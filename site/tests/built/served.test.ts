/**
 * M1's acceptance criteria, checked against real production builds over HTTP.
 * (PLAN section 10, M1; section 6.1.)
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "@/lib/release/testing";
import { startVariant, type Running } from "./builds";

const A = "20260201T000000Z-aaaaaaa";
const B = "20260202T000000Z-bbbbbbb";
const LOCAL = "20260203T000000Z-ccccccc";
const CLAIM = "2025-12-11-a-fixture-official-on-fixture-prices";
const RELEASE_IDS = /[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}/g;

const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });
/** GET with a Host header of our choosing, as a reverse proxy would send it (fetch will not). */
const getAs = (url: string, host: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> =>
  new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
const idsOn = (html: string): string[] => [...new Set(html.match(RELEASE_IDS) ?? [])];

describe("the fixture release is served at both base paths", () => {
  const servers: Running[] = [];
  beforeAll(async () => {
    servers.push(await startVariant("local-atlas", { root: FIXTURE_ROOT }));
    servers.push(await startVariant("local-staging", { root: FIXTURE_ROOT }));
  });
  afterAll(() => Promise.all(servers.map((s) => s.stop())));

  it.each([
    [0, "/macro-atlas"],
    [1, "/macro-atlas-staging"],
  ] as const)("build %i serves /explore under %s, rendered on the server", async (index, base) => {
    const server = servers[index]!;
    expect(server.base).toBe(base);
    const response = await get(server.url("/explore"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(idsOn(html)).toEqual([FIXTURE_ID]);
    expect(html).toContain("Fixture price index"); // in the HTML itself: no JavaScript needed
    expect(html).toContain(`href="${base}/explore"`);
    expect(html).toContain(`action="${base}/api/theme"`);
  });

  it("the front door is the Overview: it no longer redirects to the Explorer (M22)", async () => {
    for (const server of servers) {
      const response = await get(server.url("/"));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toMatch(/<h1[^>]*>Overview<\/h1>/);
    }
  });

  it("each build serves only its own base path", async () => {
    expect((await get(`${servers[0]!.origin}/macro-atlas-staging/explore`)).status).toBe(404);
    expect((await get(`${servers[1]!.origin}/macro-atlas/explore`)).status).toBe(404);
  });

  it("shows only tabs whose pages exist, and marks the current one", async () => {
    const html = await (await get(servers[0]!.url("/explore"))).text();
    const nav = html.slice(html.indexOf('<nav aria-label="Sections"'), html.indexOf("</nav>", html.indexOf('<nav aria-label="Sections"')));
    expect([...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(["Claims", "Explore", "Events", "Data"]); // the fixture holds a Claim (M21)
    expect(nav).toContain('aria-current="page"');
  });

  it("serves the Events of the Release: the index, one Event, and 404 for one it does not hold (M19)", async () => {
    for (const server of servers) {
      const index = await get(server.url("/events"));
      expect(index.status).toBe(200);
      const html = await index.text();
      expect(html).toContain("Fixture central bank changes its rate");
      expect(html).toContain(`href="${server.base}/events/2024-09-18-fixture-rate-decision"`);
      const page = await get(server.url("/events/2024-09-18-fixture-rate-decision"));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("The fixture central bank announced a new policy rate on 18 September 2024.");
      expect((await get(server.url("/events/2020-01-01-no-such-event"))).status).toBe(404);
      expect((await get(server.url("/events/..%2F..%2Fmanifest"))).status).toBe(404);
    }
  });

  it("answers an unknown page with 404, inside the shell", async () => {
    const response = await get(servers[0]!.url("/no-such-page"));
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Page not found");
  });

  it("reports liveness, the release id and its age, uncached", async () => {
    const response = await get(servers[0]!.url("/api/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", surface: "local", release_id: FIXTURE_ID, profile: "public", refresh_failed: null });
    expect(body.age_seconds).toBeGreaterThan(0);
  });

  it("a local build answers only to this machine's names, and asks not to be indexed", async () => {
    for (const path of ["/explore", "/api/health", "/"]) {
      const response = await getAs(servers[0]!.url(path), "mydashboards.co");
      expect(response.status).toBe(421);
      expect(response.body).not.toContain("Fixture");
    }
    expect((await getAs(servers[0]!.url("/explore"), "localhost:3101")).status).toBe(200);
    expect((await get(servers[0]!.url("/explore"))).headers.get("x-robots-tag")).toBe("noindex");
  });
});

describe("export from the Explorer on the local surface (PLAN M5)", () => {
  let server: Running;
  beforeAll(async () => {
    server = await startVariant("local-atlas", { root: FIXTURE_ROOT });
  });
  afterAll(() => server.stop());

  it("the CSV is a file, stamped, never stored, never indexed", async () => {
    const response = await get(server.url("/explore/export?format=csv&s=fx_price_index&mode=z"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="macro-atlas_z_2024-01_2025-12_not-for-publication\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const body = await response.text();
    expect(body.split("\n")[0]).toBe("# Macro Atlas · NOT FOR PUBLICATION");
    expect(body).toContain(`# View: ${server.url("/explore")}?s=fx_price_index&mode=z`);
    expect(body).toContain("fx_price_index,Fixture price index,window,2025-12,2025-12-01,2025-12-31,109.9,");
  });

  it("a Host that is not a host is not written into the file", async () => {
    const response = await getAs(server.url("/explore/export?format=csv&s=fx_price_index"), "localhost,=1+1,");
    // The gate turns away a name that is not this machine's; if it ever did not, the file would still not carry it.
    expect(response.status === 421 || !response.body.includes("=1+1")).toBe(true);
    const named = await getAs(server.url("/explore/export?format=csv&s=fx_price_index"), "localhost:9");
    expect(named.status).toBe(200);
    expect(named.body).toContain("# View: http://localhost:9/macro-atlas/explore?s=fx_price_index");
  });

  it("the chart is one standalone drawing, and the file of everything holds every series", async () => {
    const svg = await get(server.url("/explore/export?format=svg&s=fx_price_index,fx_output_quarterly"));
    expect(svg.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    const drawing = await svg.text();
    expect(drawing).toMatch(/^<svg xmlns=/);
    expect(drawing).toContain("NOT FOR PUBLICATION");
    expect(drawing).not.toContain("var(--");
    const all = await (await get(server.url("/explore/export?format=all"))).text();
    for (const key of ["fx_price_index", "fx_output_quarterly", "fx_vote_margin", "fx_price_index_yoy"]) expect(all).toContain(`\n${key},`);
    expect(all).not.toContain("\nfx_exchange_index,");
  });

  it("a format it does not have, or nothing to export, is a short refusal", async () => {
    expect((await get(server.url("/explore/export?format=xlsx&s=fx_price_index"))).status).toBe(400);
    expect((await get(server.url("/explore/export?format=csv"))).status).toBe(422);
    expect((await get(server.url("/explore/export?format=csv&s=fx_exchange_index"))).status).toBe(422);
  });

  it("the page links to the files of the view it shows", async () => {
    const html = await (await get(server.url("/explore?s=fx_price_index&mode=z"))).text();
    expect(html).toContain(`href="${server.base}/explore/export?format=csv&amp;s=fx_price_index&amp;mode=z&amp;from=2024-01&amp;to=2025-12`);
    expect(html).toContain("format=svg");
    expect(html).toContain("format=all");
  });
});

describe("the catalog page, /data (PLAN section 3, M2)", () => {
  let server: Running;
  beforeAll(async () => {
    server = await startVariant("local-atlas", { root: FIXTURE_ROOT });
  });
  afterAll(() => server.stop());

  const page = async (query = "") => {
    const response = await get(server.url(`/data${query}`));
    expect(response.status).toBe(200);
    return response.text();
  };
  const rows = (html: string): string[] => [...html.matchAll(/data-series-key="([a-z0-9_]+)"/g)].map((m) => m[1]!);

  it("lists every series of the release in the HTML itself, from one release", async () => {
    const html = await page();
    expect(rows(html)).toHaveLength(8);
    expect(idsOn(html)).toEqual([FIXTURE_ID]);
    expect(html).toContain("Fixture price index");
    expect(html).toContain("8 series");
    expect(html).toMatch(/<h1[^>]*>Data<\/h1>/);
  });

  it("searches and filters with a plain GET form: no JavaScript is needed", async () => {
    const html = await page();
    const form = /<form[^>]*role="search"[^>]*>/.exec(html)![0];
    expect(form).toContain('action="/macro-atlas/data"');
    expect(form).toContain('method="get"');
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"/);
    for (const name of ["segment", "freq", "via", "rights"]) expect(html).toMatch(new RegExp(`<select[^>]*name="${name}"`));
    expect(rows(await page("?q=vote"))).toEqual(["fx_vote_margin"]);
    expect(rows(await page("?freq=quarterly"))).toEqual(["fx_output_quarterly"]);
    expect(rows(await page("?segment=economy_jobs&freq=monthly&q=payrolls"))).toEqual(["fx_payrolls_break"]);
    const narrowed = await page("?q=vote");
    expect(narrowed).toContain("1 of 8 series");
    expect(narrowed).toMatch(/<input[^>]*name="q"[^>]*value="vote"/); // the form shows what was asked
  });

  it("says so when nothing matches, and offers the way back", async () => {
    const html = await page("?q=zzzz");
    expect(rows(html)).toEqual([]);
    expect(html).toContain("No series match");
    expect(html).toContain('href="/macro-atlas/data"');
  });

  it("names a withheld series with the reason and shows no value for it", async () => {
    const html = await page("?via=fixture_vendor");
    expect(rows(html)).toEqual(["fx_exchange_index"]);
    expect(html).toContain("Withheld");
    expect(html).toContain("The licence does not allow redistribution.");
  });

  it("does not put what a reader typed into the page as markup", async () => {
    const html = await page(`?q=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("series pages, /data/{key} (PLAN section 3, M3)", () => {
  const ALIASED = "20260204T000000Z-ddddddd";
  let local: Running;
  let production: Running;
  const root = tempRoot();
  beforeAll(async () => {
    addRelease(root, { id: ALIASED, edit: { fx_price_index: (_file, entry) => void (entry.aliases = ["fx_cpi"]) } });
    promote(root, ALIASED);
    local = await startVariant("local-atlas", { root });
    production = await startVariant("production", { root: FIXTURE_ROOT });
  });
  afterAll(() => Promise.all([local.stop(), production.stop()]));

  it("a page is complete in its HTML, from one release: value, sentence, three drawings, every row of the table", async () => {
    const response = await get(local.url("/data/fx_price_index"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(idsOn(html)).toEqual([ALIASED]);
    expect(html).toMatch(/<h1[^>]*>Fixture price index<\/h1>/);
    expect(html).toContain("data-latest");
    expect(html).toContain("5.2% higher than a year earlier.");
    expect(html.match(/<svg[^>]*role="img"/g)).toHaveLength(3);
    const table = /<table data-figure-table[\s\S]*?<\/table>/.exec(html)![0];
    expect(table.match(/<tr/g)).toHaveLength(25);
    expect(html).toContain('href="/macro-atlas/explore?s=fx_price_index"');
    expect(html).not.toMatch(/<style\b/);
  });

  it("is rendered for each request and never stored by a shared cache", async () => {
    const response = await get(local.url("/data/fx_price_index"));
    expect(response.headers.get("cache-control") ?? "").toMatch(/no-store|private/);
  });

  it("a renamed key moves, permanently, to the permanent key under the base path", async () => {
    const response = await get(local.url("/data/fx_cpi"));
    expect(response.status).toBe(308);
    expect(new URL(response.headers.get("location")!, local.origin).pathname).toBe("/macro-atlas/data/fx_price_index");
  });

  it.each(["/data/nope", "/data/FX_PRICE_INDEX", "/data/fx_price_index.xml", "/data/fx_price_index/extra", "/docs/glossary/nope"])("%s is not found", async (path) => {
    expect((await get(local.url(path))).status).toBe(404);
  });

  it("a withheld series has its page: name, reason, and no value, drawing or table", async () => {
    const html = await (await get(local.url("/data/fx_exchange_index"))).text();
    expect(html).toMatch(/<h1[^>]*>Fixture exchange index<\/h1>/);
    expect(html).toContain("The licence does not allow redistribution.");
    for (const absent of ["data-latest", "data-figure-table", 'role="img"']) expect(html).not.toContain(absent);
  });

  // A public-profile release on the production surface is served (200), but until Alex signs
  // rows of the rights register (ADR 0020) the gate permits no value there. This is not the 503 a
  // local-profile release gets: the page exists and says why it holds no value.
  it.each(["fx_price_index", "fx_output_quarterly", "fx_vote_margin", "fx_price_index_yoy"])("on the production surface %s is named, with the reason, and not one value", async (key) => {
    const response = await get(production.url(`/data/${key}`));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Not shown here");
    expect(html).toContain("(macro-atlas-fixture) is not signed, so it is not permitted on the production surface");
    for (const absent of ["data-latest", "data-figure-table", 'role="img"', "data-takeaway", "data-silence"]) expect(html, absent).not.toContain(absent);
    // Values that exist only in the fixture's series files.
    for (const value of ["109.9", "104.5", "566.4", "510.2", "5.167", "-1.5<"]) expect(html, value).not.toContain(value);
  });

  it("the glossary is served on every surface", async () => {
    for (const server of [local, production]) {
      const html = await (await get(server.url("/docs/glossary"))).text();
      expect(html).toMatch(/<h1[^>]*>Glossary<\/h1>/);
      expect(html.match(/data-term="/g)!.length).toBeGreaterThanOrEqual(20);
      expect((await get(server.url("/docs/glossary/withheld"))).status).toBe(200);
    }
  });
});

describe("the strip on a local-profile release (PLAN M2, 6.1)", () => {
  const STRIP = "Local build · v1 data via FRED and Yahoo · not for publication";
  let server: Running;
  const root = tempRoot();
  beforeAll(async () => {
    addRelease(root, { id: A, profile: "local", signed: false, legacy: "fx_price_index" });
    addRelease(root, { id: B, profile: "local", signed: false });
    addRelease(root, { id: LOCAL });
    promote(root, A);
    server = await startVariant("local-atlas", { root });
  });
  afterAll(() => server.stop());

  it.each(["/explore", "/data", "/data?q=nothing-matches", "/data/fx_price_index", "/docs/glossary", "/docs/glossary/stale", "/no-such-page"])("reads exactly as agreed on %s when the release holds v1's data", async (path) => {
    promote(root, A);
    const html = await (await get(server.url(path))).text();
    expect(idsOn(html)).toEqual([A]);
    expect(html).toContain(STRIP);
    // visible without scrolling: it comes before the page's content
    expect(html.indexOf(STRIP)).toBeLessThan(html.indexOf('<main id="main"'));
  });

  it("a local-profile release without v1's data does not claim to hold it", async () => {
    promote(root, B);
    const html = await (await get(server.url("/data"))).text();
    expect(html).not.toContain("v1 data via FRED and Yahoo");
    expect(html).toContain("Local build · local-profile release · not for publication");
  });

  it("a public-profile release has no strip", async () => {
    promote(root, LOCAL);
    const html = await (await get(server.url("/data"))).text();
    expect(html).not.toContain("not for publication");
    promote(root, A);
  });
});

describe("the theme follows the OS unless the reader chose, and the choice persists", () => {
  let server: Running;
  beforeAll(async () => {
    server = await startVariant("local-atlas", { root: FIXTURE_ROOT });
  });
  afterAll(() => server.stop());

  const htmlTag = async (cookie?: string) =>
    /<html[^>]*>/.exec(await (await get(server.url("/explore"), cookie ? { headers: { cookie } } : {})).text())![0];

  it("renders no override by default, so the stylesheet's prefers-color-scheme rule decides", async () => {
    expect(await htmlTag()).not.toContain("data-theme");
  });

  it("the form works without JavaScript: it sets the cookie and returns to the page", async () => {
    const response = await get(server.url("/api/theme"), {
      method: "POST",
      body: new URLSearchParams({ theme: "dark", return: "/macro-atlas/explore?s=a" }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/macro-atlas/explore?s=a");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toBe("atlas-theme=dark; Path=/macro-atlas; Max-Age=31536000; SameSite=Lax");
    expect(await htmlTag(cookie.split(";")[0])).toContain('data-theme="dark"');
    expect(await htmlTag("atlas-theme=light")).toContain('data-theme="light"');
  });

  it("Auto forgets the override", async () => {
    const response = await get(server.url("/api/theme"), { method: "POST", body: new URLSearchParams({ theme: "auto" }) });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("location")).toBe("/macro-atlas/");
  });

  it("never redirects off the site, and refuses a theme it does not know", async () => {
    const away = await get(server.url("/api/theme"), {
      method: "POST",
      body: new URLSearchParams({ theme: "dark", return: "https://example.org/" }),
    });
    expect(away.headers.get("location")).toBe("/macro-atlas/");
    const bad = await get(server.url("/api/theme"), { method: "POST", body: new URLSearchParams({ theme: "sepia" }) });
    expect(bad.status).toBe(400);
  });
});

describe("rewriting CURRENT changes the served page with no restart", () => {
  let server: Running;
  const root = tempRoot();
  beforeAll(async () => {
    addRelease(root, { id: A });
    addRelease(root, { id: B, rename: { key: "fx_price_index", name: "Renamed in release B" } });
    promote(root, A);
    server = await startVariant("local-atlas", { root });
  });
  afterAll(() => server.stop());

  it("serves A, then B after promotion, then A again after a rollback", async () => {
    const page = async () => (await get(server.url("/explore"))).text();
    let html = await page();
    expect(idsOn(html)).toEqual([A]);
    expect(html).toContain("Fixture price index");

    promote(root, B);
    html = await page();
    expect(idsOn(html)).toEqual([B]);
    expect(html).toContain("Renamed in release B");

    promote(root, A);
    expect(idsOn(await page())).toEqual([A]);
  });

  it("everything on a page comes from one release id, while CURRENT is being rewritten", async () => {
    let stop = false;
    const churn = (async () => {
      for (let i = 0; !stop; i++) {
        promote(root, i % 2 ? A : B);
        await new Promise((r) => setTimeout(r, 1));
      }
    })();
    const seen = new Set<string>();
    for (let round = 0; round < 12; round++) {
      const pages = await Promise.all(Array.from({ length: 8 }, async () => (await get(server.url("/explore"))).text()));
      for (const html of pages) {
        const ids = idsOn(html);
        expect(ids).toHaveLength(1);
        // The page's content agrees with the id in its chrome.
        expect(html.includes("Renamed in release B")).toBe(ids[0] === B);
        seen.add(ids[0]!);
      }
    }
    stop = true;
    await churn;
    expect([...seen].sort()).toEqual([A, B]); // the test did see both releases
    promote(root, A);
  });

  it("a release id sent by the client is ignored", async () => {
    promote(root, A);
    const html = await (await get(server.url("/explore"), { headers: { "x-atlas-release": B } })).text();
    expect(idsOn(html)).toEqual([A]);
  });

  it("keeps serving the last good release when CURRENT moves to a broken one, and health says so", async () => {
    promote(root, A);
    await get(server.url("/explore"));
    const broken = addRelease(root, { id: LOCAL });
    writeFileSync(join(broken, "catalog.json"), "not json");
    promote(root, LOCAL);
    const response = await get(server.url("/explore"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(idsOn(html)).toEqual([A]);
    expect(html).toContain("Refresh failed");
    const health = (await (await get(server.url("/api/health"))).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ status: "degraded", release_id: A, refresh_failed: { kind: "invalid", id: LOCAL } });
    rmSync(broken, { recursive: true });
    promote(root, A);
  });
});

describe("a production-surface build fails closed (PLAN 6.1 point 5, reader)", () => {
  let server: Running;
  const root = tempRoot();
  const PATHS = ["/", "/highlights", "/search", "/search?q=price", "/search/hits?q=price", "/explore", "/explore/", "/data", "/data?q=price", "/data/fx_price_index", "/data/fx_exchange_index", "/docs/glossary", "/docs/glossary/stale", "/api/health", "/api/theme", "/icon.svg", "/_next/static/chunks/x.js", "/no/such/page", "/explore/export?format=csv&s=fx_price_index", "/explore/export?format=svg&s=fx_price_index", "/explore/export?format=all", "/data/fx_price_index.csv", "/data/fx_price_index.json?as_of=2025-12-13", "/data/fx_price_index.metadata.json", "/data/fx_price_index.md", "/data/fx_price_index/twin/csv", "/api/v1/status", "/claims", `/claims/${CLAIM}`, `/claims/${CLAIM}.json`, `/claims/${CLAIM}.md`, `/claims/${CLAIM}/evidence.csv`, `/claims/${CLAIM}/lock.json`, `/claims/${CLAIM}/twin/json`, "/docs/method/claims"];

  beforeAll(async () => {
    addRelease(root, { id: A });
    addRelease(root, { id: LOCAL, profile: "local", signed: false, legacy: "fx_price_index", rename: { key: "fx_price_index", name: "SEEDED-FRED-VALUE-1234.5" } });
    promote(root, LOCAL);
    // What a careless deploy might set: none of it can turn a production build into a local one.
    server = await startVariant("production", { root, env: { ATLAS_SURFACE: "local", BASE_PATH: "/macro-atlas-staging", NEXT_PUBLIC_BASE_PATH: "/macro-atlas-staging" } });
  });
  afterAll(() => server.stop());

  it.each(PATHS)("pointed at a local-profile release, answers 503 on %s", async (path) => {
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await get(server.url(path), { method, headers: { "x-atlas-release": A, "x-atlas-twin": "csv", "if-none-match": "*" } });
      expect(response.status, `${method} ${path}`).toBe(503);
      expect(await response.text()).not.toContain("SEEDED-FRED-VALUE");
    }
  });

  it("fails its health check, saying why", async () => {
    const response = await get(server.url("/api/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "unavailable", surface: "production", kind: "refused", release_id: LOCAL });
  });

  it("serves a public-profile release, indexable, to any host", async () => {
    promote(root, A);
    const response = await getAs(server.url("/explore"), "mydashboards.co");
    expect(response.status).toBe(200);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
    expect(idsOn(response.body)).toEqual([A]);
    expect(await (await get(server.url("/api/health"))).json()).toMatchObject({ status: "ok", surface: "production" });
  });

  it("refuses every export, even of a public-profile release, until the rights register says otherwise (PLAN M5, 6.1)", async () => {
    promote(root, A);
    for (const query of ["format=csv&s=fx_price_index", "format=svg&s=fx_price_index", "format=all", "s=fx_price_index"]) {
      const response = await get(server.url(`/explore/export?${query}`));
      expect(response.status, query).toBe(403);
      expect(response.headers.get("content-type"), query).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("cache-control"), query).toBe("no-store");
      const body = await response.text();
      expect(body, query).toMatch(/cannot be exported here/);
      expect(body, query).not.toMatch(/109\.9|100\.4|<svg|period_start/);
    }
    // And the page does not offer what would be refused.
    const html = await (await get(server.url("/explore?s=fx_price_index"))).text();
    expect(html).not.toContain("/explore/export");
    expect(html).toContain("Export is not available here");
  });

  it("refuses every twin of values while no register row is signed, and still names the Series (PLAN M17, 6.1)", async () => {
    promote(root, A);
    for (const path of ["/data/fx_price_index.csv", "/data/fx_price_index.json", "/data/fx_price_index.md", "/data/fx_price_index.json?as_of=2025-12-13", "/data/fx_exchange_index.csv"]) {
      for (const headers of [{}, { "if-none-match": "*" }, { "x-atlas-twin": "metadata.json" }] as Record<string, string>[]) {
        const response = await get(server.url(path), { headers });
        expect(response.status, path).toBe(403);
        expect(response.headers.get("cache-control"), path).toBe("no-store");
        expect(response.headers.get("etag"), path).toBeNull();
        expect(await response.text(), path).not.toMatch(/109\.9|109\.5|100\.4|period_start/);
      }
    }
    const meta = await get(server.url("/data/fx_price_index.metadata.json"));
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ name: "Fixture price index", state: "not_permitted", coverage: null, downloads: { permitted: false } });
    const page = await (await get(server.url("/data/fx_price_index?as_of=2025-12-13"))).text();
    expect(page).toContain("Not shown here");
    expect(page).not.toMatch(/109\.5|fx_price_index\.csv/);
    const status = await (await get(server.url("/api/v1/status"))).json();
    expect(status).toMatchObject({ surface: "production", release_id: A, counts: { shown: 0, not_permitted: 7, withheld: 1 } });
    expect(JSON.stringify(status)).not.toMatch(/2025-12/);
  });

  it("goes back to 503 the moment CURRENT names a local-profile release: no fallback to the good one", async () => {
    promote(root, A);
    expect((await get(server.url("/explore"))).status).toBe(200);
    promote(root, LOCAL);
    expect((await get(server.url("/explore"))).status).toBe(503);
    expect((await get(server.url("/api/health"))).status).toBe(503);
  });

  it("never stands an earlier release in for one it cannot open: 503, not the last good one", async () => {
    promote(root, A);
    expect((await get(server.url("/explore"))).status).toBe(200);
    const broken = addRelease(root, { id: B, signed: false });
    writeFileSync(join(broken, "content", "annotations.json"), "{ not json");
    promote(root, B);
    expect((await get(server.url("/explore"))).status).toBe(503);
    expect(await (await get(server.url("/api/health"))).json()).toMatchObject({ status: "unavailable", release_id: B });
    rmSync(broken, { recursive: true });
    promote(root, "20260209T000000Z-0dead00"); // not on disk
    expect((await get(server.url("/explore"))).status).toBe(503);
  });

  it("a path Next normalises before the proxy runs gets a bare redirect, and the redirect leads to 503", async () => {
    // The one place the proxy is not first (ADR 0015): doubled slashes are redirected by Next's
    // router. The redirect carries no page, and what it points at is answered by the proxy.
    promote(root, LOCAL);
    const response = await get(server.url("//explore"));
    expect(response.status).toBe(308);
    expect(await response.text()).not.toMatch(/SEEDED-FRED-VALUE|fx_price_index/);
    const target = new URL(response.headers.get("location")!, server.origin);
    expect(target.pathname).toBe("/macro-atlas/explore");
    expect((await get(target.href)).status).toBe(503);
  });

  it("answers 503 when there is no release at all", async () => {
    const empty = await startVariant("production", { root: tempRoot() });
    const unset = await startVariant("production");
    try {
      expect((await get(empty.url("/explore"))).status).toBe(503);
      expect((await get(unset.url("/api/health"))).status).toBe(503);
    } finally {
      await Promise.all([empty.stop(), unset.stop()]);
    }
  });
});

describe("twins of a series page, and status (PLAN section 7, M17)", () => {
  let atlas: Running;
  let staging: Running;
  beforeAll(async () => {
    atlas = await startVariant("local-atlas", { root: FIXTURE_ROOT });
    staging = await startVariant("local-staging", { root: FIXTURE_ROOT });
  });
  afterAll(() => Promise.all([atlas.stop(), staging.stop()]));

  it.each([
    ["csv", "text/csv; charset=utf-8"],
    ["json", "application/json; charset=utf-8"],
    ["metadata.json", "application/json; charset=utf-8"],
    ["md", "text/markdown; charset=utf-8"],
  ])("serves /data/{key}.%s under each base path, from the fixed release, never stored on a local build", async (suffix, type) => {
    for (const server of [atlas, staging]) {
      const response = await get(server.url(`/data/fx_price_index.${suffix}`));
      expect(response.status, suffix).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      const body = await response.text();
      expect(idsOn(body)).toEqual([FIXTURE_ID]);
      expect(body).toContain(`${server.origin}${server.base}/data/fx_price_index`);
      if (suffix !== "metadata.json") expect(body).toMatch(/not for publication/i);
      expect(response.headers.get("content-disposition")).toBe(
        suffix === "metadata.json" ? 'inline; filename="macro-atlas_fx_price_index.metadata.json"' : `${suffix === "csv" ? "attachment" : "inline"}; filename="macro-atlas_fx_price_index_not-for-publication.${suffix}"`,
      );
      const head = await get(server.url(`/data/fx_price_index.${suffix}`), { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
  });

  it("the CSV, the JSON and the page hold the same values for the same question", async () => {
    for (const query of ["", "?as_of=2025-12-13", "?transform=pc1&start=2025-06-01"]) {
      const doc = (await (await get(atlas.url(`/data/fx_price_index.json${query}`))).json()) as { observations: { period: string; value: number | null }[] };
      const csv = await (await get(atlas.url(`/data/fx_price_index.csv${query}`))).text();
      const rows = csv.split("\n").filter((line) => line.startsWith("fx_price_index,")).map((line) => line.split(","));
      expect(rows.map((r) => [r[1], r[4] === "" ? null : Number(r[4])])).toEqual(doc.observations.map((o) => [o.period, o.value]));
      const html = await (await get(atlas.url(`/data/fx_price_index${query}`))).text();
      const table = /<table data-figure-table="fx_price_index"[\s\S]*?<\/table>/.exec(html)![0];
      const cells = [...table.matchAll(/<\/th><td>(?:<data value="([^"]*)">)?([^<]*)/g)].map((m) => (m[2] === "" && m[1] === undefined ? null : Number(m[1] ?? m[2]!.replace(/,/g, "").replace(/\u2212/g, "-"))));
      expect(cells).toEqual(doc.observations.map((o) => o.value));
      expect(html).toContain(`href="/macro-atlas/data/fx_price_index.csv${query.replace(/&/g, "&amp;")}"`);
    }
  });

  it("a date without coverage: the page says unavailable and holds no value; the file holds no observation", async () => {
    const html = await (await get(atlas.url("/data/fx_price_index?as_of=2025-12-01"))).text();
    expect(html).toContain('data-basis="unavailable"');
    expect(html).not.toMatch(/109\.9|109\.5|data-figure-table/);
    expect(await (await get(atlas.url("/data/fx_price_index.json?as_of=2025-12-01"))).json()).toMatchObject({ basis: "unavailable", observations: [] });
  });

  it("the withheld Series: its page names it with no value, its files are 403 with the reason, its metadata is served", async () => {
    const html = await (await get(atlas.url("/data/fx_exchange_index"))).text();
    expect(html).toContain("Fixture exchange index");
    expect(html).not.toContain("data-figure-table");
    for (const suffix of ["csv", "json", "md"]) {
      const response = await get(atlas.url(`/data/fx_exchange_index.${suffix}`));
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("does not allow redistribution");
    }
    expect(await (await get(atlas.url("/data/fx_exchange_index.metadata.json"))).json()).toMatchObject({ state: "withheld", coverage: null });
  });

  it("refusals: 400 with the allowlist, 404 for a Series or a suffix that does not exist, and the handler's own path is not an address", async () => {
    const bad = await get(atlas.url("/data/fx_price_index.csv?transform=sqrt"));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("transform: one of lin, chg");
    expect((await get(atlas.url("/data/nope.json"))).status).toBe(404);
    expect((await get(atlas.url("/data/fx_price_index.xml"))).status).toBe(404);
    // The handler's own path is not an address: asked for directly, it is not found.
    for (const headers of [{}, { "x-atlas-twin": "csv" }] as Record<string, string>[]) {
      for (const path of ["/data/fx_price_index/twin", "/data/fx_price_index/twin/csv", "/data/fx_price_index/twin/json?as_of=2025-12-13"]) {
        const direct = await get(atlas.url(path), { headers });
        expect(direct.status, path).toBe(404);
        expect(await direct.text(), path).not.toMatch(/109\.9|109\.5/);
      }
    }
    // A forged header cannot change the format of a real twin either.
    const forged = await get(atlas.url("/data/fx_price_index.csv"), { headers: { "x-atlas-twin": "json" } });
    expect(forged.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  });

  it("a Host that is not a host is not written into a file", async () => {
    const response = await getAs(atlas.url("/data/fx_price_index.json"), 'localhost"><script>');
    expect(response.body).not.toContain("<script>");
  });

  it("status: the release, each source and each Series, and stale inputs said as such", async () => {
    const response = await get(atlas.url("/api/v1/status"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const doc = await response.json();
    expect(doc).toMatchObject({ status: "stale", surface: "local", release_id: FIXTURE_ID, last_run: null, counts: { series: 8, shown: 7, withheld: 1, stale: 1 } });
    expect(doc.series.find((s: { key: string }) => s.key === "fx_permits_stale")).toMatchObject({ stale: true, last_period: "2024-06" });
  });
});

describe("the Explorer on agency data (PLAN M18): pinned links, as of a date, saved views", () => {
  let server: Running;
  let production: Running;
  const root = tempRoot();
  const VIEW = "s=fx_price_index&mode=lin&from=2025-01&to=2025-12&layers=none";
  /** The December value: 109.9 in A, 116.9 in B, which revised every value upward by seven. */
  const [IN_A, IN_B] = ["109.9", "116.9"];
  beforeAll(async () => {
    addRelease(root, { id: A });
    addRelease(root, { id: B, edit: { fx_price_index: (file) => file.observations.forEach((o: { value: number | null }) => (o.value = o.value === null ? null : Math.round((o.value + 7) * 10) / 10)) } });
    addRelease(root, { id: LOCAL, profile: "local", signed: false });
    promote(root, A);
    writeFileSync(
      join(root, "saved.json"),
      JSON.stringify({ format: 1, saved: [{ id: "sq-20260201-0a1b2c3d", note: "Prices before the revision", query: `${VIEW}&pin=${A}`, release_id: A, saved_at: "2026-02-01T10:00:00Z" }] }),
    );
    server = await startVariant("local-atlas", { root });
    production = await startVariant("production", { root });
  });
  afterAll(() => Promise.all([server.stop(), production.stop()]));

  it("a pinned link shows the same data after a newer release is promoted, says it is pinned, and answers 410 once pruned", async () => {
    const pinned = async () => get(server.url(`/explore?${VIEW}&table=1&pin=${A}`));
    let html = await (await pinned()).text();
    expect(idsOn(html)).toEqual([A]);
    expect(html).toContain(IN_A);
    expect(html).toMatch(/data-pinned="[^"]+"[^>]*>.*Pinned to release/s);
    expect(html).toContain("It is the current release.");

    promote(root, B);
    const current = await (await get(server.url(`/explore?${VIEW}&table=1`))).text();
    // (The list of saved views names the releases they are pinned to; the page itself is B.)
    expect(current).toContain(`data-release="${B}"`);
    expect(current).toContain(IN_B);
    expect(current).not.toContain("data-pinned");
    const response = await pinned();
    html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control") ?? "").not.toMatch(/immutable/);
    expect(idsOn(html)).toEqual([A]); // one page, one Release: the frame is the pinned Release's too
    expect(html).toContain(IN_A);
    expect(html).not.toContain(IN_B);
    expect(html).toContain("A newer release is current.");
    // Every address on the page stays pinned, but for the one that lets go of the pin.
    const links = [...html.matchAll(/href="([^"]*\/explore\?[^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    expect(links.length).toBeGreaterThan(5);
    expect(links.filter((href) => !href.includes(`pin=${A}`))).toEqual([`${server.base}/explore?${VIEW}&table=1`]);
    expect(links.some((href) => href.includes(`pin=${B}`))).toBe(false);
    // The file of a pinned view is the pinned Release's.
    const csv = await (await get(server.url(`/explore/export?format=csv&${VIEW}&pin=${A}`))).text();
    expect(csv).toContain(`Release ${A}`);
    expect(csv).toContain(IN_A);

    mkdirSync(join(root, "trash"), { recursive: true });
    renameSync(join(root, "releases", A), join(root, "trash", A)); // what retention does (atlas/publish/root.py)
    for (const path of [`/explore?${VIEW}&pin=${A}`, `/explore/export?format=csv&${VIEW}&pin=${A}`]) {
      const gone = await get(server.url(path));
      expect(gone.status, path).toBe(410);
      const body = await gone.text();
      expect(body).toContain(`href="${server.base}/explore?${VIEW.replace(/&/g, "&#38;")}"`);
      expect(body).not.toContain(IN_A);
      expect(body).not.toContain(IN_B);
      expect(gone.headers.get("cache-control")).toBe("no-store");
    }
    renameSync(join(root, "trash", A), join(root, "releases", A));
  });

  it("a pin that is not a release id is 400; nothing is shown in its place", async () => {
    for (const pin of ["latest", "", `${A}&pin=${B}`]) {
      const response = await get(server.url(`/explore?${VIEW}&pin=${pin}`));
      expect(response.status, pin).toBe(400);
      expect(await response.text()).not.toMatch(/10[0-9]\.[0-9]|11[0-9]\.[0-9]/);
    }
  });

  it("a production build refuses a pinned release it would refuse as CURRENT: 503, whatever is current", async () => {
    promote(root, A);
    expect((await get(production.url("/explore"))).status).toBe(200);
    const response = await get(production.url(`/explore?${VIEW}&pin=${LOCAL}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/10[0-9]\.[0-9]/);
  });

  it("an as-of view is drawn from what was held then, and one with no answer shows no value", async () => {
    promote(root, A);
    const then = await (await get(server.url("/explore?s=fx_price_index&as_of=2025-12-10&table=1"))).text();
    expect(then).toMatch(/data-as-of="atlas_observed"/);
    expect(then).toContain("As known before");
    expect(then).not.toContain(IN_A); // December was not yet held
    const none = await (await get(server.url("/explore?s=fx_price_index&as_of=2025-01-01&table=1"))).text();
    expect(none).toContain("Nothing is shown as of then");
    expect(none).not.toMatch(/10[0-9]\.[0-9]/);
  });

  it("saved views are listed on the local surface, each a pinned link with its note, and never on a public one", async () => {
    const local = await (await get(server.url("/explore"))).text();
    expect(local).toContain("Prices before the revision");
    expect(local).toContain(`href="${server.base}/explore?${VIEW.replace(/&/g, "&amp;")}&amp;pin=${A}"`);
    const pub = await (await get(production.url("/explore"))).text();
    expect(pub).not.toContain("Prices before the revision");
    expect(pub).not.toContain("data-saved");
    expect(pub).not.toContain("atlas save");
  });
});

describe("claims (PLAN M21): the page, its twins, the rights gate and User notes", () => {
  const NOTE = `---\nid: "2026-11-12-my-reading-of-it"\nuser: "alex"\nabout:\n  kind: claim\n  id: "${CLAIM}"\ncreated: "2026-11-12"\nstatus: draft\n---\n\nSEEDED-NOTE: I think this one is misleading.\n`;
  const TWINS = [`/claims/${CLAIM}.json`, `/claims/${CLAIM}.md`, `/claims/${CLAIM}/evidence.csv`, `/claims/${CLAIM}/lock.json`];
  const root = tempRoot();
  const notes = mkdtempSync(join(tmpdir(), "atlas-notes-"));
  let local: Running;
  let production: Running;
  beforeAll(async () => {
    mkdirSync(join(notes, "alex"));
    writeFileSync(join(notes, "alex", "2026-11-12-my-reading-of-it.md"), NOTE);
    addRelease(root, { id: A }); // public-profile, as the fixture is
    addRelease(root, { id: LOCAL, profile: "local", signed: false });
    addRelease(root, { id: B, schema: "0.2.0" }); // a Release from before there were Claims
    promote(root, A);
    local = await startVariant("local-atlas", { root, env: { ATLAS_NOTES_DIR: notes } });
    production = await startVariant("production", { root, env: { ATLAS_NOTES_DIR: notes } });
  });
  afterAll(() => Promise.all([local.stop(), production.stop()]));

  it("a local build serves the page complete in its HTML, from one release, never stored", async () => {
    promote(root, A);
    const response = await get(local.url(`/claims/${CLAIM}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const html = await response.text();
    expect(idsOn(html)).toEqual([A, FIXTURE_ID]); // the release served, and the release the lock was computed on
    expect(html).toContain("The fixture price index stood at 109.5 in November, up about five percent since January.");
    expect(html).toMatch(/data-cell="then">.*?109\.5/s);
    expect(html).toContain("data-claim-drawing");
    expect(html).toContain(`href="/macro-atlas/claims/${CLAIM}/evidence.csv"`);
    expect(html).toContain(`type="text/markdown" href="/macro-atlas/claims/${CLAIM}.md"`);
    const index = await (await get(local.url("/claims"))).text();
    expect(index).toContain(`href="/macro-atlas/claims/${CLAIM}"`);
    expect(index).toContain("Recorded, by party:");
    expect((await get(local.url("/docs/method/claims"))).status).toBe(200);
  });

  it("AC: a User note renders on a local build of a local-profile release, marked with its author", async () => {
    promote(root, LOCAL);
    const html = await (await get(local.url(`/claims/${CLAIM}`))).text();
    expect(html).toContain('data-note-by="alex"');
    expect(html.replaceAll("<!-- -->", "")).toContain("Note by alex · 12 November 2026 · alex’s own, not Macro Atlas’s");
    expect(html).toContain("SEEDED-NOTE: I think this one is misleading.");
    // ...and in no file: a twin is never given a note.
    for (const path of TWINS) {
      const twin = await get(local.url(path));
      expect(twin.status, path).toBe(200);
      expect(await twin.text(), path).not.toMatch(/SEEDED-NOTE|Note by/);
    }
    promote(root, A);
  });

  it("AC: the note is absent from a public-profile release, on the local build and on production", async () => {
    promote(root, A);
    for (const server of [local, production]) {
      for (const path of ["/claims", `/claims/${CLAIM}`, ...TWINS, "/explore", "/api/v1/status"]) {
        expect(await (await get(server.url(path))).text(), `${server.base} ${path}`).not.toMatch(/SEEDED-NOTE|Note by|data-note-by/);
      }
    }
  });

  it("production: the record is shown, and no figure or file of figures while no register row is signed", async () => {
    promote(root, A);
    const response = await get(production.url(`/claims/${CLAIM}`));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("A. Fixture, 11 December 2025");
    expect(html).toContain("Not shown here");
    expect(html).not.toMatch(/data-cell|109\.3|data-claim-drawing|evidence\.csv|lock\.json/);
    for (const path of TWINS) {
      for (const headers of [{}, { "if-none-match": "*" }, { "x-atlas-twin": "json" }] as Record<string, string>[]) {
        const twin = await get(production.url(path), { headers });
        expect(twin.status, path).toBe(403);
        expect(twin.headers.get("cache-control"), path).toBe("no-store");
        expect(await twin.text(), path).not.toMatch(/109\.|period/);
      }
    }
    expect((await get(production.url(`/claims/${CLAIM}/twin/json`))).status).toBe(404);
    expect((await get(production.url(`/claims/${CLAIM}/twin/lock`), { headers: { "x-atlas-twin": "lock" } })).status).toBe(404);
  });

  it("a Release with no Claim: no tab; hidden on production, explained on a local build", async () => {
    promote(root, B);
    const nav = (html: string) => html.slice(html.indexOf('<nav aria-label="Sections"'), html.indexOf("</nav>", html.indexOf('<nav aria-label="Sections"')));
    expect(nav(await (await get(production.url("/explore"))).text())).not.toContain("Claims");
    expect((await get(production.url("/claims"))).status).toBe(404);
    expect((await get(production.url(`/claims/${CLAIM}`))).status).toBe(404);
    const empty = await get(local.url("/claims"));
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain("This release holds no claims.");
    promote(root, A);
  });

  it("a claim id that is not one, or a path that climbs, is not found", async () => {
    for (const path of ["/claims/2020-01-01-no-such-claim", "/claims/..%2F..%2Fmanifest", "/claims/2020-01-01-no-such-claim.json", `/claims/${CLAIM}.csv`, `/claims/${CLAIM}/evidence.json`]) {
      expect((await get(local.url(path))).status, path).toBe(404);
    }
  });
});

describe("the Overview, Highlights and search (PLAN M22)", () => {
  let server: Running;
  let production: Running;
  const root = tempRoot();
  beforeAll(async () => {
    server = await startVariant("local-atlas", { root: FIXTURE_ROOT });
    addRelease(root, { id: A });
    promote(root, A);
    production = await startVariant("production", { root });
  });
  afterAll(() => Promise.all([server.stop(), production.stop()]));

  const html = async (path: string, from: Running = server) => {
    const response = await get(from.url(path));
    expect(response.status, path).toBe(200);
    return response.text();
  };
  /** Text as a reader has it: no tags, no scripts, entities read. */
  const words = (page: string) => page.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  const main = (page: string) => page.slice(page.indexOf("<main"), page.indexOf("</main>"));
  const SEGMENT_LABELS = ["Economy & jobs", "Markets & money", "Infrastructure", "Governance & politics", "Disasters & health", "The US in the world"];

  it("AC: the Overview is complete in its HTML, with no script run: six rows, each Segment's Series, value, change and drawing", async () => {
    const page = await html("/");
    expect(idsOn(page)).toEqual([FIXTURE_ID]);
    const rows = [...page.matchAll(/<li[^>]*data-segment="([a-z_]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(["economy_jobs", "markets_money", "infrastructure", "governance_politics", "disasters_health", "us_in_the_world"]);
    const text = words(main(page));
    let at = -1;
    for (const label of SEGMENT_LABELS) {
      const next = text.indexOf(label, at + 1);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
    expect(text).toContain("Release of 1 January 2026");
    expect(text).toContain("Fixture price index");
    expect(text).toContain("109.9 in December 2025 (index, 2024-01 = 100)");
    expect(text).toContain("Preliminary");
    expect(text).toContain("5.2% higher than a year earlier");
    expect(text).toContain("4 more in Highlights");
    expect(text).toContain("No headline series in this release.");
    // The drawing is in the page as markup, named for a reader who cannot see it.
    expect(page).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Fixture price index, January 2024 to December 2025"/);
    expect((page.match(/data-sparkline=/g) ?? []).length).toBe(3);
    // Every figure is a door.
    expect(page).toContain('href="/macro-atlas/explore?s=fx_price_index&amp;from=2024-12&amp;to=2025-12"');
    expect(page).toContain('href="/macro-atlas/data/fx_price_index"');
    expect(page).toContain('href="/macro-atlas/highlights"');
    // Search is a plain form.
    expect(page).toMatch(/<form[^>]*action="\/macro-atlas\/search"/);
  });

  it("the Overview is made for each request, and marks a reader's first visit once", async () => {
    const first = await get(server.url("/"));
    expect(first.headers.get("cache-control")).toMatch(/no-store/);
    expect(first.headers.get("set-cookie")).toBe("atlas-seen=1; Path=/macro-atlas; Max-Age=31536000; SameSite=Lax; HttpOnly");
    expect(await first.text()).toMatch(/<ol[^>]*data-first-visit/);
    const again = await get(server.url("/"), { headers: { cookie: "atlas-seen=1" } });
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(await again.text()).not.toMatch(/<ol[^>]*data-first-visit/);
    // A reader cannot ask for the flourish, or another page for the cookie.
    expect(await (await get(server.url("/"), { headers: { cookie: "atlas-seen=1", "x-atlas-first-visit": "1" } })).text()).not.toMatch(/<ol[^>]*data-first-visit/);
    expect((await get(server.url("/highlights"))).headers.get("set-cookie")).toBeNull();
  });

  it("the Withheld Series is a row with its name and the reason, and nothing of its values, on either page", async () => {
    for (const path of ["/", "/highlights"]) {
      const text = words(main(await html(path)));
      expect(text).toContain("Fixture exchange index");
      expect(text).toContain("Withheld");
      expect(text).toContain("The licence does not allow redistribution.");
    }
    expect(await html("/")).not.toContain('data-sparkline="fx_exchange_index"');
    expect(await html("/highlights")).not.toContain("s=fx_exchange_index");
  });

  it("AC: every Highlights cell opens the Explorer at that window", async () => {
    const page = await html("/highlights");
    expect(page).toMatch(/<h1[^>]*>Highlights<\/h1>/);
    const cells = [...page.matchAll(/<a href="([^"]+)"[^>]*data-years="(\d+)"/g)].map((m) => ({ href: m[1]!.replace(/&amp;/g, "&"), years: Number(m[2]) }));
    // Six Series with a cadence, three spans each (the irregular one and the Withheld one have none).
    expect(cells).toHaveLength(18);
    for (const cell of cells) {
      const url = new URL(cell.href, server.origin);
      expect(url.pathname).toBe("/macro-atlas/explore");
      const [from, to] = [url.searchParams.get("from")!, url.searchParams.get("to")!];
      expect(from).toMatch(/^\d{4}-\d{2}$/);
      // The window is the span of the cell, to the month: N years, plus the Period's own length less a month.
      const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5));
      expect([cell.years * 12, cell.years * 12 + 2, cell.years * 12 + 11]).toContain(months);
      // And the Explorer opens there: the window's two fields say so, and the Series is the selected one.
      const explorer = await html(url.pathname.replace("/macro-atlas", "") + url.search);
      expect(explorer).toMatch(new RegExp(`<input[^>]*name="from"[^>]*value="${from}"`));
      expect(explorer).toMatch(new RegExp(`<input[^>]*name="to"[^>]*value="${to}"`));
      expect(explorer).toContain(`data-selected="${url.searchParams.get("s")}"`);
    }
    const text = words(main(page));
    expect(text).toContain("+5.2%");
    expect(text).toContain("\u22123.1 pts");
    expect(text).toContain("Break");
    expect(text).toContain("no fixed cadence");
  });

  it("AC: one query returns grouped hits for a series, an event and a glossary term, with no JavaScript", async () => {
    const page = await html("/search?q=change");
    const groups = [...page.matchAll(/<ul[^>]*data-group="([a-z]+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(["series", "event", "glossary"]);
    expect(page).toContain('href="/macro-atlas/data/fx_price_index_yoy"');
    expect(page).toContain('href="/macro-atlas/events/2024-09-18-fixture-rate-decision"');
    expect(page).toMatch(/href="\/macro-atlas\/docs\/glossary\/[a-z-]+"[^>]*>[^<]+<\/a>/);
    expect(page).toMatch(/<input[^>]*name="q"[^>]*value="change"/);
    // The sheet's answer is the page's, as JSON.
    const hits = (await (await get(server.url("/search/hits?q=change"))).json()) as { groups: { kind: string; hits: { id: string }[] }[] };
    expect(hits.groups.map((g) => g.kind)).toEqual(groups);
    expect(hits.groups[0]!.hits.map((h) => h.id)).toContain("fx_price_index_yoy");
  });

  it("search says so when nothing matches, and never puts what a reader typed into the page as markup", async () => {
    expect(await html("/search?q=zzzz")).toContain("Nothing matches");
    const page = await html(`/search?q=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(page).not.toContain("<script>alert(1)</script>");
    const hits = await get(server.url("/search/hits?q=" + encodeURIComponent("<b>")));
    expect(hits.headers.get("content-type")).toMatch(/application\/json/);
    expect(hits.headers.get("cache-control")).toBe("no-store");
  });

  it("the top bar of every page has the door to search, and Highlights and Search say where the reader is", async () => {
    for (const path of ["/", "/explore", "/data", "/highlights"]) expect(await html(path)).toMatch(/<a[^>]*href="\/macro-atlas\/search"[^>]*data-open-search/);
    expect(await html("/highlights")).toMatch(/aria-current="page"[^>]*>Highlights</);
    expect(await html("/search")).toMatch(/aria-current="page"[^>]*>Search</);
  });

  it("AC: no page, and no answer of search, holds a value of the Withheld Series (public-profile release, either surface)", async () => {
    // The fixture's Withheld Series has no file in the Release at all; its values are not there to leak.
    // What can be checked from outside: it is found by name, marked, and nothing dated or numeric rides with it.
    for (const from of [server, production]) {
      const hits = (await (await get(from.url("/search/hits?q=exchange"))).json()) as { groups: { kind: string; hits: Record<string, unknown>[] }[] };
      const hit = hits.groups.find((g) => g.kind === "series")!.hits[0]!;
      expect(hit).toEqual({ kind: "series", id: "fx_exchange_index", title: "Fixture exchange index", href: "/data/fx_exchange_index", detail: "Stands for a licensed index: listed by name, values withheld.", held: "withheld" });
    }
  });

  it("production: every headline Series is named with the reason and not one value, while no register row is signed (6.1)", async () => {
    for (const path of ["/", "/highlights", "/search?q=fixture", "/search/hits?q=fixture"]) {
      const response = await get(production.url(path));
      expect(response.status, path).toBe(200);
      const body = await response.text();
      // Seeds of the fixture's values: the price index's latest and year-earlier values, the poverty rate's, permits'.
      for (const seed of ["109.9", "104.5", "5.2%", "10.4", "566.4", "1651", "+11.3", "data-sparkline"]) expect(body, `${path}: ${seed}`).not.toContain(seed);
      expect(body).toContain("Fixture price index");
    }
    expect(words(main(await html("/highlights", production)))).toContain("Not shown here");
  });
});
