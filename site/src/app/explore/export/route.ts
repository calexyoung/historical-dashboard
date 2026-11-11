import type { NextRequest } from "next/server";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { parseExplorerParams } from "@/lib/explorer/state";
import { exportView, type ExportFormat } from "@/lib/export";
import { releaseForRequest } from "@/lib/release/server";

/**
 * A view of the Explorer as a file: `/explore/export?format=csv|svg|all&{the view's address}`.
 * Everything is decided by `exportView`, which asks the rights gate first (PLAN M5 and 6.1). A
 * refusal is a short line of text with no data in it. Nothing here is cached or indexed.
 */
export async function GET(request: NextRequest) {
  const { release } = await releaseForRequest();
  const params = request.nextUrl.searchParams;
  const format = (params.get("format") ?? "csv") as ExportFormat;
  // The address a reader would open, as they asked for it: the Host they named, not the server's own.
  // It is written into the file, so it must look like a host and nothing else.
  const named = request.headers.get("host") ?? "";
  const host = /^([a-z0-9.-]{1,253}|\[[0-9a-f:]{2,45}\])(:[0-9]{1,5})?$/i.test(named) ? named : request.nextUrl.host;
  const result = exportView(release, SURFACE, parseExplorerParams(params), format, { address: `${request.nextUrl.protocol}//${host}${BASE_PATH}/explore` });
  const common = { "cache-control": "no-store", "x-robots-tag": "noindex" };
  if (!result.ok) return new Response(`${result.message}\n`, { status: result.status, headers: { ...common, "content-type": "text/plain; charset=utf-8" } });
  return new Response(result.body, {
    headers: { ...common, "content-type": result.contentType, "content-disposition": `attachment; filename="${result.filename}"` },
  });
}
