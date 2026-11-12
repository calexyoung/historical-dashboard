import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { SeriesPage } from "@/components/SeriesPage";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { NONCE_HEADER } from "@/lib/gate";
import { datasetJsonLd, jsonLdText } from "@/lib/json-ld";
import { releaseForRequest } from "@/lib/release/server";
import { seriesPageView } from "@/lib/series-page";

/** The address's query as asked, repeats and all, for the one parser the page and its twins share. */
function searchOf(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) out.append(name, one);
  return out;
}

async function answer(props: PageProps<"/data/[key]">) {
  const [{ key }, raw, { release, address }] = await Promise.all([props.params, props.searchParams, releaseForRequest()]);
  const search = searchOf(raw);
  return { found: seriesPageView(release, SURFACE, key, { search, address }), search };
}

export async function generateMetadata(props: PageProps<"/data/[key]">): Promise<Metadata> {
  const { found } = await answer(props);
  return { title: found.kind === "page" ? found.view.name : "Series" };
}

/**
 * One Series of the Release this request was fixed to (ADR 0015). Rendered per request, like
 * every data page: nothing from a Release is in the build output (PLAN 6.1). A key that was
 * renamed moves to its permanent key, question and all; a key the Release does not know is not
 * found. The address's query is the question (`?as_of=`, `?transform=`, ...), read by the same
 * parser as the twins', so the page and the files behind it answer the same thing.
 */
export default async function SeriesRoute(props: PageProps<"/data/[key]">) {
  const { found, search } = await answer(props);
  if (found.kind === "not_found") notFound();
  if (found.kind === "moved") permanentRedirect(`/data/${found.key}${search.size > 0 ? `?${search}` : ""}`);
  // What the page is about, for a program that reads it (schema.org Dataset; no value in it).
  const { release, address } = await releaseForRequest();
  const dataset = datasetJsonLd(release, SURFACE, found.view.key, { address });
  return (
    <>
      {dataset && <script type="application/ld+json" nonce={(await headers()).get(NONCE_HEADER) ?? undefined} dangerouslySetInnerHTML={{ __html: jsonLdText(dataset) }} />}
      <SeriesPage view={found.view} basePath={BASE_PATH} />
    </>
  );
}
