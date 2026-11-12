import { tabsFor } from "@/lib/nav";

/**
 * The section tabs, as on /missions, but these are pages, so they are links in a nav and the
 * current one is marked with aria-current. Only sections that exist are listed (src/lib/nav.ts).
 * Plain links: moving between sections is a full page load, so a page is always one Release.
 */
export function TabBar({ basePath, pathname, claims }: { basePath: string; pathname: string; /** The Release being served holds a Claim. */ claims: boolean }) {
  return (
    <nav aria-label="Sections" className="border-b border-line-strong">
      <ul className="mx-auto -mb-px flex max-w-[1400px] gap-1 overflow-x-auto px-4 lg:px-6">
        {tabsFor(pathname, { claims }).map((tab) => (
          <li key={tab.href} className="shrink-0">
            <a
              href={`${basePath}${tab.href}`}
              aria-current={tab.current ? "page" : undefined}
              className={`press block border-b-2 px-3 pb-2 pt-1.5 text-sm ${
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
