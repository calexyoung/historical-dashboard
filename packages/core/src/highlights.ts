/**
 * The change over a number of years (CONTEXT.md, Highlights; PLAN section 3). The contract is
 * `docs/method/highlights.md`; this module is tested from that text.
 *
 * `changeOver(series, years)` sets a Series' latest value beside the value of the same Period
 * one, five or ten years earlier. It is the year-over-year comparison `ch1` and `pc1` make
 * (`docs/method/transforms.md`), asked at the latest Period and at a lag of N years, with the
 * figures the `change` Measure names (`docs/method/claims.md`): the change, and the percent
 * change where the earlier value is above zero. No Transform, aggregation or Measure is
 * changed by it. Adding it raised `SEMANTICS_VERSION` to 0.8.0 (transform.ts).
 *
 * Pure. Hidden here: the frequency the comparison is made at (a daily or weekly Series is
 * brought to months by its declared rule, as `pc1` does), which Period is "N years earlier"
 * (the one with the same place in its year, by the calendar, never the nearest that has a
 * value), and what a missing or partial Period does to a figure.
 */
import { aggregate, type AggregateMethod } from "./aggregate";
import type { Frequency } from "./period";
import type { TransformAggregation, TransformObservation, TransformSeries } from "./transform";

/** Why a change has no value. */
export type ChangeEmpty =
  /** The Series holds no Observation for the Period N years earlier (it does not reach back that far, or skips it). */
  | "no_observation_earlier"
  /** It holds one, with no value. */
  | "no_value_earlier"
  /** The latest Period, or the earlier one, is a partial Period: nothing is compared with it. */
  | "partial_period";

export type YearsChange = {
  years: number;
  /** The Period N years before the latest one, by the calendar. */
  period: string;
  /** Its Observation, when it has a value that can be compared. */
  start: TransformObservation | null;
  /** The latest value less the earlier one. */
  change: number | null;
  /** The change as a percent of the earlier value; null when that value is not above zero. */
  pct_change: number | null;
  /** Why there is no change at all. */
  empty?: ChangeEmpty;
  /**
   * Why there is a change and no percent change: the earlier value is not above zero, or the
   * percent is too large to be a number (the arithmetic overflowed).
   */
  pct_empty?: "start_not_positive" | "not_finite";
};

export type ChangeOver =
  | {
      ok: true;
      /** The frequency the comparison was made at. */
      freq: Frequency;
      /** Said when that is not the Series' own: it was brought to months first. */
      aggregated: TransformAggregation | null;
      /** The last Observation that has a value. */
      latest: TransformObservation & { value: number };
      changes: YearsChange[];
    }
  | { ok: false; reason: "frequency_not_supported" | "no_values" | "aggregation_not_declared" | "aggregation_not_allowed" | "held"; message: string };

const BROUGHT_TO_MONTHS = new Set<string>(["daily", "business_daily", "weekly"]);

/** The label of the Period `years` before `label`: the same month, quarter or year of the earlier year. */
function yearsBefore(freq: Frequency, label: string, years: number): string | null {
  const year = Number(label.slice(0, 4)) - years;
  if (!Number.isInteger(year) || year < 1) return null;
  return `${String(year).padStart(4, "0")}${label.slice(4)}`;
}

export function changeOver(series: TransformSeries, years: readonly number[]): ChangeOver {
  for (const n of years) if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error(`a change is taken over a whole number of years, not ${n}`);
  let freq = series.freq;
  let observations: readonly TransformObservation[] = series.observations;
  let aggregated: TransformAggregation | null = null;
  if (BROUGHT_TO_MONTHS.has(freq)) {
    const monthly = aggregate(series, "monthly");
    if (!monthly.ok) {
      const reason = monthly.reason === "not_slower" || monthly.reason === "no_cadence" ? "frequency_not_supported" : monthly.reason;
      return { ok: false, reason, message: monthly.message };
    }
    aggregated = { from: freq, to: "monthly", method: monthly.method as AggregateMethod };
    freq = "monthly";
    observations = monthly.observations;
  }
  if (freq !== "monthly" && freq !== "quarterly" && freq !== "annual") {
    return { ok: false, reason: "frequency_not_supported", message: "an irregular series has no observation a number of years earlier to compare with" };
  }
  let latest: (TransformObservation & { value: number }) | null = null;
  for (let i = observations.length - 1; i >= 0 && latest === null; i--) {
    const o = observations[i]!;
    if (o.value !== null) latest = { period: o.period, period_start: o.period_start, period_end: o.period_end, value: o.value, status: o.status };
  }
  if (latest === null) return { ok: false, reason: "no_values", message: "the series has no value" };
  const end = latest;
  const byPeriod = new Map(observations.map((o) => [o.period, o]));
  const changes = years.map((n): YearsChange => {
    const period = yearsBefore(freq, end.period, n) ?? "";
    const none = (empty: ChangeEmpty): YearsChange => ({ years: n, start: null, period, change: null, pct_change: null, empty });
    if (end.status === "partial") return none("partial_period");
    const before = byPeriod.get(period);
    if (!before) return none("no_observation_earlier");
    if (before.value === null) return none("no_value_earlier");
    if (before.status === "partial") return none("partial_period");
    const start = { period: before.period, period_start: before.period_start, period_end: before.period_end, value: before.value, status: before.status };
    const change = end.value - before.value;
    if (!Number.isFinite(change)) return none("no_value_earlier");
    if (!(before.value > 0)) return { years: n, start, period, change, pct_change: null, pct_empty: "start_not_positive" };
    const pct = (100 * change) / before.value;
    if (!Number.isFinite(pct)) return { years: n, start, period, change, pct_change: null, pct_empty: "not_finite" };
    return { years: n, start, period, change, pct_change: pct };
  });
  return { ok: true, freq, aggregated, latest: end, changes };
}

/**
 * Which figure of a change a page shows for a Series, by the unit its values are in: a Series
 * measured in percent changes by percentage points, never by a percent of a percent; any other
 * by a percent of the earlier value, where that value is above zero, and otherwise by its own
 * unit.
 */
export type ShownChange = { kind: "points" | "percent" | "unit"; value: number } | { kind: "none"; empty: ChangeEmpty };

export function shownChange(change: Pick<YearsChange, "change" | "pct_change" | "empty"> & Partial<YearsChange>, unitKind: string | undefined): ShownChange {
  if (change.change === null) return { kind: "none", empty: change.empty ?? "no_value_earlier" };
  if (unitKind === "percent" || unitKind === "percentage_points") return { kind: "points", value: change.change };
  if (change.pct_change !== null) return { kind: "percent", value: change.pct_change };
  return { kind: "unit", value: change.change };
}
