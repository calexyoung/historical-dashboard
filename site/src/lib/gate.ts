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
 * 5. A pinned view (`/explore?…&pin={release id}`, M18) is fixed to the Release it names, not to
 *    CURRENT, by the same header: a page cannot choose its own Release, so this is the one place
 *    a pin is read. CURRENT must still be servable (2 comes first). A pin that is not a release
 *    id is 400. A Release retention no longer keeps is 410 Gone, with a link to the same view on
 *    the current Release; one that cannot be read or may not be served here is 503. Nothing is
 *    ever served in a pinned Release's place. Only the Explorer and its export take a pin.
 *
 * Pure apart from the reader it is given; `proxy.ts` is the thin Next adapter around it.
 */
import type { Surface } from "@macro-atlas/core";
import { buildCsp } from "./csp";
import { RELEASE_ID, type ReleaseReader } from "./release/reader";
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
/**
 * On a pinned request: the Release CURRENT names, so the page can say there is a newer one.
 * Whatever a client sent under this name is removed.
 */
export const CURRENT_HEADER = "x-atlas-current";
/** The routes that take `pin=`. */
const PINNABLE: ReadonlySet<string> = new Set(["/explore", "/explore/export"]);
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
  | { action: "respond"; status: 400 | 410 | 421 | 503; headers: Record<string, string>; body: string };

export type GateConfig = {
  reader: ReleaseReader;
  surface: Surface;
  dev: boolean;
  /** A fresh, unguessable value for this request. */
  nonce: string;
  /** An unguessable value made once by this process; never sent to a client. */
  twinToken?: string;
  /** Where the site is served, for the one link a 410 carries. */
  basePath?: string;
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The whole answer for a pin retention no longer keeps: plain, self-contained, and with no data in it. */
function goneHtml(pin: string, href: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Release no longer kept · Macro Atlas</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">This release is no longer kept</h1><p>This link is pinned to release <code>${escapeHtml(pin)}</code>. Macro Atlas keeps the newest releases and those that something still names; this one is not among them, so its figures cannot be shown. Nothing else is shown in their place.</p><p><a href="${escapeHtml(href)}">Open the same view on the current release</a></p></body></html>\n`;
}

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
  const refuse = (status: 400 | 410 | 421 | 503, type: string, body: string, extra: Record<string, string> = {}): Decision => ({
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

  // --- a pinned view: the Release the address names, or no data at all ---
  let serving = opened.release.id;
  let pinnedFrom: string | null = null;
  const params = new URLSearchParams(request.search ?? "");
  if (PINNABLE.has(request.pathname) && params.has("pin")) {
    const pins = params.getAll("pin");
    if (pins.length !== 1 || !RELEASE_ID.test(pins[0]!)) {
      return refuse(400, "text/plain; charset=utf-8", "pin: one release id, as a pinned link carries it. Nothing is shown in its place.\n");
    }
    const pin = pins[0]!;
    if (pin !== opened.release.id) {
      const held = reader.pinned ? await reader.pinned(pin) : ({ ok: false, kind: "unavailable", id: pin, reason: "this reader opens no pinned release" } as const);
      if (!held.ok && held.kind === "gone") {
        params.delete("pin");
        params.delete("format");
        const rest = params.toString();
        const href = `${config.basePath ?? ""}/explore${rest ? `?${rest}` : ""}`;
        return refuse(410, "text/html; charset=utf-8", goneHtml(pin, href));
      }
      if (!held.ok) {
        return refuse(503, "text/plain; charset=utf-8", "Macro Atlas cannot serve the release this link is pinned to. Nothing is shown in its place.\n", { "retry-after": "60" });
      }
      serving = held.release.id;
    }
    pinnedFrom = opened.release.id;
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
      [RELEASE_HEADER]: serving,
      [CURRENT_HEADER]: pinnedFrom,
      // The failed-refresh state is CURRENT's; a pinned Release was asked for by name.
      [REFRESH_FAILED_HEADER]: opened.refreshFailed && pinnedFrom === null ? JSON.stringify(opened.refreshFailed) : null,
      [NONCE_HEADER]: config.nonce,
      [PATH_HEADER]: request.pathname + (request.search ?? ""),
      "content-security-policy": csp,
    },
    responseHeaders: security,
  };
}
