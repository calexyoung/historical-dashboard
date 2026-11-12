import { describe, expect, it } from "vitest";
import { gate, RELEASE_HEADER, REFRESH_FAILED_HEADER, TWIN_HEADER } from "./gate";
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

  it.each(["/data/fx_price_index/twin", "/data/fx_price_index/twin/csv", "/data/x/twin/metadata", "/data/fx_price_index/twin/csv/more"])("the handler's own path, %s, is not an address: without the token it is sent nowhere", async (pathname) => {
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
