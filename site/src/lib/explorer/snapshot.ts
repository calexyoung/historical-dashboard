/**
 * The snapshot table (PLAN M5; v1's "Snapshot"): for each selected Series, where it stood at the
 * start of the window and at its latest value in it, how far it moved, and its lowest and highest
 * value, each with its own Period. Read from the Series' own values, whatever the mode; nothing
 * is filled, so a quarterly Series starts at its first quarter in the window.
 *
 * The change is in percentage points where the unit is itself a percentage, else in percent. It
 * is a number, never a colour: a rise is not good news or bad (DESIGN.md).
 */
import type { Frequency } from "@macro-atlas/core";
import { fixed, periodWords, readingDecimals } from "../figure/words";

export type SnapshotInput = {
  key: string;
  name: string;
  unit: string;
  unitKind?: string;
  freq: Frequency;
  source: string;
  /** The Series' own values in the window, in Period order. Null: it may not be shown. */
  observations: readonly { period: string; period_start: string; value: number | null }[] | null;
  /** The Series' latest value anywhere, in words ("Sep 2026"), when it may be shown. */
  latest: string | null;
  absent: string | null;
};

export type SnapshotCell = { value: string; period: string };
export type SnapshotRow = {
  key: string;
  name: string;
  unit: string;
  first: SnapshotCell | null;
  last: SnapshotCell | null;
  /** "+12.3%" or "−0.40 pts"; null when there is none to give. */
  change: string | null;
  low: SnapshotCell | null;
  high: SnapshotCell | null;
  source: string;
  latest: string | null;
  /** What to say instead of figures. */
  note: string | null;
};

const signed = (value: number, decimals: number, suffix: string): string => {
  const text = fixed(Math.abs(value), decimals);
  const zero = Number(text.replace(/,/g, "")) === 0;
  return `${zero ? "" : value < 0 ? "−" : "+"}${text}${suffix}`;
};

export function snapshotRows(inputs: readonly SnapshotInput[]): SnapshotRow[] {
  return inputs.map((s): SnapshotRow => {
    const base = { key: s.key, name: s.name, unit: s.unit, source: s.source, latest: s.latest };
    const none = { ...base, first: null, last: null, change: null, low: null, high: null };
    if (s.observations === null) return { ...none, note: s.absent ?? "Not shown here" };
    const valued = s.observations.filter((o): o is { period: string; period_start: string; value: number } => o.value !== null);
    if (valued.length === 0) return { ...none, note: "No value in the window" };
    const decimals = Math.max(0, ...valued.map((o) => readingDecimals(o.value)));
    const cell = (o: { period: string; period_start: string; value: number }): SnapshotCell => ({ value: fixed(o.value, decimals).replace(/^-/, "−"), period: periodWords(s.freq, o, "short") });
    const [first, last] = [valued[0]!, valued.at(-1)!];
    // The first of equals, as v1: a low or a high is dated by when it was first reached.
    let [low, high] = [first, first];
    for (const o of valued) {
      if (o.value < low.value) low = o;
      if (o.value > high.value) high = o;
    }
    const points = s.unitKind === "percent" || s.unitKind === "percentage_points";
    // A percent change from a base that is not above zero flips its sign or has none.
    const change = points ? signed(last.value - first.value, 2, " pts") : first.value > 0 ? signed((last.value / first.value - 1) * 100, 1, "%") : null;
    return { ...base, first: cell(first), last: cell(last), change, low: cell(low), high: cell(high), note: null };
  });
}
