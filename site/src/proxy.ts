/**
 * The proxy: runs before every route, on every path (no matcher, on purpose). It is a thin
 * adapter; the decisions are in src/lib/gate.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SURFACE } from "./lib/config";
import { gate } from "./lib/gate";
import { getReader } from "./lib/release/server";

export async function proxy(request: NextRequest): Promise<Response> {
  const decision = await gate(
    {
      reader: getReader(),
      surface: SURFACE,
      dev: process.env.NODE_ENV === "development",
      nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64"),
    },
    {
      host: request.headers.get("host"),
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
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
  const response = NextResponse.next({ request: { headers } });
  for (const [name, value] of Object.entries(decision.responseHeaders)) response.headers.set(name, value);
  return response;
}
