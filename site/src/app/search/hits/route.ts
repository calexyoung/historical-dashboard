import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";
import { parseSearch, search, SHEET_HITS } from "@/lib/search";

/**
 * The search sheet's answer (M22): the same function the `/search` page renders, as JSON, for
 * the Release the proxy fixed for this request. Names, addresses and words; never a value. It
 * is the page's own helper and no part of the read API (`/api/v1`, M24).
 */
export async function GET(request: Request) {
  const { release } = await releaseForRequest();
  const answer = search(release, SURFACE, parseSearch(new URL(request.url).searchParams), { limit: SHEET_HITS });
  return Response.json(answer, { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
