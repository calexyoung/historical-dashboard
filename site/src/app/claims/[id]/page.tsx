import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimPage } from "@/components/ClaimPage";
import { claimPageView } from "@/lib/claims";
import { BASE_PATH, SURFACE } from "@/lib/config";
import { notesFor } from "@/lib/notes";
import { releaseForRequest } from "@/lib/release/server";

async function answer(props: PageProps<"/claims/[id]">) {
  const [{ id }, { release, address }] = await Promise.all([props.params, releaseForRequest()]);
  // User notes: read only by a local build serving a local-profile Release (lib/notes.ts decides).
  const notes = await notesFor({ directory: process.env.ATLAS_NOTES_DIR, surface: SURFACE, profile: release.manifest.profile }, "claim", id);
  return claimPageView(release, SURFACE, id, { address, notes });
}

export async function generateMetadata(props: PageProps<"/claims/[id]">): Promise<Metadata> {
  const view = await answer(props);
  return { title: view ? `${view.claimant.name}, ${view.when}` : "Claim", alternates: view ? { types: { "text/markdown": `${BASE_PATH}/claims/${view.id}.md` } } : undefined };
}

/** One Claim of the Release this request was fixed to (PLAN section 3, M21): `components/ClaimPage.tsx`. */
export default async function ClaimRoute(props: PageProps<"/claims/[id]">) {
  const view = await answer(props);
  if (!view) notFound();
  return <ClaimPage view={view} basePath={BASE_PATH} />;
}
