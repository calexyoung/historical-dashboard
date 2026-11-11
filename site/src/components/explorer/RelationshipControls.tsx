"use client";

import { useState, type FormEvent } from "react";
import { formQuery, useExplorerNav } from "./nav";

const control = "press hover-control h-9 min-w-0 rounded border border-control bg-raised px-2 text-sm text-ink";
const field = "flex min-w-0 flex-1 basis-[9.5rem] flex-col gap-1 text-xs text-ink-2 sm:flex-none sm:basis-auto";

type Option = { key: string; name: string };

/**
 * The pair, the basis, the lag and the rolling span. A real GET form, like the view's: with
 * JavaScript off "Show" sends it. With JavaScript a choice applies at once and the reader stays
 * where they are. The lag is typed or stepped, and applies when the field is left or Enter is
 * pressed, so that stepping through lags does not ask the server at every step.
 */
export function RelationshipControls({
  action,
  series,
  x,
  y,
  levels,
  lag,
  maxLag,
  lagUnit,
  roll,
  hidden,
}: {
  action: string;
  series: Option[];
  x: string;
  y: string;
  levels: boolean;
  lag: number;
  maxLag: number;
  /** What a lag counts: "months", "quarters", "years". */
  lagUnit: string;
  roll: 24 | 36;
  /** Everything else the address says. */
  hidden: [string, string][];
}) {
  const go = useExplorerNav();
  const key = JSON.stringify([x, y, levels, lag, roll]);
  const [seen, setSeen] = useState(key);
  const [value, setValue] = useState({ x, y, basis: levels ? "lvl" : "chg", lag: String(lag), roll: String(roll) });
  if (seen !== key) {
    setSeen(key);
    setValue({ x, y, basis: levels ? "lvl" : "chg", lag: String(lag), roll: String(roll) });
  }
  const apply = (form: HTMLFormElement | null) => queueMicrotask(() => form && go(formQuery(form)));
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go(formQuery(event.currentTarget));
  };
  const select = (name: "x" | "y" | "basis" | "roll") => (event: React.ChangeEvent<HTMLSelectElement>) => {
    setValue((v) => ({ ...v, [name]: event.target.value }));
    apply(event.target.form);
  };

  return (
    <form method="get" action={action} onSubmit={onSubmit} aria-label="Relationship" data-relationship-form className="flex flex-wrap items-end gap-x-3 gap-y-2">
      {hidden.map(([name, v]) => (
        <input key={name} type="hidden" name={name} value={v} />
      ))}
      <label className={field}>
        X
        <select name="sx" value={value.x} onChange={select("x")} className={`${control} w-full sm:w-52`}>
          {series.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Y
        <select name="sy" value={value.y} onChange={select("y")} className={`${control} w-full sm:w-52`}>
          {series.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        Compared on
        <select name="basis" value={value.basis} onChange={select("basis")} className={`${control} w-full`}>
          <option value="chg">Changes from the period before</option>
          <option value="lvl">Levels</option>
        </select>
      </label>
      <label className={field}>
        Lag, in {lagUnit} (X leads when above 0)
        <input
          type="number"
          name="lag"
          min={-maxLag}
          max={maxLag}
          step={1}
          inputMode="numeric"
          value={value.lag}
          onChange={(event) => setValue((v) => ({ ...v, lag: event.target.value }))}
          onBlur={(event) => {
            if (event.target.value !== String(lag)) apply(event.target.form);
          }}
          className={`${control} num w-full sm:w-24`}
        />
      </label>
      <label className={field}>
        Rolling window
        <select name="roll" value={value.roll} onChange={select("roll")} className={`${control} w-full`}>
          <option value="36">36 months</option>
          <option value="24">24 months</option>
        </select>
      </label>
      <button type="submit" className="press h-9 rounded border border-accent bg-accent px-3 text-sm font-semibold text-void">
        Show
      </button>
    </form>
  );
}
