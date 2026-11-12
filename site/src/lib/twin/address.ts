/**
 * Which addresses are twins (PLAN section 3): `/data/{key}.csv | .json | .metadata.json | .md`.
 * Apart from the rest of the twin module so that the proxy, which only needs to recognise the
 * address, does not carry the engine.
 */
export const TWIN_FORMATS = ["csv", "json", "metadata.json", "md"] as const;
export type TwinFormat = (typeof TWIN_FORMATS)[number];

const TWIN_PATH = /^\/data\/([a-z][a-z0-9_]{0,63})\.(csv|json|metadata\.json|md)$/;

/** The Series and format a path names, without the base path; null when it is not a twin's address. */
export function twinOf(pathname: string): { key: string; format: TwinFormat } | null {
  const match = TWIN_PATH.exec(pathname);
  return match ? { key: match[1]!, format: match[2] as TwinFormat } : null;
}

/** How a format is written in the app's own path (a segment cannot be told from a suffix by its dot). */
const SEGMENT: Record<TwinFormat, string> = { csv: "csv", json: "json", "metadata.json": "metadata", md: "md" };

/**
 * Where the proxy sends a twin's address inside the app: one route handler. The path is the
 * app's own and is not an address: `internalTwinPath` recognises it so the proxy can refuse it
 * when a reader asks for it directly.
 */
export const twinRoute = (key: string, format: TwinFormat): string => `/data/${key}/twin/${SEGMENT[format]}`;
export const formatOfSegment = (segment: string): TwinFormat | null => (Object.entries(SEGMENT).find(([, s]) => s === segment)?.[0] as TwinFormat | undefined) ?? null;

/**
 * A Claim's twins (PLAN section 7, M21): `/claims/{id}.json | .md`, the evidence as a CSV at
 * `/claims/{id}/evidence.csv`, and the lock as it was written at `/claims/{id}/lock.json`.
 */
export const CLAIM_TWIN_FORMATS = ["json", "md", "evidence.csv", "lock.json"] as const;
export type ClaimTwinFormat = (typeof CLAIM_TWIN_FORMATS)[number];
const CLAIM = "[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*";
const CLAIM_TWIN_PATH = new RegExp(`^/claims/(${CLAIM})(?:\\.(json|md)|/(evidence\\.csv|lock\\.json))$`);
const CLAIM_SEGMENT: Record<ClaimTwinFormat, string> = { json: "json", md: "md", "evidence.csv": "evidence", "lock.json": "lock" };

export function claimTwinOf(pathname: string): { id: string; format: ClaimTwinFormat } | null {
  const match = pathname.length <= 200 ? CLAIM_TWIN_PATH.exec(pathname) : null;
  return match ? { id: match[1]!, format: (match[2] ?? match[3]) as ClaimTwinFormat } : null;
}
export const claimTwinRoute = (id: string, format: ClaimTwinFormat): string => `/claims/${id}/twin/${CLAIM_SEGMENT[format]}`;
export const claimFormatOfSegment = (segment: string): ClaimTwinFormat | null => (Object.entries(CLAIM_SEGMENT).find(([, s]) => s === segment)?.[0] as ClaimTwinFormat | undefined) ?? null;

/**
 * The Markdown twin of every other page (PLAN section 3: "every page has a `.md` twin"; M25):
 * the page's address with `.md`, and `/index.md` for the Overview, whose own address has
 * nothing to add a suffix to. A series page and a claim page have twins of their own, above.
 */
const PAGES_WITH_A_TWIN: ReadonlySet<string> = new Set(["/highlights", "/search", "/topics", "/claims", "/events", "/data", "/explore", "/downloads", "/docs/method", "/docs/api", "/docs/rights", "/docs/glossary"]);
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PAGE_UNDER = new RegExp(`^/(?:topics|events|docs/method|docs/glossary)/${SLUG}$`);

/** The page a Markdown twin's address is the twin of, without the base path; null when the path is not one. */
export function pageTwinOf(pathname: string): string | null {
  if (pathname.length > 200 || !pathname.endsWith(".md")) return null;
  const page = pathname.slice(0, -".md".length);
  if (page === "/index") return "/";
  return PAGES_WITH_A_TWIN.has(page) || PAGE_UNDER.test(page) ? page : null;
}
/** The Markdown twin of a page, without the base path; null for a page that has none here. */
export function markdownTwinOf(pathname: string): string | null {
  const page = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (page === "/") return "/index.md";
  if (PAGES_WITH_A_TWIN.has(page) || PAGE_UNDER.test(page)) return `${page}.md`;
  if (/^\/data\/[a-z][a-z0-9_]{0,63}$/.test(page) || new RegExp(`^/claims/${CLAIM}$`).test(page)) return `${page}.md`;
  return null;
}
const PAGE_TWIN = "/page-twin";
export const pageTwinRoute = (page: string): string => `${PAGE_TWIN}${page === "/" ? "/index" : page}`;
/** The page the handler's own path names: the inverse of `pageTwinRoute`. */
export const pageOfSegments = (segments: readonly string[]): string => (segments.length === 1 && segments[0] === "index" ? "/" : `/${segments.join("/")}`);

/** The handler a twin's address is sent to, whichever kind of twin it is; null when the path is not a twin's. */
export function twinRouteOf(pathname: string): string | null {
  const series = twinOf(pathname);
  if (series) return twinRoute(series.key, series.format);
  const claim = claimTwinOf(pathname);
  if (claim) return claimTwinRoute(claim.id, claim.format);
  const page = pageTwinOf(pathname);
  return page ? pageTwinRoute(page) : null;
}

export const internalTwinPath = (pathname: string): boolean => /^\/(data|claims)\/[^/]+\/twin(\/|$)/.test(pathname) || /^\/page-twin(\/|$)/.test(pathname);
