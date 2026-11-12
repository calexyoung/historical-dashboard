import type { NextRequest } from "next/server";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { downloadDecision, downloadType } from "@/lib/downloads";
import { getReader, releaseForRequest } from "@/lib/release/server";

const text = (status: number, body: string, more: Record<string, string> = {}): Response =>
  new Response(`${body}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...more } });

/**
 * One bulk file of a Release: `/downloads/{release id}/{file}` (PLAN section 7, M25; ADR 0039).
 * `/downloads/latest/{file}` answers with where the newest Release's file is.
 *
 * The proxy has already fixed the request to the Release the address names, or refused it
 * (src/lib/gate.ts, point 7), and counted it against the rate limits. Here the rights gate is
 * asked again, today, about every Series the file lists: what a register allowed when the
 * Release was written does not carry over. A file it refuses is 403 with the reason and no
 * byte of the file. Otherwise the file is sent as it is on disk, under the name the
 * datapackage gives it, with its SHA-256 as the validator and in `x-content-sha256`. It is
 * streamed, so the answer states no length; the datapackage gives each file's size.
 *
 * Caching: the bytes at this address never change, but whether they may be given can. So, as
 * for every other file of values, only production may keep a copy, for five minutes, and the
 * gate answers before a validator is compared.
 */
export async function GET(request: NextRequest, context: RouteContext<"/downloads/[release]/[file]">) {
  const [{ release: named, file: name }, { release }] = await Promise.all([context.params, releaseForRequest()]);
  if (named === "latest") {
    // The Release CURRENT names for this request; the address it leads to never changes its bytes.
    if (release.downloads === null || !(name === "datapackage.json" || release.downloads.resources.some((r) => r.path === name))) return text(404, "This release has no bulk file of that name.");
    return text(302, `The newest release is ${release.id}.`, { location: `${BASE_PATH}/downloads/${release.id}/${name}` });
  }
  if (named !== release.id) return text(404, "Not found.");
  const decided = downloadDecision(release, SURFACE, name);
  if (!decided.ok) return text(decided.status, `${decided.message}.`);
  const file = await getReader().download?.(release.id, name);
  if (!file) return text(404, "This release has no bulk file of that name.");

  const etag = `"${file.sha256}"`;
  const headers: Record<string, string> = {
    "content-type": downloadType(name),
    "content-disposition": `attachment; filename="macro-atlas_${release.id}_${name}"`,
    "cache-control": SURFACE === "production" ? "public, max-age=300" : "no-store",
    etag,
    "x-content-sha256": file.sha256,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(file.stream(), { status: 200, headers });
}
