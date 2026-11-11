/**
 * The catalog page's view of a Release (PLAN section 3, `/data`): every Series the Release
 * knows, narrowed by a search and four filters, with a latest value only where the rights gate
 * allows one. Pure apart from the Release it is given; values come through Query.
 *
 * Withheld is visible: a withheld Series is listed by name with the reason and nothing else.
 */
import type { Surface } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { latestValue } from "./query";
import type { OpenedRelease } from "./release/reader";

const SEGMENTS: Record<string, string> = {
  economy_jobs: "Economy & jobs",
  markets_money: "Markets & money",
  infrastructure: "Infrastructure",
  governance_politics: "Governance & politics",
  disasters_health: "Disasters & health",
  us_in_the_world: "The US in the world",
};
export const FREQUENCIES: Record<string, string> = {
  daily: "Daily",
  business_daily: "Business daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  irregular: "Irregular",
};
/** How a Series was obtained (its Channel). An unknown one is shown as it is written. */
const VIAS: Record<string, string> = {
  direct: "Direct from the origin",
  fred: "FRED",
  yahoo: "Yahoo Finance",
  hand_entered: "Entered by hand",
  computed: "Computed by v1",
};
const RIGHTS: Record<string, string> = {
  public_domain: "Public domain",
  cc_by: "CC BY",
  citation_required: "Citation required",
  permission_required: "Permission required",
  no_redistribution: "No redistribution",
  unknown: "Not settled",
};
const LEGACY = "legacy_monthly_rounded";
const MAX_QUERY = 100;

const FACETS = {
  segment: { labels: SEGMENTS, of: (e: CatalogEntry) => e.segment as string },
  freq: { labels: FREQUENCIES, of: (e: CatalogEntry) => e.freq as string },
  via: { labels: VIAS, of: (e: CatalogEntry) => e.source.channel.via },
  rights: { labels: RIGHTS, of: (e: CatalogEntry) => e.rights.status as string },
} as const;
export type FacetName = keyof typeof FACETS;
export const FACET_NAMES = Object.keys(FACETS) as FacetName[];

export type CatalogFilters = { q: string } & Record<FacetName, string | null>;
export type FacetOption = { value: string; label: string; count: number };

export type CatalogRow = {
  key: string;
  name: string;
  description: string | null;
  unit: string;
  frequency: string;
  /** First and last Period labels; null when the Series has no values here. */
  first: string | null;
  last: string | null;
  origin: string;
  originId: string | null;
  via: string;
  rights: string;
  /** Carried over from v1's rounded monthly output. */
  legacy: boolean;
  state: "shown" | "withheld" | "not_permitted";
  /** Why there are no values, when there are none. */
  reason: string | null;
  latest: { period: string; text: string } | null;
};

export type CatalogView = {
  total: number;
  rows: CatalogRow[];
  filters: CatalogFilters;
  facets: Record<FacetName, FacetOption[]>;
  /** Whether a search or filter is narrowing the list. */
  active: boolean;
};

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";

/** The filters as asked for. Whether a facet value occurs is decided against a Release, in `catalogView`. */
export function parseCatalogFilters(params: Params): CatalogFilters {
  const filters: CatalogFilters = { q: one(params.q).trim().slice(0, MAX_QUERY), segment: null, freq: null, via: null, rights: null };
  for (const name of FACET_NAMES) filters[name] = one(params[name]) || null;
  return filters;
}

/** Rounded for reading only (the Release holds the value as it is): v1's rule for a list. */
export function formatValue(value: number): string {
  const size = Math.abs(value);
  const digits = size >= 10_000 ? 0 : size >= 100 ? 1 : 2;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function releaseHoldsLegacy(release: Pick<OpenedRelease, "catalog">): boolean {
  return release.catalog.series.some((entry) => entry.representation === LEGACY);
}

const label = (labels: Record<string, string>, value: string): string => labels[value] ?? value;

function facetOptions(entries: readonly CatalogEntry[], name: FacetName): FacetOption[] {
  const { labels, of } = FACETS[name];
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(of(entry), (counts.get(of(entry)) ?? 0) + 1);
  // In the order the labels are declared (the site's own order), then anything unforeseen.
  const order = [...Object.keys(labels).filter((v) => counts.has(v)), ...[...counts.keys()].filter((v) => !(v in labels)).sort()];
  return order.map((value) => ({ value, label: label(labels, value), count: counts.get(value)! }));
}

function haystack(entry: CatalogEntry): string {
  const { origin } = entry.source;
  return [entry.name, entry.key, entry.description, entry.unit, origin.producer, origin.dataset, origin.origin_id, ...(entry.aliases ?? [])]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function catalogView(release: OpenedRelease, surface: Surface, asked: CatalogFilters): CatalogView {
  const entries = release.catalog.series;
  const facets = Object.fromEntries(FACET_NAMES.map((name) => [name, facetOptions(entries, name)])) as CatalogView["facets"];
  // A facet value that does not occur in this Release is no filter (a link from another Release still opens).
  const filters: CatalogFilters = { ...asked };
  for (const name of FACET_NAMES) {
    if (filters[name] !== null && !facets[name].some((option) => option.value === filters[name])) filters[name] = null;
  }
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  const withheld = new Map(release.manifest.withheld.map((row) => [row.key, row.reason]));

  const rows: CatalogRow[] = [];
  for (const entry of entries) {
    if (FACET_NAMES.some((name) => filters[name] !== null && FACETS[name].of(entry) !== filters[name])) continue;
    if (words.length > 0) {
      const text = haystack(entry);
      if (!words.every((word) => text.includes(word))) continue;
    }
    const row: CatalogRow = {
      key: entry.key,
      name: entry.name,
      description: entry.description ?? null,
      unit: entry.unit,
      frequency: label(FREQUENCIES, entry.freq),
      first: null,
      last: null,
      origin: entry.source.origin.producer,
      originId: entry.source.origin.origin_id ?? null,
      via: label(VIAS, entry.source.channel.via),
      rights: label(RIGHTS, entry.rights.status),
      legacy: entry.representation === LEGACY,
      state: "shown",
      reason: null,
      latest: null,
    };
    const latest = latestValue(release, surface, entry.key);
    if (!latest.ok) {
      row.state = latest.code === "withheld" ? "withheld" : "not_permitted";
      row.reason = withheld.get(entry.key) ?? latest.message;
    } else {
      const file = release.series[entry.key] ?? release.derived[entry.key];
      row.first = file?.observations[0]?.period ?? null;
      row.last = file?.observations.at(-1)?.period ?? null;
      if (latest.period !== null) row.latest = { period: latest.period, text: formatValue(latest.value) };
    }
    rows.push(row);
  }
  return { total: entries.length, rows, filters, facets, active: words.length > 0 || FACET_NAMES.some((name) => filters[name] !== null) };
}
