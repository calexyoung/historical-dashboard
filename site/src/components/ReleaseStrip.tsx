import { releaseHoldsLegacy } from "@/lib/catalog";
import type { OpenedRelease } from "@/lib/release/reader";

/**
 * On every page of a local-profile Release, before the page's content: what is being shown may
 * not be published (PLAN 6.1). A Release that holds v1's series says where they came from; one
 * that does not, does not claim to. A public-profile Release has no strip.
 *
 * It is a note, not an alert: it is there on every load, so it never moves, flashes or animates.
 */
export function ReleaseStrip({ release }: { release: OpenedRelease }) {
  if (release.manifest.profile !== "local") return null;
  const text = releaseHoldsLegacy(release)
    ? "Local build · v1 data via FRED and Yahoo · not for publication"
    : "Local build · local-profile release · not for publication";
  return (
    <p role="note" data-release-strip className="border-b border-delayed/50 bg-delayed/10 px-4 py-1.5 text-center text-xs font-semibold text-ink">
      {text}
    </p>
  );
}
