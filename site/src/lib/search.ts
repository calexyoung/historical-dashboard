/**
 * Search (PLAN 4.6, M22; ADR 0036): lexical, over an index built when the Release was written.
 *
 * `search(release, surface, q)` reads the Release's own `search.json` (its Series, Events and
 * Claims, as words) and the site's glossary, and answers with hits grouped by kind, in one
 * fixed order. There is no model and no network: a word of the question must begin a word of
 * the entry, every word of the question must be found, and a match in a name counts for more
 * than one in a description.
 *
 * A hit is a name, an address and a line of the entry's own words. It is never a value: the
 * index is made from the Catalog and the content and from no Observation, and nothing here
 * reads one. A Series the rights gate holds back on this Surface is still found by name, as
 * the catalog page lists it, and is marked; whether it is held back is asked of the gate, not
 * taken from the index alone.
 *
 * Hidden here: how a question is cut into words, the ranking, the address of each kind, and
 * the caps. Node only (it takes an opened Release); pure otherwise.
 */
import type { RightsGate, Surface } from "@macro-atlas/core";
import type { SearchEntry } from "@macro-atlas/core/release";
import { dayWords } from "./figure/words";
import { GLOSSARY } from "./glossary";
import { askGate } from "./query";
import type { OpenedRelease } from "./release/reader";

export const MAX_QUERY = 100;
/** Words of a question that are looked for; the rest are ignored. */
const MAX_WORDS = 8;
/** Hits listed in a group unless more are asked for. */
export const SHEET_HITS = 6;
export const PAGE_HITS = 50;
const DETAIL = 160;

export type SearchKind = "series" | "event" | "claim" | "glossary";
export type SearchHit = {
  kind: SearchKind;
  /** The Series key, the Event id, the Claim id or the glossary entry's slug. */
  id: string;
  title: string;
  /** The hit's own page, without the base path. */
  href: string;
  /** A line of the entry's own words: a description, a quote, a definition. May be empty. */
  detail: string;
  /** A Series only: its values are not shown on this Surface (Withheld, or not permitted here). */
  held?: "withheld" | "not_permitted";
};
export type SearchGroup = { kind: SearchKind; label: string; /** How many matched, listed or not. */ total: number; hits: SearchHit[] };
export type SearchAnswer = { q: string; /** False when the question holds no word to look for. */ asked: boolean; groups: SearchGroup[]; total: number };

const GROUPS: readonly { kind: SearchKind; label: string }[] = [
  { kind: "series", label: "Series" },
  { kind: "event", label: "Events" },
  { kind: "claim", label: "Claims" },
  { kind: "glossary", label: "Glossary" },
];
const PATH: Record<SearchKind, string> = { series: "/data", event: "/events", claim: "/claims", glossary: "/docs/glossary" };

/** The question an address carries: the first `q`, trimmed and cut to a length. */
export function parseSearch(params: Record<string, string | string[] | undefined> | URLSearchParams): string {
  const raw = params instanceof URLSearchParams ? params.get("q") : Array.isArray(params.q) ? params.q[0] : params.q;
  return (raw ?? "").trim().slice(0, MAX_QUERY).trim();
}

/** Lower-cased runs of letters and digits. "FX-OUTPUT" is "fx" and "output"; "2024-09-18" is three numbers. */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

const WEIGHT = { title: 8, id: 5, keywords: 3, text: 1 } as const;
type Field = keyof typeof WEIGHT;
type Indexed = { kind: SearchKind; id: string; title: string; detail: string; fields: Record<Field, string[]> };

/** How well an entry answers the question; 0 when a word of the question is found nowhere in it. */
function score(entry: Indexed, asked: readonly string[]): number {
  let total = 0;
  for (const word of asked) {
    let best = 0;
    for (const field of Object.keys(WEIGHT) as Field[]) {
      if (WEIGHT[field] <= best) continue;
      const found = entry.fields[field];
      // A whole word counts a little more than the start of one.
      if (found.includes(word)) best = WEIGHT[field] + 0.5;
      else if (found.some((w) => w.startsWith(word))) best = WEIGHT[field];
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= DETAIL) return line;
  const cut = line.slice(0, DETAIL);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), DETAIL - 30)).replace(/[\s,;:.]+$/, "")}…`;
};

function indexed(entry: SearchEntry): Indexed {
  // A Claim's entry is titled "{claimant}, {day}": the day is said in words on a page.
  const day = entry.kind === "claim" ? /^(.*), (\d{4}-\d{2}-\d{2})$/.exec(entry.title) : null;
  return {
    kind: entry.kind,
    id: entry.id,
    title: day ? `${day[1]}, ${dayWords(day[2]!)}` : entry.title,
    detail: clip(entry.text),
    fields: { title: wordsOf(entry.title), id: wordsOf(entry.id), keywords: entry.keywords.flatMap(wordsOf), text: wordsOf(entry.text) },
  };
}

const GLOSSARY_INDEX: readonly Indexed[] = GLOSSARY.map((entry) => ({
  kind: "glossary",
  id: entry.slug,
  title: entry.term,
  detail: clip(entry.definition),
  fields: { title: wordsOf(entry.term), id: wordsOf(entry.slug), keywords: wordsOf(entry.group), text: wordsOf(entry.definition) },
}));

// An opened Release is immutable (reader.ts): its index is cut into words once.
const cache = new WeakMap<object, Indexed[]>();
function indexOf(release: Pick<OpenedRelease, "search">): Indexed[] {
  let held = cache.get(release.search);
  if (!held) cache.set(release.search, (held = release.search.entries.map(indexed)));
  return held;
}

export type SearchOptions = {
  /** Hits listed in each group. */
  limit?: number;
  /** See `QueryOptions.gate`: only a test passes one. */
  gate?: Pick<RightsGate, "permits">;
};

export function search(release: OpenedRelease, surface: Surface, question: string, options: SearchOptions = {}): SearchAnswer {
  const q = question.trim().slice(0, MAX_QUERY).trim();
  if (q === "") return { q: "", asked: false, groups: [], total: 0 };
  const asked = [...new Set(wordsOf(q))].slice(0, MAX_WORDS);
  if (asked.length === 0) return { q, asked: true, groups: [], total: 0 };
  const limit = Math.max(1, Math.min(options.limit ?? SHEET_HITS, PAGE_HITS));

  const found = new Map<SearchKind, { entry: Indexed; score: number; order: number }[]>();
  let order = 0;
  for (const entry of [...indexOf(release), ...GLOSSARY_INDEX]) {
    const s = score(entry, asked);
    if (s > 0) found.set(entry.kind, [...(found.get(entry.kind) ?? []), { entry, score: s, order }]);
    order++;
  }

  const groups: SearchGroup[] = [];
  for (const { kind, label } of GROUPS) {
    const matched = found.get(kind);
    if (!matched) continue;
    // Best first; equals stay in the index's own order (the Catalog's, the Events', the glossary's).
    matched.sort((a, b) => b.score - a.score || a.order - b.order);
    const hits = matched.slice(0, limit).map(({ entry }): SearchHit => {
      const hit: SearchHit = { kind, id: entry.id, title: entry.title, href: `${PATH[kind]}/${entry.id}`, detail: entry.detail };
      if (kind === "series") {
        // Asked of the gate for this Surface, as a page would ask before showing a value.
        const allowed = askGate(release, surface, [entry.id], "display", { gate: options.gate });
        if (!allowed.ok) hit.held = allowed.code === "withheld" ? "withheld" : "not_permitted";
      }
      return hit;
    });
    groups.push({ kind, label, total: matched.length, hits });
  }
  return { q, asked: true, groups, total: groups.reduce((n, g) => n + g.total, 0) };
}
