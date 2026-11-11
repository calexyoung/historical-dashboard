/** Test support: small invented Series for the figure's tests. Never imported by the app. */
import { nextPeriod, periodBounds, type Frequency } from "@macro-atlas/core";
import type { FigureObservation, FigureSeries, ShownSeries } from "./index";

/** `count` Observations from `first`, one per Period, with the values given (null is a gap). */
export function observations(freq: Frequency, first: string, values: (number | null)[], statuses: Record<string, string> = {}): FigureObservation[] {
  const out: FigureObservation[] = [];
  let label: string | null = first;
  for (const value of values) {
    if (label === null) throw new Error("ran off the calendar");
    const bounds = periodBounds(freq, label);
    if (!bounds) throw new Error(`${label} is not a ${freq} period`);
    out.push({ period: label, period_start: bounds.start, period_end: bounds.end, value, status: statuses[label] ?? (value === null ? "missing" : "final") });
    label = nextPeriod(freq, label);
  }
  return out;
}

/** Observations on the days named (an irregular Series has no next Period). */
export function onDays(days: Record<string, number | null>): FigureObservation[] {
  return Object.entries(days).map(([day, value]) => ({ period: day, period_start: day, period_end: day, value, status: value === null ? "missing" : "final" }));
}

export function series(over: Partial<ShownSeries> & { observations: FigureObservation[] }): ShownSeries {
  return {
    key: "fx_rate",
    name: "Fixture rate",
    unit: "%",
    unitKind: "percent",
    measureKind: "rate",
    freq: "monthly",
    continuity: "discrete",
    representation: "native",
    seasonalAdjustment: "sa",
    priceBasis: "not_applicable",
    country: "USA",
    source: "Macro Atlas fixture (synthetic)",
    ...over,
  };
}

export const CREATED = "2026-01-01T00:00:00Z";
export const asList = (s: FigureSeries | FigureSeries[]): FigureSeries[] => (Array.isArray(s) ? s : [s]);
