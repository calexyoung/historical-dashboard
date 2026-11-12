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

/** The handler a twin's address is sent to, whichever kind of twin it is; null when the path is not a twin's. */
export function twinRouteOf(pathname: string): string | null {
  const series = twinOf(pathname);
  if (series) return twinRoute(series.key, series.format);
  const claim = claimTwinOf(pathname);
  return claim ? claimTwinRoute(claim.id, claim.format) : null;
}

export const internalTwinPath = (pathname: string): boolean => /^\/(data|claims)\/[^/]+\/twin(\/|$)/.test(pathname);
