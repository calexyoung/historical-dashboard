import { tabsFor } from "@/lib/nav";

/**
 * The section tabs, as on /missions, but these are pages, so they are links in a nav and the
 * current one is marked with aria-current. Only sections that exist are listed (src/lib/nav.ts).
 * Plain links: moving between sections is a full page load, so a page is always one Release.
 * Below 640px the tabs sit closer together, so that the five of v2.0 fit a 320px phone without
 * the bar scrolling (the fold under "Research" in PLAN section 3 comes with a sixth).
 */
export function TabBar({ basePath, pathname, claims, topics }: { basePath: string; pathname: string; /** The Release being served holds a Claim. */ claims: boolean; /** It holds a Topic. */ topics: boolean }) {
  return (
    <nav aria-label="Sections" className="border-b border-line-strong">
      <ul className="mx-auto -mb-px flex max-w-[1400px] gap-0.5 overflow-x-auto sm:gap-1 px-4 lg:px-6">
        {tabsFor(pathname, { claims, topics }).map((tab) => (
          <li key={tab.href} className="shrink-0">
            <a
              href={`${basePath}${tab.href}`}
              aria-current={tab.current ? "page" : undefined}
              className={`press block border-b-2 px-1.5 pb-2 pt-1.5 text-sm sm:px-3 ${
                tab.current ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover-ink hover-line"
              }`}
            >
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
