import type { Metadata } from "next";
import { DownloadsPage } from "@/components/DownloadsPage";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { downloadsView } from "@/lib/downloads";
import { releaseForRequest } from "@/lib/release/server";

export const metadata: Metadata = { title: "Bulk files" };

/** `/downloads`: the bulk files of the Release being served (PLAN sections 3 and 7, M25). */
export default async function DownloadsRoute() {
  const { release, address } = await releaseForRequest();
  return <DownloadsPage view={downloadsView(release, SURFACE)} basePath={BASE_PATH} address={address} current />;
}
