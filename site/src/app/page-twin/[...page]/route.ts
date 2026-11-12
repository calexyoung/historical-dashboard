import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { SURFACE } from "@/lib/config";
import { TWIN_HEADER } from "@/lib/gate";
import { releaseForRequest } from "@/lib/release/server";
import { pageOfSegments } from "@/lib/twin/address";
import { pageTwin } from "@/lib/twin/pages";

const missing = (): Response => new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * The Markdown twin of a page: `/highlights.md`, `/topics/{slug}.md`, `/index.md` (PLAN section
 * 3, M25). As for a Series' twins, the proxy recognises the address and sends it here with a
 * token of its own; asked for directly this path is not an address (src/lib/gate.ts, point 4).
 * Everything is decided by `pageTwin`, which makes the file from the page's own view under the
 * Permission to redistribute; this handler copies the answer out. Caching is the series twins':
 * production only, five minutes, with a validator of the file's bytes.
 */
export async function GET(request: NextRequest, context: RouteContext<"/page-twin/[...page]">) {
  if (!request.headers.get(TWIN_HEADER)) return missing();
  const [{ page }, { release, address }] = await Promise.all([context.params, releaseForRequest()]);
  const twin = pageTwin(release, SURFACE, pageOfSegments(page), request.nextUrl.searchParams, { address });

  const headers: Record<string, string> = { "content-type": twin.contentType, "cache-control": "no-store" };
  if (twin.filename) headers["content-disposition"] = `${twin.disposition ?? "inline"}; filename="${twin.filename}"`;
  if (twin.status === 200 && twin.cacheable) {
    const etag = `"${createHash("sha256").update(twin.body).digest("hex").slice(0, 32)}"`;
    headers["cache-control"] = "public, max-age=300";
    headers.etag = etag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  }
  return new Response(twin.body, { status: twin.status, headers });
}
