import type { NextRequest } from "next/server";
import { apiVintages } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/** Every version held of each Period of one Series, or of one Period. Decided in `apiVintages`. */
export async function GET(request: NextRequest, context: RouteContext<"/api/v1/series/[key]/vintages">) {
  const [{ key }, { release, address }] = await Promise.all([context.params, releaseForRequest()]);
  return respond(request, apiVintages(release, SURFACE, key, request.nextUrl.searchParams, { address }));
}
