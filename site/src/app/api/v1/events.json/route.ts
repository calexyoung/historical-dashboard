import type { NextRequest } from "next/server";
import { apiEvents } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/** The Events of the Release. Decided in `apiEvents`. */
export async function GET(request: NextRequest) {
  const { release, address } = await releaseForRequest();
  return respond(request, apiEvents(release, SURFACE, request.nextUrl.searchParams, { address }));
}
