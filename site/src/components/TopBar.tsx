import type { Freshness, FreshnessState } from "@/lib/freshness";
import { HOME_URL } from "@/lib/config";
import { breadcrumb } from "@/lib/nav";
import type { Theme } from "@/lib/theme";
import { ThemeControl } from "./ThemeControl";

/** The state is carried by a shape and a word as well as a colour. */
const MARK: Record<FreshnessState, { tone: string; shape: React.ReactNode }> = {
  current: { tone: "text-nominal", shape: <circle cx="6" cy="6" r="4.5" fill="currentColor" /> },
  stale: {
    tone: "text-delayed",
    shape: <path d="M6 1.5 11 10.5H1Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  },
  refresh_failed: {
    tone: "text-outage",
    shape: <path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" fill="currentColor" />,
  },
};

function FreshnessMark({ freshness }: { freshness: Freshness }) {
  const mark = MARK[freshness.state];
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-2" data-freshness={freshness.state}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 ${mark.tone}`}>
        {mark.shape}
      </svg>
      <span>
        <span className="font-semibold text-ink">{freshness.word}</span>
        {/* The date is also in the footer, so nothing is lost where this is hidden. */}
        <span className="num hidden sm:inline"> · {freshness.detail}</span>
      </span>
    </p>
  );
}

const Slash = () => (
  <span aria-hidden="true" className="text-ink-3">
    /
  </span>
);

/** As on /missions: name and breadcrumb left; freshness and the theme control right. */
export function TopBar({
  basePath,
  pathname,
  returnTo,
  theme,
  freshness,
}: {
  basePath: string;
  pathname: string;
  returnTo: string;
  theme: Theme | null;
  freshness: Freshness;
}) {
  const here = breadcrumb(pathname);
  return (
    <header className="border-b border-line bg-void">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 lg:px-6">
        {/* One trail from the shared front door to this page: mydashboards / Macro Atlas / Explore. */}
        <nav aria-label="Breadcrumb" className="mr-auto min-w-0">
          <ol className="flex flex-wrap items-baseline gap-x-2 text-lg leading-7 tracking-tight">
            <li className="flex items-baseline gap-x-2">
              <a href={HOME_URL} className="press hover-ink inline-block py-0.5 text-sm tracking-normal text-ink-3">
                mydashboards
              </a>
              <Slash />
            </li>
            <li>
              <a href={`${basePath}/`} className="inline-block py-0.5 font-semibold text-ink">
                Macro Atlas
              </a>
            </li>
            {here && (
              <li className="flex items-baseline gap-x-2">
                <Slash />
                <a href={`${basePath}${pathname}`} aria-current="page" className="inline-block py-0.5 text-ink-2">
                  {here}
                </a>
              </li>
            )}
          </ol>
        </nav>
        <FreshnessMark freshness={freshness} />
        <ThemeControl basePath={basePath} returnTo={returnTo} initial={theme} />
      </div>
    </header>
  );
}
