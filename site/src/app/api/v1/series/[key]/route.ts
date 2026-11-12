import type { NextRequest } from "next/server";
import { apiSeries } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/**
 * The values of one Series. Decided in `apiSeries`, which asks Query for the Permission to
 * redistribute before it makes anything; this handler copies the answer out.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/v1/series/[key]">) {
  const [{ key }, { release, address }] = await Promise.all([context.params, releaseForRequest()]);
  return respond(request, apiSeries(release, SURFACE, key, request.nextUrl.searchParams, { address }));
}
