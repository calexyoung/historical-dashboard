import type { NextRequest } from "next/server";
import { apiCatalog } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/** Every Series of the Release as the Catalog records it, and no value. Decided in `apiCatalog`. */
export async function GET(request: NextRequest) {
  const { release, address } = await releaseForRequest();
  return respond(request, apiCatalog(release, SURFACE, request.nextUrl.searchParams, { address }));
}
