import type { Surface } from "@macro-atlas/core";
import { formatDay } from "@/lib/freshness";
import type { OpenedRelease } from "@/lib/release/reader";

const BUILD_WORD: Record<Surface, string | null> = { local: "Local build", staging: "Staging build", production: null };

/** Which Release this page was made from, and what kind of build is showing it. */
export function SiteFooter({ surface, release }: { surface: Surface; release: OpenedRelease }) {
  const local = release.manifest.profile === "local";
  return (
    <footer className="mt-8 border-t border-line">
      {local && (
        // A local-profile Release may hold data that is not cleared for publication (PLAN 6.1).
        <p role="note" className="border-b border-delayed/50 bg-delayed/10 px-4 py-1.5 text-center text-xs font-semibold text-ink">
          Local build · local-profile release · not for publication
        </p>
      )}
      <div className="mx-auto flex max-w-[1400px] flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs text-ink-3 lg:px-6">
        <p>
          Release <span className="num font-mono text-ink-2" data-release-id>{release.id}</span>, created{" "}
          <time dateTime={release.manifest.created} className="num">
            {formatDay(release.manifest.created)}
          </time>
        </p>
        {BUILD_WORD[surface] && <p data-surface={surface}>{BUILD_WORD[surface]}</p>}
      </div>
    </footer>
  );
}
