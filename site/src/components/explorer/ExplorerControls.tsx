"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { formQuery, useExplorerNav } from "./nav";

export const VIEW_FORM = "explorer-view";

const control = "press hover-control h-9 min-w-0 rounded border border-control bg-raised px-2 text-sm text-ink";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const COMMON: [string, string][] = [["weekly", "Weekly or slower"], ["monthly", "Monthly or slower"], ["quarterly", "Quarterly or slower"], ["annual", "Annual"]];

type Mode = { value: string; label: string; current: boolean; offered: number };

/**
 * Mode, window, a second range to compare with, and the marks at the extremes. A real GET form: with JavaScript off, "Show" sends it and the address is the
 * view. With JavaScript, a change is applied at once and the reader stays where they are; the
 * fields are controlled so that focus stays in the field that was changed.
 *
 * The layer switches under the chart belong to this form too (they name it with `form=`), so
 * one address always carries everything.
 */
export function ExplorerControls({
  action,
  modes,
  selected,
  from,
  to,
  compare,
  extremes,
  asOf,
  freq,
  hidden,
}: {
  action: string;
  modes: Mode[];
  /** How many Series are selected. */
  selected: number;
  from: string | null;
  to: string | null;
  /** The month a second range starts, when two ranges are compared. */
  compare: string | null;
  /** Whether the highest and lowest values are marked. */
  extremes: boolean;
  /** The Cutoff of an as-of view: a date, or an instant as the address wrote it. Null: today's values. */
  asOf: string | null;
  /** The common frequency finer Series are combined to. Null: each at its own. */
  freq: string | null;
  /** What the form must carry that it has no field for: the Series, the pin, the chosen Event. */
  hidden: [string, string][];
}) {
  const go = useExplorerNav();
  const current = modes.find((m) => m.current)!.value;
  const [seen, setSeen] = useState({ current, from, to, compare, extremes, asOf, freq });
  const [known, setKnown] = useState(asOf ?? "");
  const [common, setCommon] = useState(freq ?? "");
  const [mode, setMode] = useState(current);
  const [window_, setWindow] = useState({ from: from ?? "", to: to ?? "", cmp: compare ?? "" });
  const [marks, setMarks] = useState(extremes);
  // The server drew another view (a preset, Back): take its values.
  if (seen.current !== current || seen.from !== from || seen.to !== to || seen.compare !== compare || seen.extremes !== extremes || seen.asOf !== asOf || seen.freq !== freq) {
    setSeen({ current, from, to, compare, extremes, asOf, freq });
    setKnown(asOf ?? "");
    setCommon(freq ?? "");
    setMode(current);
    setWindow({ from: from ?? "", to: to ?? "", cmp: compare ?? "" });
    setMarks(extremes);
  }

  const apply = (form: HTMLFormElement | null) => {
    // After this render, so the form holds the value just chosen.
    queueMicrotask(() => form && go(formQuery(form)));
  };
  const onMonth = (name: "from" | "to" | "cmp") => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setWindow((w) => ({ ...w, [name]: value }));
    if (value === "" || MONTH.test(value)) apply(event.target.form);
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go(formQuery(event.currentTarget));
  };

  return (
    <form id={VIEW_FORM} method="get" action={action} onSubmit={onSubmit} aria-label="View" className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {hidden.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="flex min-w-0 flex-1 basis-full flex-col gap-1 text-xs text-ink-2 sm:basis-72 sm:flex-none">
        Show as
        <select
          name="mode"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            apply(event.target.form);
          }}
          className={`${control} w-full`}
        >
          {modes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
              {selected > 0 && m.offered < selected ? ` (${m.offered} of ${selected} series)` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 basis-[9.5rem] flex-col gap-1 text-xs text-ink-2 sm:flex-none sm:basis-auto">
        From
        <input type="month" name="from" value={window_.from} onChange={onMonth("from")} placeholder="YYYY-MM" pattern="\d{4}-(0[1-9]|1[0-2])" className={`${control} num w-full sm:w-40`} />
      </label>
      <label className="flex min-w-0 flex-1 basis-[9.5rem] flex-col gap-1 text-xs text-ink-2 sm:flex-none sm:basis-auto">
        To
        <input type="month" name="to" value={window_.to} onChange={onMonth("to")} placeholder="YYYY-MM" pattern="\d{4}-(0[1-9]|1[0-2])" className={`${control} num w-full sm:w-40`} />
      </label>
      <label className="flex min-w-0 flex-1 basis-[9.5rem] flex-col gap-1 text-xs text-ink-2 sm:flex-none sm:basis-auto">
        Compare with the range from
        <input type="month" name="cmp" value={window_.cmp} onChange={onMonth("cmp")} placeholder="YYYY-MM" pattern="\d{4}-(0[1-9]|1[0-2])" className={`${control} num w-full sm:w-40`} />
      </label>
      <label className="flex min-w-0 flex-1 basis-[9.5rem] flex-col gap-1 text-xs text-ink-2 sm:flex-none sm:basis-auto">
        Frequency
        <select
          name="freq"
          value={common}
          onChange={(event) => {
            setCommon(event.target.value);
            apply(event.target.form);
          }}
          className={`${control} w-full sm:w-44`}
        >
          <option value="">Each series&rsquo; own</option>
          {COMMON.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 basis-[9.5rem] flex-col gap-1 text-xs text-ink-2 sm:flex-none sm:basis-auto">
        As known before
        {/* An instant (a link may carry one) is kept as it was written; a date gets the date field. */}
        <input
          type={known.includes("T") ? "text" : "date"}
          name="as_of"
          value={known}
          min="1900-01-01"
          onChange={(event) => {
            const value = event.target.value;
            setKnown(value);
            if (value === "" || DAY.test(value)) apply(event.target.form);
          }}
          placeholder="YYYY-MM-DD"
          className={`${control} num w-full sm:w-44`}
        />
      </label>
      <label className={`press flex h-9 cursor-pointer items-center gap-1.5 rounded border px-2 text-sm ${marks ? "border-accent bg-band text-ink" : "border-control bg-raised text-ink-2"}`}>
        <input
          type="checkbox"
          name="ext"
          value="1"
          checked={marks}
          onChange={(event) => {
            setMarks(event.target.checked);
            apply(event.target.form);
          }}
          className="size-4 accent-[var(--color-accent)]"
        />
        Mark highest and lowest
      </label>
      <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
        Show
      </button>
    </form>
  );
}

type Toggle = { token: string; label: string; on: boolean; count: number };
type Band = { token: string; label: string; on: boolean };

/**
 * The layer switches: recessions, each Event category, and one set of bands at a time. They are
 * fields of the view form above (`form=`), so they work with JavaScript off through its "Show"
 * button, and with it they apply at once. The hidden empty `layers` field is what lets a reader
 * clear every box: without it an address with no layers would mean "the defaults".
 */
export function ExplorerLayers({ toggles, bands }: { toggles: Toggle[]; bands: Band[] }) {
  const go = useExplorerNav();
  const key = JSON.stringify([toggles.map((t) => t.on), bands.map((b) => b.on)]);
  const [seen, setSeen] = useState(key);
  const [on, setOn] = useState(() => new Set(toggles.filter((t) => t.on).map((t) => t.token)));
  const [band, setBand] = useState(bands.find((b) => b.on)?.token ?? "");
  if (seen !== key) {
    setSeen(key);
    setOn(new Set(toggles.filter((t) => t.on).map((t) => t.token)));
    setBand(bands.find((b) => b.on)?.token ?? "");
  }
  const apply = () => {
    queueMicrotask(() => {
      const form = document.getElementById(VIEW_FORM);
      if (form instanceof HTMLFormElement) go(formQuery(form));
    });
  };

  return (
    <div data-layers className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <input type="hidden" name="layers" value="" form={VIEW_FORM} />
      <ul className="flex flex-wrap gap-2" aria-label="Layers">
        {toggles.map((t) => (
          <li key={t.token}>
            <label className={`press flex h-8 cursor-pointer items-center gap-1.5 rounded border px-2 text-sm ${on.has(t.token) ? "border-accent bg-band text-ink" : "border-control bg-raised text-ink-2"}`}>
              <input
                type="checkbox"
                name="layers"
                value={t.token}
                form={VIEW_FORM}
                checked={on.has(t.token)}
                onChange={(event) => {
                  setOn((was) => {
                    const next = new Set(was);
                    if (event.target.checked) next.add(t.token);
                    else next.delete(t.token);
                    return next;
                  });
                  apply();
                }}
                className="size-4 accent-[var(--color-accent)]"
              />
              {t.label}
              <span className="num text-xs text-ink-3">{t.count}</span>
            </label>
          </li>
        ))}
      </ul>
      {bands.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Bands
          <select
            name="layers"
            form={VIEW_FORM}
            value={band}
            onChange={(event) => {
              setBand(event.target.value);
              apply();
            }}
            className={control}
          >
            {bands.map((b) => (
              <option key={b.token} value={b.token}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
