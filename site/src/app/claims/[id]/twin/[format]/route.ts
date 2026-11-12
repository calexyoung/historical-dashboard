import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { SURFACE } from "@/lib/config";
import { TWIN_HEADER } from "@/lib/gate";
import { releaseForRequest } from "@/lib/release/server";
import { claimFormatOfSegment } from "@/lib/twin/address";
import { claimTwin } from "@/lib/twin/claims";

const missing = () => new Response("Not found.\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * The twins of a Claim's page: `/claims/{id}.json | .md`, `/claims/{id}/evidence.csv` and
 * `/claims/{id}/lock.json` (PLAN section 7, M21). As for a Series' twins, the proxy recognises
 * the address and sends it here with a token of its own; asked for directly this path is not an
 * address (src/lib/gate.ts, point 4). Everything is decided by `claimTwin`, which asks the rights
 * gate before it makes anything; this handler copies the answer out. Caching is the series
 * twins': only what the gate allowed on production, five minutes, with a validator of its bytes.
 */
export async function GET(request: NextRequest, context: RouteContext<"/claims/[id]/twin/[format]">) {
  if (!request.headers.get(TWIN_HEADER)) return missing();
  const [{ id, format: segment }, { release, address }] = await Promise.all([context.params, releaseForRequest()]);
  const format = claimFormatOfSegment(segment);
  if (!format) return missing();
  const twin = claimTwin(release, SURFACE, id, format, { address });

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
