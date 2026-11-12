import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { TWIN_HEADER } from "@/lib/gate";
import { releaseForRequest } from "@/lib/release/server";
import { seriesTwin } from "@/lib/twin";
import { formatOfSegment } from "@/lib/twin/address";

/**
 * The twins of a series page: `/data/{key}.csv | .json | .metadata.json | .md` (PLAN sections 3
 * and 7). The proxy recognises the address and sends it here with a token of its own; this path
 * is the app's own, and asked for directly the proxy sends it nowhere (src/lib/gate.ts, point 4).
 * The handler checks that the token is there, so it answers nothing if the proxy did not run.
 * Everything else is decided by
 * `seriesTwin`, which asks the rights gate before it makes anything; this handler copies the
 * answer out.
 *
 * Caching (PLAN section 7): only a file the gate allowed on the production surface may be kept,
 * for five minutes, and it carries a validator made from its own bytes. The gate has always
 * answered before a validator is compared, so a 304 is never given for what would now be a 403.
 * A copy may therefore outlive a withdrawal by up to five minutes.
 */
export async function GET(request: NextRequest, context: RouteContext<"/data/[key]/twin/[format]">) {
  // Fail closed, like releaseForRequest: no twin from a request the proxy did not send here.
  if (!request.headers.get(TWIN_HEADER)) return new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const [{ key, format: segment }, { release, address }] = await Promise.all([context.params, releaseForRequest()]);
  const format = formatOfSegment(segment);
  if (!format) return new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const twin = seriesTwin(release, SURFACE, key, format, request.nextUrl.searchParams, { address });

  const headers: Record<string, string> = { "content-type": twin.contentType, "cache-control": "no-store" };
  if (twin.status === 308 && twin.location) {
    return new Response(twin.body, { status: 308, headers: { ...headers, location: `${BASE_PATH}${twin.location}` } });
  }
  if (twin.filename) headers["content-disposition"] = `${twin.disposition ?? "inline"}; filename="${twin.filename}"`;
  if (twin.status === 200 && twin.cacheable) {
    const etag = `"${createHash("sha256").update(twin.body).digest("hex").slice(0, 32)}"`;
    headers["cache-control"] = "public, max-age=300";
    headers.etag = etag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  }
  return new Response(twin.body, { status: twin.status, headers });
}
