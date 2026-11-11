/**
 * The tab bar's contents. A tab is listed here only once its pages exist (PLAN section 3), so
 * nothing in the bar leads to a page that is not built. Paths are without the base path.
 *
 * In the plan's order: Topics · Claims · Explore · Events · Data. Still to come: Topics (M23),
 * Claims (M21, once the first claim is public), Events (M19).
 */
export const TABS: readonly { href: string; label: string }[] = [
  { href: "/explore", label: "Explore" },
  { href: "/data", label: "Data" },
];

const under = (pathname: string, href: string): boolean => pathname === href || pathname.startsWith(`${href}/`);

export function tabsFor(pathname: string): { href: string; label: string; current: boolean }[] {
  return TABS.map((tab) => ({ ...tab, current: under(pathname, tab.href) }));
}

export function breadcrumb(pathname: string): string | null {
  return TABS.find((tab) => under(pathname, tab.href))?.label ?? null;
}
