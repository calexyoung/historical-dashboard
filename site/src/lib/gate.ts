/**
 * The gate: what the proxy decides for every request, before any route runs.
 *
 * 1. A local-surface build answers only to this machine's own names. It may hold v1's data
 *    (PLAN 6.1), so a copy that ends up behind a public reverse proxy must not answer.
 * 2. CURRENT is read here, once per request. If no Release may be served, every path gets 503,
 *    the health check included; nothing downstream runs.
 * 3. Otherwise the request goes on with the release id fixed in a header. Pages and route
 *    handlers open exactly that Release and never read CURRENT, so everything in one response
 *    comes from one Release.
 * 4. A twin's address (`/data/{key}.csv`) goes on to the twin handler, whose own path is not an
 *    address. Next runs the proxy again on the path a request was sent to, so the first pass
 *    marks the request with a token only this process knows; the handler's path is let through
 *    only with that token, and asked for directly it is not found. All of it is decided here,
 *    after 1 and 2, so a twin is refused exactly as its page is.
 *
 * Pure apart from the reader it is given; `proxy.ts` is the thin Next adapter around it.
 */
import type { Surface } from "@macro-atlas/core";
import { buildCsp } from "./csp";
import type { ReleaseReader } from "./release/reader";
import { internalTwinPath, twinOf, twinRoute } from "./twin/address";

export const RELEASE_HEADER = "x-atlas-release";
export const REFRESH_FAILED_HEADER = "x-atlas-refresh-failed";
export const NONCE_HEADER = "x-nonce";
export const PATH_HEADER = "x-atlas-path";
/**
 * Carries the proxy's own token from the pass that recognised a twin's address to the pass Next
 * then runs on the path it was sent to. Whatever a client sent under this name is removed.
 */
export const TWIN_HEADER = "x-atlas-twin";
/**
 * The Host the reader named. Next gives the second pass its own name for the server, so the
 * first pass's answer is kept; whatever a client sent under this name is replaced.
 */
export const HOST_HEADER = "x-atlas-host";
/** Where a path that is the app's own, and not an address, is sent: nowhere, so it is not found. */
export const NOT_AN_ADDRESS = "/not-found/not-an-address";

export type Decision =
  | {
      action: "forward";
      /** Set on the request that reaches the app. `null` removes whatever a client sent. */
      requestHeaders: Record<string, string | null>;
      responseHeaders: Record<string, string>;
      /**
       * Serve this path of the app instead (without the base path): a twin's address, which has
       * a suffix no page route can carry, goes to the one handler that answers twins.
       */
      rewrite?: string;
    }
  | { action: "respond"; status: 421 | 503; headers: Record<string, string>; body: string };

export type GateConfig = {
  reader: ReleaseReader;
  surface: Surface;
  dev: boolean;
  /** A fresh, unguessable value for this request. */
  nonce: string;
  /** An unguessable value made once by this process; never sent to a client. */
  twinToken?: string;
};

const LOOPBACK_HOST = /^(localhost|[a-z0-9-]+\.localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$/;

export async function gate(
  config: GateConfig,
  request: { host: string | null; /** Without the base path. */ pathname: string; search?: string; /** What the request carries under TWIN_HEADER. */ twinToken?: string | null; /** What the request carries under HOST_HEADER. */ namedHost?: string | null },
): Promise<Decision> {
  const { reader, surface } = config;
  const csp = buildCsp(config.nonce, { dev: config.dev });
  const security: Record<string, string> = {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    ...(surface === "production" ? {} : { "x-robots-tag": "noindex" }),
  };
  const refuse = (status: 421 | 503, type: string, body: string, extra: Record<string, string> = {}): Decision => ({
    action: "respond",
    status,
    headers: { ...security, "content-type": type, "cache-control": "no-store", ...extra },
    body,
  });

  if (surface === "local" && !LOOPBACK_HOST.test((request.host ?? "").toLowerCase())) {
    return refuse(421, "text/plain; charset=utf-8", "This is a local build of Macro Atlas. It answers only on this machine.\n");
  }

  const opened = await reader.current();
  if (!opened.ok) {
    const retry = { "retry-after": "60" };
    if (request.pathname === "/api/health") {
      const body = { status: "unavailable", surface, kind: opened.kind, release_id: opened.id, reason: opened.reason };
      return refuse(503, "application/json; charset=utf-8", JSON.stringify(body) + "\n", retry);
    }
    return refuse(503, "text/plain; charset=utf-8", "Macro Atlas is unavailable: there is no release it can serve.\n", retry);
  }

  const twin = twinOf(request.pathname);
  const token = config.twinToken;
  // The second pass: the handler's own path, reached from a twin's address by this process.
  const sent = !twin && internalTwinPath(request.pathname) && typeof token === "string" && token.length >= 16 && request.twinToken === token;
  return {
    action: "forward",
    ...(twin && token ? { rewrite: twinRoute(twin.key, twin.format) } : twin || (internalTwinPath(request.pathname) && !sent) ? { rewrite: NOT_AN_ADDRESS } : {}),
    requestHeaders: {
      [TWIN_HEADER]: (twin || sent) && token ? token : null,
      [HOST_HEADER]: (sent ? request.namedHost : null) ?? request.host,
      [RELEASE_HEADER]: opened.release.id,
      [REFRESH_FAILED_HEADER]: opened.refreshFailed ? JSON.stringify(opened.refreshFailed) : null,
      [NONCE_HEADER]: config.nonce,
      [PATH_HEADER]: request.pathname + (request.search ?? ""),
      "content-security-policy": csp,
    },
    responseHeaders: security,
  };
}
