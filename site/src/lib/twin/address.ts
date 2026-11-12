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
export const internalTwinPath = (pathname: string): boolean => /^\/data\/[^/]+\/twin(\/|$)/.test(pathname);
