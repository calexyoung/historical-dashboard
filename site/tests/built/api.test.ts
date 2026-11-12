/**
 * The read API over HTTP (PLAN section 7 and M24; docs/method/api.md), against real production
 * builds: every route of `/api/v1` answers as its contract says, an invalid question gets 400
 * with the allowlist, and a request over the limit gets 429. The contract of each route in full
 * is `src/lib/api/api.test.ts`; this file checks that what is served is that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import { addRelease, FIXTURE_ID, FIXTURE_ROOT, promote, tempRoot } from "@/lib/release/testing";
import { LIMITS } from "@/lib/rate-limit";
import { startVariant, type Running } from "./builds";

const CLAIM = "2025-12-11-a-fixture-official-on-fixture-prices";
const get = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });
/** As a reverse proxy in front would send it: the address it saw, in X-Forwarded-For. */
const from = (address: string): RequestInit => ({ headers: { "x-forwarded-for": address } });

const ROUTES = [
  "/api/v1",
  "/api/v1/catalog.json",
  "/api/v1/series/fx_price_index",
  "/api/v1/series/fx_price_index?transform=pc1&start=2025-01-01",
  "/api/v1/series/fx_price_index?as_of=2025-12-13",
  "/api/v1/series/fx_price_index/vintages",
  "/api/v1/series/fx_price_index/vintages?period=2025-11",
  "/api/v1/events.json",
  "/api/v1/claims.json",
  "/api/v1/status",
];
const REFUSED: [number, string][] = [
  [400, "/api/v1/catalog.json?q=price"],
  [400, "/api/v1/series/fx_price_index?transform=cube"],
  [400, "/api/v1/series/fx_nothing"],
  [400, "/api/v1/series/fx_price_index/vintages?page=0"],
  [400, "/api/v1/events.json?cat=weather"],
  [400, "/api/v1/claims.json?party=whig"],
  [400, "/api/v1/status?x=1"],
  [403, "/api/v1/series/fx_exchange_index"],
  [403, "/api/v1/series/fx_exchange_index/vintages"],
  [404, "/api/v1/nothing"],
  [404, "/api/v1/series"],
  [404, "/api/v1/series/fx_price_index/vintages/2025-11"],
  [404, "/api/v1/catalog"],
];

describe("the read API on a local build of the fixture release", () => {
  let server: Running;
  let renamed: Running;
  const root = tempRoot();
  beforeAll(async () => {
    server = await startVariant("local-staging", { root: FIXTURE_ROOT });
    addRelease(root, { id: "20260201T000000Z-2222222", edit: { fx_permits_stale: (_, entry) => (entry.aliases = ["fx_old_permits"]) } });
    promote(root, "20260201T000000Z-2222222");
    renamed = await startVariant("local-atlas", { root });
  });
  afterAll(() => Promise.all([server.stop(), renamed.stop()]));

  it.each(ROUTES)("%s answers 200 as JSON with the four fields, and is not kept by a cache", async (path) => {
    const response = await get(server.url(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull(); // no other site's script may read a local build
    const body = await response.json();
    expect(body).toMatchObject({ release_id: FIXTURE_ID, semantics_version: SEMANTICS_VERSION });
    expect(body.provenance).toBeTypeOf("object");
    expect(typeof body.rights.permission).toBe("string");
  });

  it.each(REFUSED)("%i for %s, as JSON with the four fields and an error", async (status, path) => {
    const response = await get(server.url(path));
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ error: { status }, release_id: FIXTURE_ID, semantics_version: SEMANTICS_VERSION });
    expect(body.provenance).toBeTypeOf("object");
    expect(body.rights).toBeTypeOf("object");
    if (status === 400) expect(body.error.allowed, path).toBeTypeOf("object");
  });

  it("invalid input gets 400 with the allowlist (M24's third criterion)", async () => {
    const transform = await (await get(server.url("/api/v1/series/fx_price_index?transform=cube"))).json();
    expect(transform.error.allowed.transform).toEqual(["lin", "chg", "ch1", "pch", "pc1", "pca", "log", "rebase", "z", "drawdown"]);
    expect(transform.error.message).toContain("transform: one of lin, chg");
    const key = await (await get(server.url("/api/v1/series/fx_nothing"))).json();
    expect(key.error).toMatchObject({ code: "unknown_series" });
    expect(key.error.allowed.series).toContain("fx_price_index");
  });

  it("gives the values the page and its .json file give, at the address the reader used", async () => {
    const api = await (await get(server.url("/api/v1/series/fx_price_index?as_of=2025-12-13"))).json();
    const twin = await (await get(server.url("/data/fx_price_index.json?as_of=2025-12-13"))).json();
    expect(api.observations).toEqual(twin.observations);
    expect(api).toMatchObject({ basis: "uncertain", capture_gap: { missed_days: 1 }, same_day_release: false, notice: expect.stringContaining("NOT FOR PUBLICATION") });
    expect(api.links.self).toBe(`${server.origin}/macro-atlas-staging/api/v1/series/fx_price_index?as_of=2025-12-13`);
    const index = await (await get(server.url("/api/v1"))).json();
    expect(index.documentation).toBe(`${server.origin}/macro-atlas-staging/docs/api`);
    // Every address the index gives is one this build answers.
    for (const route of index.routes) expect((await get(route.address.replace("{key}", "fx_price_index"))).status, route.path).toBe(200);
  });

  it("the history of one Period, and the Claims with where their evidence is", async () => {
    const history = await (await get(server.url("/api/v1/series/fx_price_index/vintages?period=2025-11"))).json();
    expect(history.versions.map((v: { value: number }) => v.value)).toEqual([109.5, 109.3]);
    const claims = await (await get(server.url("/api/v1/claims.json"))).json();
    expect(claims.claims[0]).toMatchObject({ id: CLAIM, evidence_state: "held" });
    expect((await get(claims.claims[0].twins.evidence_csv)).status).toBe(200);
    const events = await (await get(server.url("/api/v1/events.json?cat=policy"))).json();
    expect(events).toMatchObject({ count: 1, events: [{ id: "2024-09-18-fixture-rate-decision" }] });
  });

  it("answers GET and HEAD only", async () => {
    const head = await get(server.url("/api/v1/catalog.json"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await get(server.url("/api/v1/catalog.json"), { method })).status, method).toBe(405);
  });

  it("a renamed key answers 308 to the permanent one under the base path, and the history keeps its own address", async () => {
    const response = await get(renamed.url("/api/v1/series/fx_old_permits?start=2024-01-01"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/macro-atlas/api/v1/series/fx_permits_stale?start=2024-01-01");
    expect((await get(renamed.url("/api/v1/series/fx_old_permits/vintages"))).headers.get("location")).toBe("/macro-atlas/api/v1/series/fx_permits_stale/vintages");
    expect((await get(`${renamed.origin}${response.headers.get("location")}`)).status).toBe(200);
  });
});

describe("the read API on a production build", () => {
  let server: Running;
  const root = tempRoot();
  const A = "20260201T000000Z-aaaaaaa";
  const LOCAL = "20260203T000000Z-ccccccc";
  beforeAll(async () => {
    addRelease(root, { id: A });
    addRelease(root, { id: LOCAL, profile: "local", signed: false, legacy: "fx_price_index", rename: { key: "fx_price_index", name: "SEEDED-FRED-VALUE-1234.5" } });
    promote(root, A);
    server = await startVariant("production", { root });
  });
  afterAll(() => server.stop());

  it("hands out no value while no row is signed for its Origin: 403 with the reason, never kept", async () => {
    for (const path of ["/api/v1/series/fx_price_index", "/api/v1/series/fx_price_index?as_of=2025-12-13", "/api/v1/series/fx_price_index/vintages", "/api/v1/series/fx_price_index_yoy"]) {
      const response = await get(server.url(path));
      expect(response.status, path).toBe(403);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      const text = await response.text();
      expect(text, path).not.toMatch(/109\.[359]/);
      expect(JSON.parse(text), path).toMatchObject({ error: { code: "not_permitted" }, rights: { permission: "redistribute", permitted: false }, release_id: A });
    }
  });

  it("the catalog names every Series and says nothing of how far a refused one runs; the claims list names no file of figures", async () => {
    const catalog = await (await get(server.url("/api/v1/catalog.json"))).json();
    expect(catalog.count).toBe(11);
    expect(catalog.series.every((s: { coverage: unknown; state: string }) => s.coverage === null && s.state !== "shown")).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/2025-12|109\.9/);
    const claims = await (await get(server.url("/api/v1/claims.json"))).json();
    expect(claims.claims[0]).toMatchObject({ evidence_state: "not_permitted", twins: {} });
  });

  it("an answer the gate allowed may be kept for five minutes and is compared by its own bytes; the status never", async () => {
    const response = await get(server.url("/api/v1/catalog.json"));
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const etag = response.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const again = await get(server.url("/api/v1/catalog.json"), { headers: { "if-none-match": etag! } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect((await get(server.url("/api/v1/catalog.json"), { headers: { "if-none-match": '"something-else"' } })).status).toBe(200);
    // A refusal is compared with nothing: a validator never turns a 403 into "you already have it".
    expect((await get(server.url("/api/v1/series/fx_price_index"), { headers: { "if-none-match": "*" } })).status).toBe(403);
    const status = await get(server.url("/api/v1/status"));
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(status.headers.get("etag")).toBeNull();
  });

  it("fails closed with the rest of the build: 503 on every route, with nothing of the Release in it, the moment CURRENT may not be served (PLAN 6.1)", async () => {
    promote(root, LOCAL);
    try {
      for (const path of [...ROUTES, ...REFUSED.map(([, p]) => p)]) {
        for (const init of [{}, { headers: { "if-none-match": "*", "x-atlas-release": A } }, { method: "HEAD" }]) {
          const response = await get(server.url(path), init);
          expect(response.status, path).toBe(503);
          const text = await response.text();
          expect(text, path).not.toMatch(/SEEDED-FRED-VALUE|fx_price_index"|release_id/);
        }
      }
    } finally {
      promote(root, A);
    }
    expect((await get(server.url("/api/v1/catalog.json"))).status).toBe(200);
  });
});

describe("rate limits over HTTP (M24's second criterion: over-limit requests get 429)", () => {
  // A server of its own: what this spends, nothing else in the suite is waiting for.
  let server: Running;
  beforeAll(async () => {
    server = await startVariant("local-atlas", { root: FIXTURE_ROOT });
  });
  afterAll(() => server.stop());

  const burst = LIMITS.address.burst;
  /** One after another, so the order is the order they were counted in. */
  const ask = async (path: string, address: string, times: number): Promise<Response[]> => {
    const out: Response[] = [];
    for (let i = 0; i < times; i++) out.push(await get(server.url(path), from(address)));
    return out;
  };

  it("an address that asks for more than its burst gets 429 with Retry-After, as JSON with the four fields; another address is still answered", async () => {
    const answers = await ask("/api/v1", "203.0.113.7", burst + 60);
    const statuses = answers.map((r) => r.status);
    expect(statuses.slice(0, burst).every((s) => s === 200)).toBe(true);
    expect(new Set(statuses)).toEqual(new Set([200, 429]));
    const over = answers.find((r) => r.status === 429)!;
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(over.headers.get("cache-control")).toBe("no-store");
    expect(over.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await over.json()).toMatchObject({ error: { status: 429, code: "rate_limited" }, release_id: FIXTURE_ID, semantics_version: SEMANTICS_VERSION, provenance: { publisher: "Macro Atlas" }, rights: { permission: "none" } });

    // Still over, on every route and every file; what a client writes in front of its address changes nothing.
    for (const path of ["/api/v1/catalog.json", "/api/v1/series/fx_price_index", "/api/v1/status", "/data/fx_price_index.csv", "/data/fx_price_index.json", `/claims/${CLAIM}/evidence.csv`, "/explore/export?format=csv&s=fx_price_index"]) {
      expect((await get(server.url(path), from("203.0.113.7"))).status, path).toBe(429);
      expect((await get(server.url(path), from("198.51.100.99, 203.0.113.7"))).status, path).toBe(429);
    }
    const file = await get(server.url("/data/fx_price_index.csv"), from("203.0.113.7"));
    expect(file.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await file.text()).toMatch(/^Too many requests/);

    // Pages and the health check are not counted, for the same address.
    for (const path of ["/", "/data/fx_price_index", "/explore", "/docs/api", "/api/health"]) expect((await get(server.url(path), from("203.0.113.7"))).status, path).toBe(200);
    // Another address, and another subscriber's IPv6 network, have their own.
    expect((await get(server.url("/api/v1"), from("203.0.113.8"))).status).toBe(200);
    expect((await get(server.url("/api/v1"), from("2001:db8:1:2::1"))).status).toBe(200);
  });

  it("a twin is counted once, though the app passes it through the proxy twice", async () => {
    const answers = await ask("/data/fx_price_index.csv", "203.0.113.20", burst - 10);
    // Counted twice, the bucket would have been empty a little after half of these.
    expect(answers.every((r) => r.status === 200)).toBe(true);
  });

  it("an IPv6 address shares the bucket of its /64", async () => {
    const first = await ask("/api/v1", "2001:db8:aaaa:bbbb::1", burst);
    expect(first.every((r) => r.status === 200)).toBe(true);
    const neighbour = await ask("/api/v1", "2001:db8:aaaa:bbbb:1234:5678:9abc:def0", 20);
    expect(neighbour.some((r) => r.status === 429)).toBe(true);
  });
});
