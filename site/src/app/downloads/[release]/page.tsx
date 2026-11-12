import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DownloadsPage } from "@/components/DownloadsPage";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { downloadsView } from "@/lib/downloads";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Bulk files" };

/**
 * `/downloads/{release id}`: the bulk files of that Release, while retention keeps it. The
 * proxy fixed the request to the Release the address names, or refused it (src/lib/gate.ts,
 * point 7). `/downloads/latest` leads to the page of the Release being served.
 */
export default async function ReleaseDownloadsRoute({ params }: PageProps<"/downloads/[release]">) {
  const [{ release: named }, { release, address, pinnedFrom }] = await Promise.all([params, releaseForRequest()]);
  if (named === "latest") redirect("/downloads");
  if (named !== release.id) notFound();
  return <DownloadsPage view={downloadsView(release, SURFACE)} basePath={BASE_PATH} address={address} current={pinnedFrom === null || pinnedFrom === release.id} />;
}
