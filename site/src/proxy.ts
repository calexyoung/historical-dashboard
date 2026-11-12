/**
 * The proxy: runs before every route, on every path (no matcher, on purpose). It is a thin
 * adapter; the decisions are in src/lib/gate.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { BASE_PATH, SURFACE } from "./lib/config";
import { gate, HOST_HEADER, TWIN_HEADER } from "./lib/gate";
import { getReader } from "./lib/release/server";

// Made once per process and never sent out: how the pass that runs on a twin handler's own path
// knows the request came from a twin's address (src/lib/gate.ts, point 4).
const TOKEN = Symbol.for("macro-atlas.twin-token");
const holder = globalThis as { [TOKEN]?: string };
const twinToken = (holder[TOKEN] ??= Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url"));

export async function proxy(request: NextRequest): Promise<Response> {
  const decision = await gate(
    {
      reader: getReader(),
      surface: SURFACE,
      dev: process.env.NODE_ENV === "development",
      nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64"),
      twinToken,
      basePath: BASE_PATH,
    },
    {
      host: request.headers.get("host"),
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      twinToken: request.headers.get(TWIN_HEADER),
      namedHost: request.headers.get(HOST_HEADER),
    },
  );

  if (decision.action === "respond") {
    return new Response(request.method === "HEAD" ? null : decision.body, {
      status: decision.status,
      headers: decision.headers,
    });
  }

  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(decision.requestHeaders)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  let response: NextResponse;
  if (decision.rewrite) {
    const url = request.nextUrl.clone(); // keeps the base path and the query
    url.pathname = decision.rewrite;
    response = NextResponse.rewrite(url, { request: { headers } });
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  for (const [name, value] of Object.entries(decision.responseHeaders)) response.headers.set(name, value);
  return response;
}
