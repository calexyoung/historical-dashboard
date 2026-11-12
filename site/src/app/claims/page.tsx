import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimsIndex } from "@/components/ClaimsIndex";
import { claimsIndexView, parseClaimFilters } from "@/lib/claims";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Claims" };

/**
 * The Claims of the Release being served (PLAN section 3, M21). A reading page: complete in the
 * HTML, no script. The filters are a GET form, so the address says what is listed. The count by
 * party is over every Claim of the Release, whatever is filtered: it shows whose statements have
 * been recorded, in words and numbers, with no colour for a party. Nothing here says what any
 * Claim's figures show.
 *
 * A Release with no Claim has no Claims page on a public Surface (PLAN section 3: hidden until
 * the first is published). A local build says how one is recorded.
 */
export default async function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  const { release } = await releaseForRequest();
  const view = claimsIndexView(release, parseClaimFilters(await searchParams));
  if (view.total === 0 && SURFACE !== "local") notFound();
  return <ClaimsIndex view={view} basePath={BASE_PATH} />;
}
