/** Test helper only: builds Observations for a run of Periods. Not exported from the package. */
import { nextPeriod, periodBounds, type Frequency } from "./period";

export type Obs = { period: string; period_start: string; period_end: string; value: number | null; status: string };

/** Consecutive Periods from `first`; or exactly `labels` (an irregular Series). */
export function run(freq: Frequency, first: string, values: (number | null)[], statuses: Record<string, string> = {}, labels?: string[]): Obs[] {
  const out: Obs[] = [];
  let label: string | null = first;
  for (let i = 0; i < values.length; i++) {
    if (labels) label = labels[i]!;
    if (label === null) throw new Error("ran off the calendar");
    const bounds = periodBounds(freq, label);
    if (!bounds) throw new Error(`${label} is not a ${freq} Period`);
    out.push({ period: label, period_start: bounds.start, period_end: bounds.end, value: values[i]!, status: statuses[label] ?? (values[i] === null ? "missing" : "final") });
    if (!labels) label = nextPeriod(freq, label);
  }
  return out;
}
