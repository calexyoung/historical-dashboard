/**
 * M1's acceptance criteria, checked against real production builds over HTTP.
 * (PLAN section 10, M1; section 6.1.)
 */
import { rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "@/lib/release/testing";
import { startVariant, type Running } from "./builds";

const A = "20260201T000000Z-aaaaaaa";
const B = "20260202T000000Z-bbbbbbb";
const LOCAL = "20260203T000000Z-ccccccc";
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

  it("sends the front door to /explore until the Overview exists", async () => {
    for (const server of servers) {
      const response = await get(server.url("/"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${server.base}/explore`);
    }
  });

  it("each build serves only its own base path", async () => {
    expect((await get(`${servers[0]!.origin}/macro-atlas-staging/explore`)).status).toBe(404);
    expect((await get(`${servers[1]!.origin}/macro-atlas/explore`)).status).toBe(404);
  });

  it("shows only tabs whose pages exist, and marks the current one", async () => {
    const html = await (await get(servers[0]!.url("/explore"))).text();
    const nav = html.slice(html.indexOf('<nav aria-label="Sections"'), html.indexOf("</nav>", html.indexOf('<nav aria-label="Sections"')));
    expect([...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual(["Explore"]);
    expect(nav).toContain('aria-current="page"');
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
  const PATHS = ["/", "/explore", "/explore/", "/api/health", "/api/theme", "/icon.svg", "/_next/static/chunks/x.js", "/no/such/page"];

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
      const response = await get(server.url(path), { method, headers: { "x-atlas-release": A } });
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
