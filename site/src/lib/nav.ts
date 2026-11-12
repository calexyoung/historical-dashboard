/**
 * The tab bar's contents. A tab is listed here only once its pages exist (PLAN section 3), so
 * nothing in the bar leads to a page that is not built. Paths are without the base path.
 *
 * In the plan's order: Topics · Claims · Explore · Events · Data. The Overview is the front
 * door and has no tab before the statement views exist (v2.3). Topics is shown once the
 * Release being served holds a Topic (M23): a Release written before there were any has none.
 * Claims is shown once the Release being served holds a Claim (M21): a public-profile Release
 * holds only published Claims, so the tab appears with the first one Alex publishes.
 */
const TOPICS = { href: "/topics", label: "Topics" } as const;
const CLAIMS = { href: "/claims", label: "Claims" } as const;
export const TABS: readonly { href: string; label: string }[] = [
  { href: "/explore", label: "Explore" },
  { href: "/events", label: "Events" },
  { href: "/data", label: "Data" },
];

const under = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

export function tabsFor(pathname: string, has: { claims?: boolean; topics?: boolean } = {}): { href: string; label: string; current: boolean }[] {
  return [...(has.topics ? [TOPICS] : []), ...(has.claims ? [CLAIMS] : []), ...TABS].map((tab) => ({ ...tab, current: under(pathname, tab.href) }));
}

/**
 * Pages that exist and have no tab (M22): Highlights is reached from the Overview, and search
 * from the top bar. The Overview itself is the name in the top bar; it has no crumb of its own.
 */
const UNTABBED = [
  { href: "/highlights", label: "Highlights" },
  { href: "/search", label: "Search" },
] as const;

export function breadcrumb(pathname: string): string | null {
  return [TOPICS, CLAIMS, ...TABS, ...UNTABBED].find((tab) => under(pathname, tab.href))?.label ?? null;
}
