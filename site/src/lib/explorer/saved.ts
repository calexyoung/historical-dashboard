/**
 * Saved queries (PLAN section 5 and M18; ADR 0032): an Explorer view kept with a Pin and a note.
 *
 * `python -m atlas save` writes them into a local release root (`saved.json`); the site only
 * reads them. `savedAddress` is the strict reading both sides share
 * (checks/explorer-addresses.json): the link "Copy link" gives, everything said outright, in the
 * Explorer's one order. `savedQueries` turns the file's text into the fixed selection a page may
 * show, and drops any entry that is not exactly that: the file is edited by hand and by a
 * command, and nothing in it is trusted.
 *
 * Pure. The page shows saved queries on the local Surface only: a note is a person's own text.
 */
import { MAX_SERIES } from "../query";
import { explorerQuery, parseExplorerParams } from "./state";

export type SavedQuery = { id: string; note: string; /** The view, with its pin. */ query: string; releaseId: string; savedAt: string };

export const MAX_SAVED_SHOWN = 200;
const MAX_NOTE = 280;
const ID = /^sq-\d{8}-[0-9a-f]{8}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** The address as a saved query may hold it, or null: read without a note, complete, and written back unchanged. */
export function savedAddress(query: string): string | null {
  if (query.length > 2000) return null;
  const state = parseExplorerParams(new URLSearchParams(query));
  if (state.notes.length > 0 || state.pinUnread) return null;
  if (state.series === null || state.series.length === 0 || state.series.length > MAX_SERIES) return null;
  if (state.mode === null || state.from === null || state.to === null || state.layers === null) return null;
  // States of a page, not of a view.
  if (state.table || state.pick || state.hi !== null) return null;
  return explorerQuery(state) === query ? query : null;
}

export function savedQueries(text: string): SavedQuery[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const entries = typeof doc === "object" && doc !== null && Array.isArray((doc as { saved?: unknown }).saved) ? (doc as { saved: unknown[] }).saved : [];
  const out: SavedQuery[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, note, query, release_id, saved_at } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || out.some((s) => s.id === id)) continue;
    if (typeof note !== "string" || note.trim() === "" || note.length > MAX_NOTE || /[\u0000-\u001f\u007f]/.test(note)) continue;
    if (typeof saved_at !== "string" || !INSTANT.test(saved_at)) continue;
    if (typeof query !== "string" || typeof release_id !== "string" || savedAddress(query) === null) continue;
    // A saved query is pinned, and to the Release its record names.
    if (parseExplorerParams(new URLSearchParams(query)).pin !== release_id) continue;
    out.push({ id, note, query, releaseId: release_id, savedAt: saved_at });
  }
  // Newest first.
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_SAVED_SHOWN);
}
