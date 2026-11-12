import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { SURFACE } from "@/lib/config";
import { llmsText } from "@/lib/llms";
import { releaseForRequest } from "@/lib/release/server";

/**
 * `/llms.txt` (PLAN section 7, M25): every page of the Release being served, as links to its
 * Markdown. Made by `llmsText` from the Catalog; it holds no value. Like any other answer it
 * comes from the one Release the proxy fixed for the request. Production may keep it briefly.
 */
export async function GET(request: NextRequest) {
  const { release, address } = await releaseForRequest();
  const body = llmsText(release, SURFACE, { address });
  const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" };
  if (SURFACE === "production") {
    const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
    headers["cache-control"] = "public, max-age=300";
    headers.etag = etag;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  }
  return new Response(body, { headers });
}
