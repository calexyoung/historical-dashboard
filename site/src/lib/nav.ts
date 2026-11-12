/**
 * The tab bar's contents. A tab is listed here only once its pages exist (PLAN section 3), so
 * nothing in the bar leads to a page that is not built. Paths are without the base path.
 *
 * In the plan's order: Topics · Claims · Explore · Events · Data. Still to come: Topics (M23).
 * Claims is shown once the Release being served holds a Claim (M21): a public-profile Release
 * holds only published Claims, so the tab appears with the first one Alex publishes.
 */
const CLAIMS = { href: "/claims", label: "Claims" } as const;
export const TABS: readonly { href: string; label: string }[] = [
  { href: "/explore", label: "Explore" },
  { href: "/events", label: "Events" },
  { href: "/data", label: "Data" },
];

const under = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

export function tabsFor(pathname: string, has: { claims?: boolean } = {}): { href: string; label: string; current: boolean }[] {
  return [...(has.claims ? [CLAIMS] : []), ...TABS].map((tab) => ({ ...tab, current: under(pathname, tab.href) }));
}

export function breadcrumb(pathname: string): string | null {
  return [CLAIMS, ...TABS].find((tab) => under(pathname, tab.href))?.label ?? null;
}
