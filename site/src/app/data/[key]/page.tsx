import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { SeriesPage } from "@/components/SeriesPage";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";
import { seriesPageView } from "@/lib/series-page";

async function answer(props: PageProps<"/data/[key]">) {
  const [{ key }, { release }] = await Promise.all([props.params, releaseForRequest()]);
  return seriesPageView(release, SURFACE, key);
}

export async function generateMetadata(props: PageProps<"/data/[key]">): Promise<Metadata> {
  const found = await answer(props);
  return { title: found.kind === "page" ? found.view.name : "Series" };
}

/**
 * One Series of the Release this request was fixed to (ADR 0015). Rendered per request, like
 * every data page: nothing from a Release is in the build output (PLAN 6.1). A key that was
 * renamed moves to its permanent key; a key the Release does not know is not found.
 */
export default async function SeriesRoute(props: PageProps<"/data/[key]">) {
  const found = await answer(props);
  if (found.kind === "not_found") notFound();
  if (found.kind === "moved") permanentRedirect(`/data/${found.key}`);
  return <SeriesPage view={found.view} basePath={BASE_PATH} />;
}
