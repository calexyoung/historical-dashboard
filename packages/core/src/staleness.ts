/**
 * Staleness: whether a Series' last Period trails the Release it is in by more than the Catalog
 * allows (schema/README.md, "Staleness has a fixed clock").
 *
 * The clock is the Release's `created`, never today, so the answer for a Release never changes.
 * `max_lag` is a count of days, weeks, months or years (`P45D`, `P2W`, `P3M`, `P2Y`). Months and
 * years are calendar ones; a day that the target month lacks becomes that month's last day.
 * A Series is stale when the day `created` falls on is after `period_end + max_lag`.
 *
 * Pure. With no limit recorded, or one that cannot be read, the answer is "not known": an
 * absent limit is never replaced by a default.
 */
export type Staleness =
  | { known: false }
  | { known: true; stale: boolean; /** The last day on which the Series was still within its limit. */ limit: string };

const LAG = /^P([1-9][0-9]*)([DWMY])$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

export function staleness(lastPeriodEnd: string, maxLag: string | undefined, created: string): Staleness {
  const lag = LAG.exec(maxLag ?? "");
  const end = DAY.exec(lastPeriodEnd);
  const made = DAY.exec(created);
  if (!lag || !end || !made) return { known: false };
  const count = Number(lag[1]);
  let [year, month, day] = [Number(end[1]), Number(end[2]), Number(end[3])];
  if (lag[2] === "D" || lag[2] === "W") {
    // Let Date carry days across months and years (setUTCFullYear, so years 1 to 99 stay themselves).
    const carried = new Date(Date.UTC(2000, 0, 1));
    carried.setUTCFullYear(year, month - 1, day + count * (lag[2] === "W" ? 7 : 1));
    [year, month, day] = [carried.getUTCFullYear(), carried.getUTCMonth() + 1, carried.getUTCDate()];
  } else {
    const months = year * 12 + (month - 1) + count * (lag[2] === "Y" ? 12 : 1);
    year = Math.floor(months / 12);
    month = (months % 12) + 1;
    const last = new Date(Date.UTC(2000, month, 0));
    last.setUTCFullYear(year, month, 0);
    day = Math.min(day, last.getUTCDate());
  }
  if (year > 9999) return { known: true, stale: false, limit: "9999-12-31" };
  const limit = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  return { known: true, stale: created.slice(0, 10) > limit, limit };
}
