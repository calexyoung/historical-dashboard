import type { NextRequest } from "next/server";
import { apiClaims } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/** The Claims of the Release as records; no figure. Decided in `apiClaims`. */
export async function GET(request: NextRequest) {
  const { release, address } = await releaseForRequest();
  return respond(request, apiClaims(release, SURFACE, request.nextUrl.searchParams, { address }));
}
