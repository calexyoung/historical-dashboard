import { describe, expect, it } from "vitest";
import { SEMANTICS_VERSION } from "@macro-atlas/core";
import { CURRENT_HEADER, FIRST_VISIT_HEADER, gate, RELEASE_HEADER, REFRESH_FAILED_HEADER, SEEN_COOKIE, TWIN_HEADER } from "./gate";
import { createRateLimiter } from "./rate-limit";
import type { Opened, OpenedRelease, ReleaseReader } from "./release/reader";

const release = { id: "20260201T000000Z-aaaaaaa" } as OpenedRelease;
const readerOf = (opened: Opened): ReleaseReader & { calls: number } => {
  const reader = {
    calls: 0,
    current: async () => (reader.calls++, opened),
    open: async () => opened,
  };
  return reader;
};
const good: Opened = { ok: true, release, refreshFailed: null };
const refused: Opened = { ok: false, kind: "refused", id: "20260202T000000Z-bbbbbbb", reason: "profile is local" };
const base = { surface: "production", dev: false, nonce: "N0nce" } as const;
const request = { host: "mydashboards.co", pathname: "/explore" };

describe("gate: what the proxy decides for every request", () => {
  it("reads CURRENT once and forwards the release id, the nonce and the policy to the app", async () => {
    const reader = readerOf(good);
    const decision = await gate({ ...base, reader }, request);
    expect(reader.calls).toBe(1);
    expect(decision.action).toBe("forward");
    if (decision.action !== "forward") return;
    expect(decision.requestHeaders[RELEASE_HEADER]).toBe(release.id);
    expect(decision.requestHeaders["x-nonce"]).toBe("N0nce");
    expect(decision.requestHeaders["content-security-policy"]).toContain("'nonce-N0nce'");
    expect(decision.requestHeaders[REFRESH_FAILED_HEADER]).toBeNull(); // null = remove what a client sent
    expect(decision.responseHeaders["content-security-policy"]).toBe(decision.requestHeaders["content-security-policy"]);
  });

  it("forwards the failed-refresh state with the release that is being served instead", async () => {
    const refreshFailed = { kind: "invalid", id: "20260202T000000Z-bbbbbbb", reason: "schema in catalog.json" } as const;
    const decision = await gate({ ...base, reader: readerOf({ ok: true, release, refreshFailed }) }, request);
    expect(decision.action === "forward" && JSON.parse(decision.requestHeaders[REFRESH_FAILED_HEADER]!)).toEqual(refreshFailed);
  });

  it.each(["/", "/explore", "/api/health", "/_next/static/chunks/a.js", "/no/such/page"])(
    "answers 503 on %s when the release is refused",
    async (pathname) => {
      const decision = await gate({ ...base, reader: readerOf(refused) }, { ...request, pathname });
      expect(decision).toMatchObject({ action: "respond", status: 503 });
      if (decision.action !== "respond") return;
      expect(decision.headers["cache-control"]).toBe("no-store");
      expect(decision.headers["retry-after"]).toBeDefined();
    },
  );

  it("fails the health check with the reason, as JSON", async () => {
    const decision = await gate({ ...base, reader: readerOf(refused) }, { ...request, pathname: "/api/health" });
    if (decision.action !== "respond") throw new Error("expected a response");
    expect(decision.headers["content-type"]).toMatch(/application\/json/);
    expect(JSON.parse(decision.body)).toEqual({
      status: "unavailable",
      surface: "production",
      kind: "refused",
      release_id: refused.ok ? null : refused.id,
      reason: "profile is local",
    });
  });

  it("says nothing about the reason to an ordinary reader", async () => {
    const decision = await gate({ ...base, reader: readerOf(refused) }, request);
    expect(decision.action === "respond" && decision.body).not.toContain("profile is local");
  });

  it("sends the security headers on every answer, including a 503", async () => {
    for (const reader of [readerOf(good), readerOf(refused)]) {
      const decision = await gate({ ...base, reader }, request);
      const headers = decision.action === "forward" ? decision.responseHeaders : decision.headers;
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"]).toBe("DENY");
    }
  });

  it("asks search engines to stay away from every surface but production", async () => {
    const robots = async (surface: "local" | "staging" | "production", host: string) => {
      const decision = await gate({ ...base, surface, reader: readerOf(good) }, { ...request, host });
      return decision.action === "forward" ? decision.responseHeaders["x-robots-tag"] : "not forwarded";
    };
    expect(await robots("staging", "mydashboards.co")).toBe("noindex");
    expect(await robots("local", "localhost:3000")).toBe("noindex");
    expect(await robots("production", "mydashboards.co")).toBeUndefined();
  });
});

describe("gate: a local-surface build answers only to this machine (PLAN 6.1, an added defence)", () => {
  const local = { ...base, surface: "local" } as const;

  it.each(["localhost", "localhost:3101", "127.0.0.1:3000", "[::1]:3000", "atlas.localhost:3000"])(
    "serves Host: %s",
    async (host) => {
      expect((await gate({ ...local, reader: readerOf(good) }, { ...request, host })).action).toBe("forward");
    },
  );

  it.each(["mydashboards.co", "mydashboards.co:443", "192.168.1.20:3000", "localhost.evil.example", "", null])(
    "refuses Host: %s without opening a release",
    async (host) => {
      const reader = readerOf(good);
      const decision = await gate({ ...local, reader }, { ...request, host });
      expect(decision).toMatchObject({ action: "respond", status: 421 });
      expect(reader.calls).toBe(0);
    },
  );

  it("a public surface answers to any host (Caddy decides that)", async () => {
    expect((await gate({ ...base, reader: readerOf(good) }, request)).action).toBe("forward");
  });
});

describe("gate: a twin's address goes to the twin handler, after every refusal (M17)", () => {
  const local = { surface: "local", dev: false, nonce: "N0nce" } as const;
  const TOKEN = "t0ken-only-this-process-knows";
  const ask = (pathname: string, twinToken: string | null = null) => gate({ ...base, twinToken: TOKEN, reader: readerOf(good) }, { host: "mydashboards.co", pathname, twinToken });

  it.each([
    ["/data/fx_price_index.csv", "/data/fx_price_index/twin/csv"],
    ["/data/fx_price_index.json", "/data/fx_price_index/twin/json"],
    ["/data/fx_price_index.metadata.json", "/data/fx_price_index/twin/metadata"],
    ["/data/fx_price_index.md", "/data/fx_price_index/twin/md"],
    // A Claim's twins (M21).
    ["/claims/2025-12-11-a-fixture-official-on-fixture-prices.json", "/claims/2025-12-11-a-fixture-official-on-fixture-prices/twin/json"],
    ["/claims/2025-12-11-a-fixture-official-on-fixture-prices.md", "/claims/2025-12-11-a-fixture-official-on-fixture-prices/twin/md"],
    ["/claims/2025-12-11-a-fixture-official-on-fixture-prices/evidence.csv", "/claims/2025-12-11-a-fixture-official-on-fixture-prices/twin/evidence"],
    ["/claims/2025-12-11-a-fixture-official-on-fixture-prices/lock.json", "/claims/2025-12-11-a-fixture-official-on-fixture-prices/twin/lock"],
  ])("%s is sent to %s, marked with the process's token", async (pathname, rewrite) => {
    const decision = await ask(pathname);
    expect(decision).toMatchObject({ action: "forward", rewrite });
    if (decision.action !== "forward") return;
    expect(decision.requestHeaders[TWIN_HEADER]).toBe(TOKEN);
    expect(decision.requestHeaders[RELEASE_HEADER]).toBe(release.id);
    // The pass Next then runs on that path lets it through, and only because of the token.
    expect((await ask(rewrite, TOKEN)).action === "forward" && (await ask(rewrite, TOKEN))).toMatchObject({ requestHeaders: { [TWIN_HEADER]: TOKEN } });
    expect("rewrite" in (await ask(rewrite, TOKEN))).toBe(false);
  });

  it.each(["/data/fx_price_index", "/data", "/explore", "/data/fx_price_index.xml", "/data/a/b.csv"])("%s is left as it is, and a token a client sent is removed", async (pathname) => {
    for (const sent of [null, TOKEN, "guess"]) {
      const decision = await ask(pathname, sent);
      expect(decision.action === "forward" && decision.rewrite).toBeUndefined();
      expect(decision.action === "forward" && decision.requestHeaders[TWIN_HEADER]).toBeNull();
    }
  });

  it.each(["/data/fx_price_index/twin", "/data/fx_price_index/twin/csv", "/data/x/twin/metadata", "/data/fx_price_index/twin/csv/more", "/claims/2025-12-11-a-fixture-official-on-fixture-prices/twin/json", "/claims/x/twin", "/claims/x/twin/lock/more"])("the handler's own path, %s, is not an address: without the token it is sent nowhere", async (pathname) => {
    for (const sent of [null, "", "guess", `${TOKEN}x`]) {
      const decision = await ask(pathname, sent);
      expect(decision).toMatchObject({ action: "forward", rewrite: "/not-found/not-an-address" });
      expect(decision.action === "forward" && decision.requestHeaders[TWIN_HEADER]).toBeNull();
    }
  });

  it("keeps the Host the reader named across the second pass, and never one a client sent", async () => {
    const first = await gate({ ...base, twinToken: TOKEN, reader: readerOf(good) }, { host: "mydashboards.co", pathname: "/data/fx_price_index.csv", namedHost: "evil.example" });
    expect(first.action === "forward" && first.requestHeaders["x-atlas-host"]).toBe("mydashboards.co");
    const second = await gate({ ...base, twinToken: TOKEN, reader: readerOf(good) }, { host: "localhost:3000", pathname: "/data/fx_price_index/twin/csv", twinToken: TOKEN, namedHost: "mydashboards.co" });
    expect(second.action === "forward" && second.requestHeaders["x-atlas-host"]).toBe("mydashboards.co");
    const page = await gate({ ...base, twinToken: TOKEN, reader: readerOf(good) }, { host: "mydashboards.co", pathname: "/data/fx_price_index", namedHost: "evil.example", twinToken: TOKEN });
    expect(page.action === "forward" && page.requestHeaders["x-atlas-host"]).toBe("mydashboards.co");
  });

  it("a gate that was given no token serves no twin at all", async () => {
    for (const sent of [null, "", "undefined"]) {
      const decision = await gate({ ...base, reader: readerOf(good) }, { host: "mydashboards.co", pathname: "/data/fx_price_index/twin/csv", twinToken: sent });
      expect(decision).toMatchObject({ rewrite: "/not-found/not-an-address" });
    }
    expect(await gate({ ...base, reader: readerOf(good) }, { host: "mydashboards.co", pathname: "/data/fx_price_index.csv" })).toMatchObject({ rewrite: "/not-found/not-an-address" });
  });

  it("a twin is refused exactly as its page is: 503 with no release, 421 off this machine", async () => {
    const none = await gate({ ...base, twinToken: TOKEN, reader: readerOf(refused) }, { host: "mydashboards.co", pathname: "/data/fx_price_index.csv" });
    expect(none).toMatchObject({ action: "respond", status: 503 });
    const elsewhere = await gate({ ...local, twinToken: TOKEN, reader: readerOf(good) }, { host: "example.com", pathname: "/data/fx_price_index.csv" });
    expect(elsewhere).toMatchObject({ action: "respond", status: 421 });
  });
});

describe("gate: a pinned view (M18)", () => {
  const PIN = "20260115T000000Z-ccccccc";
  const pinnedRelease = { id: PIN } as OpenedRelease;
  const readerWith = (current: Opened, pinned: Opened): ReleaseReader & { asked: string[] } => {
    const reader = { asked: [] as string[], current: async () => current, open: async () => current, pinned: async (id: string) => (reader.asked.push(id), pinned) };
    return reader;
  };
  const config = { ...base, basePath: "/macro-atlas" };
  const explore = { host: "mydashboards.co", pathname: "/explore", search: `?s=unrate&mode=z&pin=${PIN}` };

  it("fixes the request to the Release the address names, and says which is current", async () => {
    const reader = readerWith(good, { ok: true, release: pinnedRelease, refreshFailed: null });
    const decision = await gate({ ...config, reader }, explore);
    if (decision.action !== "forward") throw new Error("expected forward");
    expect(reader.asked).toEqual([PIN]);
    expect(decision.requestHeaders[RELEASE_HEADER]).toBe(PIN);
    expect(decision.requestHeaders[CURRENT_HEADER]).toBe(release.id);
  });

  it("takes a pin on the Explorer and its export only; elsewhere the address is answered from CURRENT as before", async () => {
    const reader = readerWith(good, { ok: true, release: pinnedRelease, refreshFailed: null });
    const exported = await gate({ ...config, reader }, { ...explore, pathname: "/explore/export" });
    expect(exported.action === "forward" && exported.requestHeaders[RELEASE_HEADER]).toBe(PIN);
    for (const pathname of ["/data/unrate", "/data", "/api/health", "/"]) {
      const decision = await gate({ ...config, reader }, { ...explore, pathname });
      if (decision.action !== "forward") throw new Error("expected forward");
      expect(decision.requestHeaders[RELEASE_HEADER]).toBe(release.id);
      expect(decision.requestHeaders[CURRENT_HEADER]).toBeNull(); // null removes what a client sent
    }
    expect(reader.asked).toEqual([PIN]);
  });

  it("answers 410 Gone once retention no longer keeps the Release, with a link to the same view on the current one and no data", async () => {
    const reader = readerWith(good, { ok: false, kind: "gone", id: PIN, reason: "no longer kept" });
    const decision = await gate({ ...config, reader }, { ...explore, pathname: "/explore/export", search: `?format=csv&s=unrate&mode=z&pin=${PIN}` });
    expect(decision).toMatchObject({ action: "respond", status: 410 });
    if (decision.action !== "respond") return;
    expect(decision.body).toContain('href="/macro-atlas/explore?s=unrate&#38;mode=z"');
    expect(decision.body).toContain(PIN);
    expect(decision.headers["cache-control"]).toBe("no-store");
    expect(decision.headers["content-security-policy"]).toBeDefined();
  });

  it.each(["refused", "invalid", "unavailable"] as const)("answers 503, never CURRENT's data, when the pinned Release is %s", async (kind) => {
    const decision = await gate({ ...config, reader: readerWith(good, { ok: false, kind, id: PIN, reason: "x" }) }, explore);
    expect(decision).toMatchObject({ action: "respond", status: 503 });
  });

  it.each(["pin=latest", "pin=", `pin=${PIN}&pin=${PIN}`, `pin=${PIN}%0A`, "pin=../../etc"])("refuses %s with 400 and opens nothing", async (search) => {
    const reader = readerWith(good, { ok: true, release: pinnedRelease, refreshFailed: null });
    const decision = await gate({ ...config, reader }, { ...explore, search: `?s=unrate&${search}` });
    expect(decision).toMatchObject({ action: "respond", status: 400 });
    expect(reader.asked).toEqual([]);
  });

  it("still fails closed on CURRENT: a pin does not get a request past a root that may not be served", async () => {
    const reader = readerWith(refused, { ok: true, release: pinnedRelease, refreshFailed: null });
    expect(await gate({ ...config, reader }, explore)).toMatchObject({ action: "respond", status: 503 });
    expect(reader.asked).toEqual([]);
  });

  it("a pin to the Release that is current is that Release, and still a pinned view", async () => {
    const reader = readerWith(good, { ok: false, kind: "gone", id: release.id, reason: "" });
    const decision = await gate({ ...config, reader }, { ...explore, search: `?pin=${release.id}` });
    if (decision.action !== "forward") throw new Error("expected forward");
    expect(decision.requestHeaders[RELEASE_HEADER]).toBe(release.id);
    expect(decision.requestHeaders[CURRENT_HEADER]).toBe(release.id);
  });

  it("the failed-refresh state belongs to CURRENT and is not carried onto a pinned Release", async () => {
    const refreshFailed = { kind: "invalid", id: "20260202T000000Z-bbbbbbb", reason: "x" } as const;
    const reader = readerWith({ ok: true, release, refreshFailed }, { ok: true, release: pinnedRelease, refreshFailed: null });
    const decision = await gate({ ...config, surface: "local", reader }, { ...explore, host: "localhost:3000" });
    expect(decision.action === "forward" && decision.requestHeaders[REFRESH_FAILED_HEADER]).toBeNull();
  });
});

describe("gate: a reader's first visit to the Overview (PLAN section 8; ADR 0036)", () => {
  const overview = { host: "mydashboards.co", pathname: "/", method: "GET" };
  const config = { ...base, reader: readerOf(good), basePath: "/macro-atlas" };
  const forwarded = async (over: Partial<Parameters<typeof gate>[1]> = {}, more: Partial<typeof config> = {}) => {
    const decision = await gate({ ...config, ...more }, { ...overview, ...over });
    if (decision.action !== "forward") throw new Error("expected the request to be forwarded");
    return decision;
  };

  it("tells the page it is a first visit, from the request itself, and remembers the visit", async () => {
    const decision = await forwarded();
    expect(decision.requestHeaders[FIRST_VISIT_HEADER]).toBe("1");
    expect(decision.responseHeaders["set-cookie"]).toBe(`${SEEN_COOKIE}=1; Path=/macro-atlas; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  });

  it("says nothing on a later visit, and removes what a client sent in the header's name", async () => {
    const decision = await forwarded({ cookie: `atlas-theme=dark; ${SEEN_COOKIE}=1` });
    expect(decision.requestHeaders[FIRST_VISIT_HEADER]).toBeNull();
    expect(decision.responseHeaders["set-cookie"]).toBeUndefined();
  });

  it("is about the Overview only, and only a reader's own GET: not a prefetch, a HEAD or another page", async () => {
    for (const over of [{ pathname: "/highlights" }, { pathname: "/explore" }, { method: "HEAD" }, { method: "POST" }, { prefetch: true }]) {
      const decision = await forwarded(over);
      expect(decision.requestHeaders[FIRST_VISIT_HEADER]).toBeNull();
      expect(decision.responseHeaders["set-cookie"]).toBeUndefined();
    }
  });

  it("marks the cookie Secure where the reader came over HTTPS, and keeps it to its own base path", async () => {
    const decision = await forwarded({ secure: true }, { basePath: "/macro-atlas-staging" });
    expect(decision.responseHeaders["set-cookie"]).toBe(`${SEEN_COOKIE}=1; Path=/macro-atlas-staging; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`);
  });

  it("sets nothing when there is no Release to serve", async () => {
    const decision = await gate({ ...config, reader: readerOf(refused) }, overview);
    expect(decision).toMatchObject({ action: "respond", status: 503 });
    if (decision.action === "respond") expect(decision.headers["set-cookie"]).toBeUndefined();
  });
});

describe("gate: rate limits on the read API and on files (PLAN section 7, M24)", () => {
  const TOKEN = "t0ken-only-this-process-knows";
  const held = { id: release.id, manifest: { created: "2026-02-01T00:00:00Z", profile: "public", sources: [{ producer: "An agency", via: "direct", fetched: "2026-02-01T00:00:00Z", outcome: "ok" }] } } as unknown as OpenedRelease;
  const open: Opened = { ok: true, release: held, refreshFailed: null };
  /** One token for each address and plenty for everybody, unless told otherwise. */
  const limiter = (address = 1, global = 100) => createRateLimiter({ address: { burst: address, perSecond: 0.1 }, global: { burst: global, perSecond: 0.1 }, maxAddresses: 10, clock: () => 0 });
  const config = (l = limiter(), opened: Opened = open) => ({ ...base, twinToken: TOKEN, reader: readerOf(opened), limiter: l });
  const from = (pathname: string, forwardedFor: string | null = "203.0.113.7", more: Record<string, unknown> = {}) => ({ host: "mydashboards.co", pathname, forwardedFor, ...more });

  const LIMITED = [
    "/api/v1",
    "/api/v1/catalog.json",
    "/api/v1/series/fx_price_index",
    "/api/v1/series/fx_price_index/vintages",
    "/api/v1/events.json",
    "/api/v1/claims.json",
    "/api/v1/status",
    "/api/v1/no/such/route",
    "/data/fx_price_index.csv",
    "/data/fx_price_index.json",
    "/data/fx_price_index.metadata.json",
    "/data/fx_price_index.md",
    "/claims/2025-12-11-a-fixture-official-on-fixture-prices.json",
    "/claims/2025-12-11-a-fixture-official-on-fixture-prices/evidence.csv",
    "/explore/export",
  ];

  it.each(LIMITED)("%s: the request over the limit gets 429, with how long to wait and nothing stored", async (pathname) => {
    const c = config();
    expect((await gate(c, from(pathname))).action).toBe("forward");
    const over = await gate(c, from(pathname));
    expect(over).toMatchObject({ action: "respond", status: 429 });
    if (over.action !== "respond") return;
    expect(over.headers["retry-after"]).toBe("10");
    expect(over.headers["cache-control"]).toBe("no-store");
    expect(over.headers["x-content-type-options"]).toBe("nosniff"); // the security headers, as on every answer
  });

  it.each(["/", "/explore", "/data", "/data/fx_price_index", "/claims", "/search", "/search/hits", "/docs/api", "/api/health", "/api/theme", "/_next/static/chunks/a.js", "/api/v10", "/api/v1x/catalog.json"])("%s is not limited: a page, the health check and the app's own files always answer", async (pathname) => {
    const c = config(limiter(0, 0));
    for (let i = 0; i < 3; i++) expect((await gate(c, from(pathname))).action).toBe("forward");
  });

  it("an API answer over the limit is JSON and carries the fields every API body carries", async () => {
    const c = config();
    await gate(c, from("/api/v1/catalog.json"));
    const over = await gate(c, from("/api/v1/catalog.json"));
    if (over.action !== "respond") throw new Error("expected a response");
    expect(over.headers["content-type"]).toMatch(/application\/json/);
    const body = JSON.parse(over.body);
    expect(body).toMatchObject({
      error: { status: 429, code: "rate_limited", retry_after_seconds: 10 },
      release_id: release.id,
      semantics_version: SEMANTICS_VERSION,
      provenance: { publisher: "Macro Atlas", release: { id: release.id, created: "2026-02-01T00:00:00Z", profile: "public" } },
      rights: { permission: "none" },
    });
    expect(body.error.message).toMatch(/this address/);
  });

  it("a .json twin over the limit is JSON too; any other file is a line of text", async () => {
    const c = config(limiter(0));
    const json = await gate(c, from("/data/fx_price_index.json"));
    expect(json.action === "respond" && JSON.parse(json.body)).toMatchObject({ error: { status: 429, code: "rate_limited" }, release_id: release.id });
    const csv = await gate(c, from("/data/fx_price_index.csv"));
    expect(csv.action === "respond" && csv.headers["content-type"]).toMatch(/text\/plain/);
    expect(csv.action === "respond" && csv.body).toMatch(/Too many requests.*10 seconds/);
  });

  it("counts by the address the nearest proxy wrote: another address is still answered", async () => {
    const c = config();
    await gate(c, from("/api/v1/status", "198.51.100.9, 203.0.113.7"));
    // What a client wrote in front of it changes nothing.
    expect(await gate(c, from("/api/v1/status", "10.9.9.9, 203.0.113.7"))).toMatchObject({ status: 429 });
    expect((await gate(c, from("/api/v1/status", "203.0.113.8"))).action).toBe("forward");
    // With no proxy in front, every request shares one bucket.
    expect((await gate(c, from("/api/v1/status", null))).action).toBe("forward");
    expect(await gate(c, from("/api/v1/status", null))).toMatchObject({ status: 429 });
  });

  it("says so when it is everybody's limit that is spent", async () => {
    const c = config(limiter(5, 1));
    await gate(c, from("/api/v1/status"));
    const over = await gate(c, from("/api/v1/status", "203.0.113.8"));
    expect(over.action === "respond" && JSON.parse(over.body).error.message).toMatch(/every address together/);
  });

  it("a twin is counted once: the pass Next runs on the handler's own path spends nothing", async () => {
    const l = limiter(2);
    const c = config(l);
    const first = await gate(c, from("/data/fx_price_index.csv"));
    expect(first).toMatchObject({ action: "forward", rewrite: "/data/fx_price_index/twin/csv" });
    for (let i = 0; i < 5; i++) expect(await gate(c, from("/data/fx_price_index/twin/csv", "203.0.113.7", { twinToken: TOKEN }))).toMatchObject({ action: "forward" });
    expect((await gate(c, from("/data/fx_price_index.csv"))).action).toBe("forward"); // the second of two
    expect(await gate(c, from("/data/fx_price_index.csv"))).toMatchObject({ status: 429 });
  });

  it("the handler's own path asked for directly is not found, and is not a way to spend or to dodge the limit", async () => {
    const c = config(limiter(1));
    for (let i = 0; i < 3; i++) expect(await gate(c, from("/data/fx_price_index/twin/csv", "203.0.113.7", { twinToken: "guess" }))).toMatchObject({ rewrite: "/not-found/not-an-address" });
    expect((await gate(c, from("/data/fx_price_index.csv"))).action).toBe("forward");
  });

  it("the refusals of a build come first and spend nothing (503 with no release, 421 off this machine); the limit is said before a pinned Release is looked for", async () => {
    const l = limiter(1);
    for (let i = 0; i < 3; i++) expect(await gate({ ...config(l, refused) }, from("/api/v1/catalog.json"))).toMatchObject({ status: 503 });
    for (let i = 0; i < 3; i++) expect(await gate({ ...config(l), surface: "local" }, { ...from("/api/v1/catalog.json"), host: "example.com" })).toMatchObject({ status: 421 });
    expect((await gate(config(l), from("/api/v1/catalog.json"))).action).toBe("forward");
    // Spent now: the limit is said before a pinned Release is looked for.
    let looked = 0;
    const reader = { ...readerOf(open), pinned: async () => (looked++, open) };
    expect(await gate({ ...config(l), reader }, from("/explore/export", "203.0.113.7", { search: "?pin=20260101T000000Z-0000000" }))).toMatchObject({ status: 429 });
    expect(looked).toBe(0);
  });

  it("a gate that was given no limiter limits nothing", async () => {
    for (let i = 0; i < 3; i++) expect((await gate({ ...base, reader: readerOf(open) }, from("/api/v1/catalog.json"))).action).toBe("forward");
  });
});
