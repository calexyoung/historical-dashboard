import { describe, expect, it } from "vitest";
import { gate, RELEASE_HEADER, REFRESH_FAILED_HEADER } from "./gate";
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
