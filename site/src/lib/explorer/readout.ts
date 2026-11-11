/**
 * The readout: what every selected Series says at one date (PLAN section 3, "a readout strip
 * above the chart"; M4, "pinned readout").
 *
 * `readoutAt(model, date)` answers with one row per selected Series, always in the same order and
 * always the same number of rows, so the strip never changes height. A row is the Observation
 * whose Period contains the date (for a held Series: the one standing on that date), named with
 * its own Period, because a pinned month falls inside a quarter and a year. Nothing is
 * interpolated: a Series with no Observation covering the date says so.
 *
 * The model is plain data the server makes once (view.ts) and the page hands to the browser, so
 * a pointer or the arrow keys can move the date without asking the server. Pure; safe to load
 * in a browser.
 */
import type { Frequency, TransformName } from "@macro-atlas/core";
import { dayWords, fixed, periodWords } from "../figure/words";

export type ReadoutSeries = {
  key: string;
  name: string;
  unit: string;
  freq: Frequency;
  continuity: "discrete" | "held";
  /** Colour, line style and symbol as drawn; null when the Series is not drawn. */
  style: { color: number; dash: string | null; symbol: "circle" | "square" | "triangle" | "diamond"; ghost?: true } | null;
  /** Decimals the Series' own values are read with. */
  decimals: number;
  /**
   * One per Observation in the window: Period label, first day, last day, value, value as drawn.
   * A run from a second range is laid over the window: its days are where it is drawn, and a
   * sixth entry is the Period's own first day, which is what the readout names.
   */
  rows: [period: string, start: string, end: string, value: number | null, drawn: number | null, own?: string][];
  /** The last day a held value of this Series stands, where that is not the model's. */
  until?: string;
  /** Why the Series has no values here (withheld, not offered in this mode, ...). */
  absent: string | null;
};

export type ReadoutModel = {
  mode: TransformName;
  /** How a drawn value is written after the Series' own, or null when they are the same thing. */
  drawn: { suffix: string; decimals: number } | null;
  /** Every date a pointer or key can stop at: the first day of each Period in the window. */
  stops: string[];
  /** The day the Release was made: a held value stands no later. */
  until: string;
  series: ReadoutSeries[];
};

export type ReadoutRow = {
  key: string;
  name: string;
  /** The Series' own value, in words; null when no Observation covers the date. */
  value: string | null;
  unit: string;
  /** The Period the value describes ("2020 Q2"). */
  period: string | null;
  /** The value as drawn in the chosen mode ("−1.20 sd"), where that differs. */
  drawn: string | null;
  /** What to say instead of a value. */
  note: string | null;
};

export type Readout = { date: string; words: string; rows: ReadoutRow[] };

/** "Apr 2020" for the first of a month (a month is what a monthly Period is called), else the day. */
export function stopWords(date: string): string {
  const words = dayWords(date, "short");
  return date.endsWith("-01") ? words.slice(2) : words;
}

const signed = (value: number, decimals: number): string => {
  const text = fixed(Math.abs(value), decimals);
  return value < 0 && Number(text.replace(/,/g, "")) !== 0 ? `−${text}` : text;
};

export function readoutAt(model: ReadoutModel, date: string): Readout {
  const rows = model.series.map((s): ReadoutRow => {
    const base = { key: s.key, name: s.name, unit: s.unit };
    if (s.absent !== null) return { ...base, value: null, period: null, drawn: null, note: s.absent };
    let found: ReadoutSeries["rows"][number] | undefined;
    if (s.continuity === "held") {
      // The standing Observation: the last that starts on or before the date. A missing one ends
      // the hold, and nothing stands after the day the Release was made.
      for (const row of s.rows) if (row[1] <= date) found = row;
      if (date > (s.until ?? model.until)) found = undefined;
    } else {
      found = s.rows.find((row) => row[1] <= date && date <= row[2]);
    }
    if (!found) return { ...base, value: null, period: null, drawn: null, note: "No observation covers this date" };
    const [, start, , value, drawn] = found;
    const period = periodWords(s.freq, { period: found[0], period_start: found[5] ?? start }, "short");
    if (value === null) return { ...base, value: null, period, drawn: null, note: "No value" };
    return {
      ...base,
      value: signed(value, s.decimals),
      period,
      drawn: model.drawn && drawn !== null ? `${signed(drawn, model.drawn.decimals)}${model.drawn.suffix}` : null,
      note: null,
    };
  });
  return { date, words: stopWords(date), rows };
}

/** The stop nearest a date (the earlier of two equally near). Null when there are none. */
export function nearestStop(model: ReadoutModel, date: string): string | null {
  const t = Date.parse(`${date}T00:00:00Z`);
  let best: string | null = null;
  let distance = Infinity;
  for (const stop of model.stops) {
    const d = Math.abs(Date.parse(`${stop}T00:00:00Z`) - t);
    if (d < distance) [best, distance] = [stop, d];
  }
  return best;
}

/** The stop `by` places after `from` (before, when negative), held at the ends. From nowhere: the last. */
export function stepStop(model: ReadoutModel, from: string | null, by: number): string | null {
  if (model.stops.length === 0) return null;
  const at = from === null ? -1 : model.stops.indexOf(nearestStop(model, from) ?? "");
  if (at < 0) return model.stops.at(-1)!;
  return model.stops[Math.max(0, Math.min(model.stops.length - 1, at + by))]!;
}
