"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { SearchAnswer } from "@/lib/search";
import { useHydrated } from "./explorer/nav";

const MAX_QUERY = 100;
const HELD: Record<string, string> = { withheld: "Withheld", not_permitted: "Not shown here" };

/** Whether a key press belongs to something the reader is typing into. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Search, from the top bar of every page (PLAN 4.6, M22).
 *
 * With JavaScript off it is a link to `/search`, which is the same search as a page. With
 * JavaScript, the link (or the "/" key, when the reader is not typing in a field) opens a
 * sheet: a field that has focus at once, and under it the hits for what has been typed,
 * grouped by kind, each a link. Enter goes to `/search` for the whole list. The arrow keys move
 * between the field and the hits; Escape shuts the sheet, whatever is typed, and focus goes
 * back to where it was before the sheet opened.
 *
 * It never animates, opening or closing: it is opened from the keyboard many times a day, and
 * a keyboard action is answered at once (PLAN section 8). The hits come from this site's own
 * `/search/hits`, for the Release the page was made from; they are names and addresses.
 */
export function SearchSheet({ basePath }: { basePath: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  // Said on the door once the "/" key is being listened for (a test waits for it; a reader
  // who presses the key before then gets what the browser does with it).
  const ready = useHydrated();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || typing(event.target)) return;
      const d = dialog.current;
      // Not over another dialog (the series picker): that one has the reader's attention.
      if (!d || typeof d.showModal !== "function" || d.open || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      d.showModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The hits for what is typed, a moment after the reader stops; an answer that arrives late is dropped.
  useEffect(() => {
    const asked = q.trim();
    if (asked === "") return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${basePath}/search/hits?q=${encodeURIComponent(asked)}`, { signal: abort.signal, headers: { accept: "application/json" } })
        .then((response) => (response.ok ? (response.json() as Promise<SearchAnswer>) : Promise.reject(new Error(String(response.status)))))
        .then((found) => {
          setAnswer(found);
          setFailed(false);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === "AbortError") return;
          // Hits for an earlier question are not left standing under the notice.
          setAnswer(null);
          setFailed(true);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [q, basePath]);

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const d = dialog.current;
    if (!d || typeof d.showModal !== "function" || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (!d.open) d.showModal();
  };
  const onClose = () => {
    setQ("");
    setAnswer(null);
    setFailed(false);
    // Focus goes back to where it was, which the browser does for a modal dialog: the door in
    // the top bar after a press, the reader's own place in the page after the "/" key.
  };
  /** Down from the field into the hits, up and down among them, and up from the first back to the field. */
  const move = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      // A search field takes the first Escape to empty itself; here Escape always shuts the sheet.
      event.preventDefault();
      dialog.current?.close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-hit]") ?? [])];
    if (links.length === 0) return;
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    if (next >= links.length) return;
    event.preventDefault();
    if (next < 0) field.current?.focus();
    else links[next]!.focus();
  };

  const asked = q.trim() !== "";
  // While the next answer is on its way the last one stays, so the list does not blink at
  // every key; the list says it is busy, and an answer that fails takes the old hits with it.
  const shown = asked ? answer : null;
  const pending = asked && !failed && (shown === null || shown.q !== q.trim().slice(0, MAX_QUERY).trim());
  return (
    <>
      <a
        href={`${basePath}/search`}
        onClick={open}
        data-open-search
        data-ready={ready ? "" : undefined}
        aria-haspopup="dialog"
        aria-keyshortcuts="/"
        className="press hover-control inline-flex h-8 items-center gap-2 rounded border border-control bg-raised px-2.5 text-xs text-ink-2"
      >
        Search
        <kbd aria-hidden="true" className="hidden rounded border border-line px-1 font-sans text-xs text-ink-3 sm:inline">
          /
        </kbd>
      </a>
      <dialog
        ref={dialog}
        id="search-sheet"
        aria-label="Search"
        className="search-sheet"
        onClose={onClose}
        onClick={(event) => {
          // A press on the dimmed page behind the sheet shuts it.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onKeyDown={move}
      >
        <form method="get" action={`${basePath}/search`} className="flex items-center gap-2 border-b border-line p-3">
          <label className="sr-only" htmlFor="sheet-q">
            Search series, events and the glossary
          </label>
          <input
            ref={field}
            id="sheet-q"
            type="search"
            name="q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            maxLength={MAX_QUERY}
            placeholder="Search series, events and the glossary"
            autoComplete="off"
            autoFocus
            className="h-9 min-w-0 flex-1 rounded border border-control bg-raised px-2 text-sm text-ink placeholder:text-ink-3"
          />
          <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
            Search
          </button>
          <button type="button" onClick={() => dialog.current?.close()} className="press h-9 rounded border border-control bg-raised px-3 text-sm text-ink">
            Close
          </button>
        </form>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={pending}>
          {!asked && <p className="p-4 text-sm text-ink-2">Type a name, a key or a word. Enter lists every result.</p>}
          {asked && failed && <p className="p-4 text-sm text-ink-2">The results could not be loaded. Press Enter to search on a page.</p>}
          {shown && shown.total === 0 && !failed && (
            <p className="p-4 text-sm text-ink-2" data-no-results>
              Nothing matches &ldquo;{shown.q}&rdquo;.
            </p>
          )}
          {shown?.groups.map((group) => (
            <section key={group.kind} aria-labelledby={`sheet-${group.kind}`} data-group={group.kind}>
              <h2 id={`sheet-${group.kind}`} className="border-b border-line bg-raised px-4 py-1.5 text-xs font-semibold text-ink-2">
                {group.label} <span className="num font-normal text-ink-3">{group.hits.length < group.total ? `${group.hits.length} of ${group.total}` : group.total}</span>
              </h2>
              <ul>
                {group.hits.map((hit) => (
                  <li key={hit.id} className="border-b border-line">
                    <a href={`${basePath}${hit.href}`} data-hit={hit.id} className="hover-ink block px-4 py-2 text-sm text-ink-2">
                      <span className="font-medium text-accent underline underline-offset-2">{hit.title}</span>
                      {hit.held && <span className="ml-2 text-xs font-medium text-ink">{HELD[hit.held]}</span>}
                      {hit.detail && <span className="mt-0.5 block truncate">{hit.detail}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
