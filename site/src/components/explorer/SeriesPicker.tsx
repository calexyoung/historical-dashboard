"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { formQuery, tidyQuery, useExplorerNav, useHydrated } from "./nav";

type Row = { key: string; name: string; detail: string; checked: boolean; available: boolean };
type Group = { label: string; series: Row[] };

const button = "press inline-flex h-9 items-center rounded border border-control bg-raised px-3 text-sm font-medium text-ink";
/** A phone shows about four Series clearly (PLAN section 3). Advice, not a limit. */
const PHONE_SOFT_CAP = 4;

/**
 * The series picker: a bottom sheet on a phone, a drawer at the side from 1024px (PLAN section 3
 * and 8). It is a `<dialog>` holding a GET form of every Series in the Release.
 *
 * With JavaScript off, "Choose series" is a link to this page with `pick=1`, which the server
 * answers with the dialog already open, and "Show these series" sends the form. With JavaScript
 * the same link opens the dialog as a modal (the browser then keeps focus inside it and closes
 * it on Escape), a ticked box is applied at once so the chart behind changes, and a field
 * narrows the list.
 *
 * The sheet slides (240 ms in, 180 ms out, CSS transitions in globals.css) when a pointer opens
 * it. Opened from the keyboard it appears at once: keyboard actions never animate.
 */
export function SeriesPicker({
  action,
  groups,
  selected,
  max,
  hidden,
  initialOpen,
  openHref,
  closeHref,
}: {
  action: string;
  groups: Group[];
  /** The selected keys, in the order drawn. */
  selected: string[];
  max: number;
  /** What the form must carry that it has no field for: mode, window, layers, pin, Event. */
  hidden: [string, string][];
  /** The address asked for the picker open (`pick=1`). */
  initialOpen: boolean;
  openHref: string;
  closeHref: string;
}) {
  const go = useExplorerNav();
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const ready = useHydrated();
  const [filter, setFilter] = useState("");
  const key = selected.join(",");
  const [seen, setSeen] = useState(key);
  const [keys, setKeys] = useState(selected);
  if (seen !== key) {
    setSeen(key);
    setKeys(selected);
  }

  useEffect(() => {
    const d = dialog.current;
    // Opened by the server for a reader without JavaScript: make it the modal it would have been.
    if (d && d.open && !d.matches(":modal")) {
      d.dataset.instant = "";
      d.close();
      d.showModal();
    }
  }, []);

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    const d = dialog.current;
    if (!d || typeof d.showModal !== "function" || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    // `detail` is 0 when a key pressed the link, and a key never animates.
    if (event.detail === 0) d.dataset.instant = "";
    else delete d.dataset.instant;
    if (!d.open) d.showModal();
  };
  const close = (event?: MouseEvent) => {
    event?.preventDefault();
    const d = dialog.current;
    if (!d) return;
    if (event && event.detail === 0) d.dataset.instant = "";
    d.close();
  };
  const onClose = () => {
    setFilter("");
    // The address said `pick=1`: it should not say so once the picker is shut.
    if (new URLSearchParams(window.location.search).get("pick") === "1" && form.current) go(formQuery(form.current), "replace");
    opener.current?.focus({ preventScroll: true });
  };

  const toggle = (rowKey: string, on: boolean) => {
    const next = on ? [...keys.filter((k) => k !== rowKey), rowKey] : keys.filter((k) => k !== rowKey);
    setKeys(next); // shown at once; the server's answer then confirms it
    // In the order chosen, not the list's: the form alone would send them in the list's order.
    const params = new URLSearchParams(hidden);
    params.set("s", next.join(","));
    go(tidyQuery(params));
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dialog.current?.close();
  };

  const words = filter.trim().toLowerCase();
  const matches = (row: Row) => words === "" || `${row.name} ${row.key} ${row.detail}`.toLowerCase().includes(words);
  const full = keys.length >= max;
  const shownCount = groups.reduce((n, g) => n + g.series.filter(matches).length, 0);

  return (
    <>
      <a ref={opener} href={openHref} onClick={open} data-open-picker aria-haspopup="dialog" className={button}>
        Choose series
        <span className="num ml-1.5 text-ink-3">
          {keys.length} of {max}
        </span>
      </a>
      {keys.length > PHONE_SOFT_CAP && (
        <p data-soft-cap className="basis-full text-xs text-ink-2 sm:hidden">
          {keys.length} series are selected. About {PHONE_SOFT_CAP} is what a phone shows clearly.
        </p>
      )}
      <dialog
        ref={dialog}
        id="series-picker"
        aria-labelledby="series-picker-title"
        // The server's `open` (for `pick=1`) is left as it arrived; from then on the browser owns it.
        open={typeof window === "undefined" ? initialOpen : undefined}
        suppressHydrationWarning
        onClose={onClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) close(); // the backdrop
        }}
        className="sheet"
      >
        <form ref={form} method="get" action={action} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <h2 id="series-picker-title" className="mr-auto text-[13px] font-bold uppercase tracking-[0.06em] text-ink">
              Series
              <span className="num ml-2 font-normal normal-case tracking-normal text-ink-3">
                {keys.length} of {max} selected
              </span>
            </h2>
            <a href={closeHref} onClick={close} data-close-picker className={button}>
              Done
            </a>
          </header>
          {hidden.map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input type="hidden" name="s" value="" />
          <div className="border-b border-line px-4 py-2">
            {ready && (
              <>
                <label htmlFor="series-filter" className="sr-only">
                  Narrow the list
                </label>
                <input
                  id="series-filter"
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Narrow by name, key or unit"
                  autoComplete="off"
                  className="h-9 w-full rounded border border-control bg-raised px-2 text-sm text-ink placeholder:text-ink-3"
                />
              </>
            )}
            <p role="status" className="mt-1 min-h-[18px] text-xs text-ink-2">
              {full ? `${max} series is the most the chart shows. Clear one to add another.` : words !== "" ? `${shownCount} match` : ""}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
            {groups.map((group) => {
              const rows = group.series.filter(matches);
              if (rows.length === 0) return null;
              return (
                <fieldset key={group.label} className="mt-3 min-w-0">
                  <legend className="text-xs font-semibold text-ink-2">{group.label}</legend>
                  <ul className="mt-1">
                    {rows.map((row) => {
                      const checked = keys.includes(row.key);
                      const disabled = !row.available || (full && !checked);
                      return (
                        <li key={row.key} className="border-b border-line last:border-b-0">
                          <label className={`flex min-h-9 items-center gap-2 py-1 text-sm ${disabled ? "text-ink-3" : "cursor-pointer text-ink"}`}>
                            <input type="checkbox" name="s" value={row.key} checked={checked} disabled={disabled} onChange={(event) => toggle(row.key, event.target.checked)} className="size-4 shrink-0 accent-[var(--color-accent)]" />
                            <span className="min-w-0 flex-1">{row.name}</span>
                            <span className="max-w-[45%] shrink-0 truncate text-xs text-ink-3">{row.detail}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              );
            })}
            {shownCount === 0 && <p className="mt-3 text-sm text-ink-2">No series match.</p>}
          </div>
          {!ready && (
            <footer className="border-t border-line px-4 py-3">
              <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
                Show these series
              </button>
            </footer>
          )}
        </form>
      </dialog>
    </>
  );
}
