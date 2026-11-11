/**
 * Periods: the span of time an Observation describes (CONTEXT.md; schema/README.md).
 *
 * A Period is named by a label whose shape depends on the Series' native frequency. This module
 * answers two questions about a label: which calendar days it covers (both ends inclusive) and
 * which Period comes next. The Python twin is `atlas/period.py`; both run
 * `checks/period-cases.json`. A label that does not fit its frequency has no answer (null).
 *
 * Dates are calendar dates with no zone; all arithmetic is on whole days in UTC.
 */

export const FREQUENCIES = [
  "daily",
  "business_daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "irregular",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type PeriodBounds = { start: string; end: string };

const DAY_MS = 86_400_000;
type Span = { start: number; end: number }; // UTC milliseconds at 00:00 of the first and last day

const utc = (year: number, month: number, day: number): number => {
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear does not.
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d.getTime();
};
const pad = (n: number, width: number): string => String(n).padStart(width, "0");
const iso = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
};
/** Monday = 1 ... Sunday = 7. */
const isoWeekday = (ms: number): number => new Date(ms).getUTCDay() || 7;

function day(label: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!m) return null;
  const ms = utc(Number(m[1]), Number(m[2]), Number(m[3]));
  return iso(ms) === label ? ms : null; // rejects 2023-02-29, month 13, day 00
}

/** The Monday that starts ISO week 1 of a year: the week containing 4 January. */
const isoWeekOneMonday = (year: number): number => {
  const jan4 = utc(year, 1, 4);
  return jan4 - (isoWeekday(jan4) - 1) * DAY_MS;
};

function isoWeekLabel(ms: number): string {
  const thursday = ms + (4 - isoWeekday(ms)) * DAY_MS; // the ISO week-year is its Thursday's year
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.round((ms - isoWeekday(ms) * DAY_MS + DAY_MS - isoWeekOneMonday(year)) / (7 * DAY_MS)) + 1;
  return `${pad(year, 4)}-W${pad(week, 2)}`;
}

function span(freq: string, label: string): Span | null {
  if (typeof label !== "string") return null;
  let m: RegExpExecArray | null;
  switch (freq) {
    case "daily":
    case "business_daily":
    case "irregular": {
      const d = day(label);
      if (d === null || (freq === "business_daily" && isoWeekday(d) > 5)) return null;
      return { start: d, end: d };
    }
    case "weekly": {
      if (!(m = /^(\d{4})-W(\d{2})$/.exec(label))) return null;
      const year = Number(m[1]);
      const week = Number(m[2]);
      if (year < 1 || week < 1) return null;
      const monday = isoWeekOneMonday(year) + (week - 1) * 7 * DAY_MS;
      if (isoWeekLabel(monday) !== label) return null; // rejects W53 in a 52-week year
      return { start: monday, end: monday + 6 * DAY_MS };
    }
    case "monthly": {
      if (!(m = /^(\d{4})-(\d{2})$/.exec(label))) return null;
      const year = Number(m[1]);
      const month = Number(m[2]);
      if (year < 1 || month < 1 || month > 12) return null;
      const after = month === 12 ? utc(year + 1, 1, 1) : utc(year, month + 1, 1);
      return { start: utc(year, month, 1), end: after - DAY_MS };
    }
    case "quarterly": {
      if (!(m = /^(\d{4})-Q([1-4])$/.exec(label))) return null;
      const year = Number(m[1]);
      const quarter = Number(m[2]);
      if (year < 1) return null;
      const after = quarter === 4 ? utc(year + 1, 1, 1) : utc(year, quarter * 3 + 1, 1);
      return { start: utc(year, quarter * 3 - 2, 1), end: after - DAY_MS };
    }
    case "annual": {
      if (!(m = /^(\d{4})$/.exec(label))) return null;
      const year = Number(m[1]);
      if (year < 1) return null;
      return { start: utc(year, 1, 1), end: utc(year, 12, 31) };
    }
    default:
      return null;
  }
}

/** The first and last calendar day of the Period, both inclusive, as YYYY-MM-DD. */
export function periodBounds(freq: string, label: string): PeriodBounds | null {
  const s = span(freq, label);
  return s ? { start: iso(s.start), end: iso(s.end) } : null;
}

/** The label of the Period that follows. Null for an irregular Series or a bad label. */
export function nextPeriod(freq: string, label: string): string | null {
  const s = span(freq, label);
  if (!s || freq === "irregular") return null;
  let after = s.end + DAY_MS;
  const d = new Date(after);
  switch (freq) {
    case "daily":
      return iso(after);
    case "business_daily":
      while (isoWeekday(after) > 5) after += DAY_MS;
      return iso(after);
    case "weekly":
      return isoWeekLabel(after);
    case "monthly":
      return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}`;
    case "quarterly":
      return `${pad(d.getUTCFullYear(), 4)}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default:
      return pad(d.getUTCFullYear(), 4);
  }
}
