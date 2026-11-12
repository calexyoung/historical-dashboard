import type { NextRequest } from "next/server";
import { apiStatus } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { getReader, releaseForRequest } from "@/lib/release/server";

/**
 * Freshness, source by source and Series by Series, and how the last run ended (PLAN 4.6). It
 * reads the Release this request was fixed to and the root's own record, and calls nothing
 * upstream. When no Release may be served the proxy has already answered 503. Never kept by a
 * cache: `apiStatus` says so, and `respond` then sends `no-store`.
 */
export async function GET(request: NextRequest) {
  const [{ release, refreshFailed, now }, lastRun] = await Promise.all([releaseForRequest(), getReader().lastRun?.() ?? null]);
  return respond(request, apiStatus(release, SURFACE, request.nextUrl.searchParams, { refreshFailed, now, lastRun }));
}
