/** Periods and numbers in words. Pure; the calendar is UTC and the language is fixed (en). */
import { FREQUENCIES, periodBounds, type Frequency } from "@macro-atlas/core";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDINALS = ["first", "second", "third", "fourth"];

export type PeriodLike = { period: string; period_start: string };

const dayParts = (date: string): [number, number, number] => [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];

export function dayWords(date: string, style: "long" | "short" = "long"): string {
  const [y, m, d] = dayParts(date);
  const month = MONTHS[m - 1] ?? "";
  return `${d} ${style === "long" ? month : month.slice(0, 3)} ${y}`;
}

/** "September 2026", "the third quarter of 2026", "2026", "5 November 2024", "the week of 12 January 2026". */
export function periodWords(freq: Frequency, p: PeriodLike, style: "long" | "short" = "long"): string {
  const [y, m] = dayParts(p.period_start);
  switch (freq) {
    case "annual":
      return String(y);
    case "quarterly": {
      const q = Math.floor((m - 1) / 3);
      return style === "long" ? `the ${ORDINALS[q]} quarter of ${y}` : `${y} Q${q + 1}`;
    }
    case "monthly":
      return `${style === "long" ? MONTHS[m - 1] : MONTHS[m - 1]!.slice(0, 3)} ${y}`;
    case "weekly":
      return style === "long" ? `the week of ${dayWords(p.period_start)}` : `week of ${dayWords(p.period_start, "short")}`;
    default:
      return dayWords(p.period_start, style);
  }
}

/** "in September 2026", "on 5 November 2024". */
export const preposition = (freq: Frequency): "in" | "on" => (freq === "daily" || freq === "business_daily" || freq === "irregular" ? "on" : "in");

export const FREQ_NOUN: Record<Frequency, string> = {
  daily: "day",
  business_daily: "business day",
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  annual: "year",
  irregular: "observation",
};
export const FREQ_WORD: Record<Frequency, string> = {
  daily: "daily",
  business_daily: "every business day",
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "annual",
  irregular: "irregular (no fixed cadence)",
};

/** How many decimals a value is shown with when read, not computed with (v1's rule for a list). */
export function readingDecimals(value: number): number {
  const size = Math.abs(value);
  const most = size >= 10_000 ? 0 : size >= 100 ? 1 : 2;
  const text = value.toFixed(most);
  return text.includes(".") ? text.replace(/0+$/, "").split(".")[1]!.length : 0;
}

export function fixed(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** Values that appear together in one sentence carry the same number of decimals. */
export function together(values: number[]): string[] {
  const decimals = Math.max(0, ...values.map(readingDecimals));
  return values.map((v) => fixed(v, decimals));
}

/** How many decimals hold `value` exactly, up to `cap`; null when more would be needed. */
export function exactDecimals(value: number, cap: number): number | null {
  for (let d = 0; d <= cap; d++) if (Number(value.toFixed(d)) === value) return d;
  return null;
}

export const list = (items: string[]): string =>
  items.length <= 1 ? items.join("") : items.length === 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/**
 * Where a Period label written in the Catalog (a break's) starts, whether or not the Series has
 * an Observation there. The Series' own frequency is tried first, then any other the label fits
 * (a break in an irregular Series may be dated by a month). Null when the label fits none.
 */
export function labelStart(freq: Frequency, label: string): { freq: Frequency; period: string; period_start: string } | null {
  for (const candidate of [freq, ...FREQUENCIES.filter((f) => f !== freq)]) {
    const bounds = periodBounds(candidate, label);
    if (bounds) return { freq: candidate, period: label, period_start: bounds.start };
  }
  return null;
}
