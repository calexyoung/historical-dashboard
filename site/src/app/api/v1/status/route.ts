import { SURFACE } from "@/lib/config";
import { getReader, releaseForRequest } from "@/lib/release/server";
import { statusView } from "@/lib/status";

/**
 * Freshness, source by source and Series by Series, and how the last run ended (PLAN 4.6). It
 * reads the Release this request was fixed to and the root's own record, and calls nothing
 * upstream. When no Release may be served the proxy has already answered 503.
 */
export async function GET() {
  const [{ release, refreshFailed, now }, lastRun] = await Promise.all([releaseForRequest(), getReader().lastRun?.() ?? null]);
  return Response.json(statusView(release, SURFACE, { refreshFailed, now, lastRun }), { headers: { "Cache-Control": "no-store" } });
}
