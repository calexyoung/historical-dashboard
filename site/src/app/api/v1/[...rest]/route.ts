import type { NextRequest } from "next/server";
import { apiNotFound } from "@/lib/api";
import { respond } from "@/lib/api/respond";
import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/** Anything under `/api/v1` that is no route: 404 as JSON, with the routes there are. */
export async function GET(request: NextRequest, context: RouteContext<"/api/v1/[...rest]">) {
  const [{ rest }, { release, address }] = await Promise.all([context.params, releaseForRequest()]);
  return respond(request, apiNotFound(release, SURFACE, `/api/v1/${rest.join("/")}`, { address }));
}
