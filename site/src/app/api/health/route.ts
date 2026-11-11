import { SURFACE } from "@/lib/config";
import { releaseForRequest } from "@/lib/release/server";

/**
 * Liveness, the release being served and its age (PLAN 4.6). Never an upstream call. When no
 * Release may be served, this route is not reached: the proxy answers 503 for it as for every
 * other path, which is what fails a container health check.
 */
export async function GET() {
  const { release, refreshFailed, now } = await releaseForRequest();
  return Response.json(
    {
      status: refreshFailed ? "degraded" : "ok",
      surface: SURFACE,
      release_id: release.id,
      profile: release.manifest.profile,
      created: release.manifest.created,
      age_seconds: Math.max(0, Math.floor((now - Date.parse(release.manifest.created)) / 1000)),
      refresh_failed: refreshFailed,
      now: new Date(now).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
