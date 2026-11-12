/**
 * Events as pages (PLAN section 3 and M19): the index (`/events`) and one Event (`/events/{id}`).
 *
 * An Event is a dated or spanning occurrence recorded with citations and shown as context beside
 * Series (CONTEXT.md). Everything on these pages is the Event's own cited text, a label, or a
 * fact of the record: nothing here evaluates, and no Event is said to have caused a movement.
 * Both views are pure functions of one Release; the pages render them with no script.
 */
import { periodBounds, type Surface } from "@macro-atlas/core";
import type { Event } from "@macro-atlas/core/release";
import { EVENT_LABELS } from "./explorer/view";
import { V1_EVENT_CATEGORIES } from "./explorer/state";
import { fixed, readingDecimals } from "./figure/words";
import { eventWhen } from "./event-words";
import { isEventId } from "./event-address";
import { latestValue } from "./query";
import type { OpenedRelease } from "./release/reader";

/** v1's five in v1's order, then the three M19 added. */
export const EVENT_CATEGORIES: readonly string[] = [...V1_EVENT_CATEGORIES, "disaster", "infrastructure", "legislation"];
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1).replaceAll("_", " ");
export { eventWhen };
export const categoryLabel = (category: string): string => EVENT_LABELS[category] ?? sentence(category);

// --- the index ------------------------------------------------------------------------------------

export type EventFilters = { cat: string | null };

export function parseEventFilters(raw: Record<string, string | string[] | undefined>): EventFilters {
  const one = Array.isArray(raw.cat) ? raw.cat[0] : raw.cat;
  return { cat: typeof one === "string" && one !== "" ? one.slice(0, 40) : null };
}

export type EventIndexRow = { id: string; when: string; category: string; title: string; /** Without the base path. */ href: string; draft: boolean };
export type EventsIndexView = {
  total: number;
  shown: number;
  /** How many of the Events listed are drafts (a local-profile Release only). */
  drafts: number;
  /** "All", then each category the Release has: its count and the address that shows it. */
  categories: { value: string; label: string; count: number; current: boolean; query: string }[];
  /** Newest year first; within a year, newest first. */
  groups: { year: string; rows: EventIndexRow[] }[];
  /** What the reader should be told about the address, or null. */
  note: string | null;
};

export function eventsIndexView(release: Pick<OpenedRelease, "events">, filters: EventFilters): EventsIndexView {
  const events = release.events.events;
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
  const has = [...EVENT_CATEGORIES.filter((c) => counts.has(c)), ...[...counts.keys()].filter((c) => !EVENT_CATEGORIES.includes(c)).sort()];
  const cat = filters.cat !== null && counts.has(filters.cat) ? filters.cat : null;
  const note =
    filters.cat !== null && cat === null
      ? EVENT_CATEGORIES.includes(filters.cat)
        ? `This release holds no ${categoryLabel(filters.cat).toLowerCase()} events. Every event is listed.`
        : "The category in the address is not a category of events. Every event is listed."
      : null;
  const listed = events.filter((event) => cat === null || event.category === cat);
  const groups = new Map<string, EventIndexRow[]>();
  // The Release keeps Events oldest first; a reader of the index wants the newest at the top.
  for (const event of [...listed].reverse()) {
    const year = event.date.slice(0, 4);
    const row: EventIndexRow = { id: event.id, when: eventWhen(event, "short"), category: categoryLabel(event.category), title: event.title, href: `/events/${event.id}`, draft: event.status === "draft" };
    groups.set(year, [...(groups.get(year) ?? []), row]);
  }
  return {
    total: events.length,
    shown: listed.length,
    drafts: listed.filter((event) => event.status === "draft").length,
    categories: [
      { value: "", label: "All", count: events.length, current: cat === null, query: "" },
      ...has.map((value) => ({ value, label: categoryLabel(value), count: counts.get(value)!, current: value === cat, query: `cat=${value}` })),
    ],
    groups: [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([year, rows]) => ({ year, rows })),
    note,
  };
}

// --- one Event -------------------------------------------------------------------------------------

export type EventSource = { name: string | null; url: string; archive: string | null; /** Why there is no archived copy. */ noArchive: string | null };
export type EventPageView = {
  id: string;
  title: string;
  when: string;
  category: string;
  /** The address of the index narrowed to this category. */
  categoryQuery: string;
  draft: boolean;
  /** The description, by paragraph. Empty: none has been written. */
  description: string[];
  magnitude: { words: string; source: EventSource } | null;
  sources: EventSource[];
  topics: string[];
  /** Each related Series: a door where this Release shows it here, the reason where it does not. */
  related: { key: string; name: string; href: string | null; state: string | null }[];
  /** The Explorer on its Series around its date, with its layer on and itself marked; null when it names no Series that can be drawn. */
  explorer: string | null;
};

const https = (url: string | undefined): string | null => (url !== undefined && /^https:\/\//.test(url) ? url : null);
const sourceOf = (s: Event["sources"][number]): EventSource | null => {
  const url = https(s.url);
  return url === null ? null : { name: s.name ?? null, url, archive: https(s.archive_url), noArchive: s.archive_url === undefined ? (s.no_archive ?? "None is recorded.") : null };
};

/** `YYYY-MM`, moved by a number of months. */
function monthsFrom(month: string, by: number): string {
  const at = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(at / 12)).padStart(4, "0")}-${String((at % 12) + 1).padStart(2, "0")}`;
}

export function eventPageView(release: OpenedRelease, surface: Surface, id: string): EventPageView | null {
  if (!isEventId(id)) return null;
  const event = release.events.events.find((e) => e.id === id);
  if (!event) return null;
  const entries = new Map(release.catalog.series.map((entry) => [entry.key, entry]));
  const withheld = new Map(release.manifest.withheld.map((row) => [row.key, row.reason]));
  const drawable: string[] = [];
  const related = event.related_series.map((key) => {
    const entry = entries.get(key);
    if (!entry) return { key, name: key, href: null, state: "Not in this release." };
    const latest = latestValue(release, surface, key);
    if (latest.ok) drawable.push(key);
    const state = latest.ok ? null : latest.code === "withheld" ? `Withheld: ${withheld.get(key) ?? latest.message}` : `Not shown here: ${latest.message}`;
    return { key, name: entry.name, href: `/data/${key}`, state };
  });
  const freq = { year: "annual", month: "monthly", day: "daily" }[event.date_precision];
  const first = periodBounds(freq, event.date)?.start ?? null;
  const last = periodBounds(freq, event.end ?? event.date)?.end ?? null;
  // Two years either side, by whole months: enough to see what the Series were doing around it.
  const explorer =
    drawable.length > 0 && first !== null && last !== null
      ? `s=${drawable.slice(0, 4).join(",")}&from=${monthsFrom(first.slice(0, 7), -24)}&to=${monthsFrom(last.slice(0, 7), 24)}&layers=ev.${event.category}&event=event-${event.id}`
      : null;
  const magnitudeSource = event.magnitude ? sourceOf(event.magnitude.source) : null;
  return {
    id: event.id,
    title: event.title,
    when: eventWhen(event, "long"),
    category: categoryLabel(event.category),
    categoryQuery: `cat=${event.category}`,
    draft: event.status === "draft",
    description: event.description.split(/\n\s*\n/).map((p) => p.trim().replace(/\s*\n\s*/g, " ")).filter(Boolean),
    magnitude: event.magnitude && magnitudeSource ? { words: `${fixed(event.magnitude.value, readingDecimals(event.magnitude.value))} ${event.magnitude.unit}`, source: magnitudeSource } : null,
    sources: event.sources.map(sourceOf).filter((s): s is EventSource => s !== null),
    topics: [...event.topics],
    related,
    explorer,
  };
}
