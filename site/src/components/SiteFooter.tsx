import type { Surface } from "@macro-atlas/core";
import { BASE_PATH } from "@/lib/config";
import { formatDay } from "@/lib/freshness";
import { glossaryHref } from "@/lib/glossary";
import type { OpenedRelease } from "@/lib/release/reader";

const BUILD_WORD: Record<Surface, string | null> = { local: "Local build", staging: "Staging build", production: null };

/** Which Release this page was made from, and what kind of build is showing it. */
export function SiteFooter({ surface, release }: { surface: Surface; release: OpenedRelease }) {
  return (
    <footer className="mt-8 border-t border-line">
      <div className="mx-auto flex max-w-[1400px] flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs text-ink-3 lg:px-6">
        <p>
          Release <span className="num font-mono text-ink-2" data-release-id>{release.id}</span>, created{" "}
          <time dateTime={release.manifest.created} className="num">
            {formatDay(release.manifest.created)}
          </time>
        </p>
        {BUILD_WORD[surface] && <p data-surface={surface}>{BUILD_WORD[surface]}</p>}
        <p className="sm:ml-auto">
          <a href={glossaryHref(BASE_PATH)} className="press hover-ink inline-flex min-h-6 min-w-6 items-center text-accent underline underline-offset-2">
            Glossary
          </a>
        </p>
      </div>
    </footer>
  );
}
