import type { NextRequest } from "next/server";
import { apiIndex } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/** The routes of the read API (PLAN section 7; docs/method/api.md). Decided in `apiIndex`. */
export async function GET(request: NextRequest) {
  const { release, address } = await releaseForRequest();
  return respond(request, apiIndex(release, SURFACE, request.nextUrl.searchParams, { address }));
}
