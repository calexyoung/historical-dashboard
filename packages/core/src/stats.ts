/**
 * Statistics: how two Series moved together over a window. Descriptive only. The contract is
 * `docs/method/statistics.md`; this module is tested from that text.
 *
 * Two layers. The lower one is v1's `web/stats.js`, ported: `changes`, `pearson`, `lagProfile`,
 * `rollingCorrelation` work on two lists of values that are already on one axis of Periods, with
 * null where there is no value. The upper one, `pairFrame`, is what puts two Series on one axis.
 *
 * There is no significance test here and there will not be one (PLAN 4.5): with trending,
 * autocorrelated Series and a search over lags, v1's `p < 0.05` hint misled.
 *
 * Pure.
 */
import { periodBounds, type Frequency } from "./period";
import type { TransformObservation, TransformWindow } from "./transform";

/** Fewer pairs than this and a correlation has no answer (v1's floor). */
export const MIN_PAIRS = 8;

export type Values = readonly (number | null)[];

/** Percent change from the Period before, where both are observed and the earlier is not zero. */
export function changes(values: Values): (number | null)[] {
  const out = new Array<number | null>(values.length).fill(null);
  for (let i = 1; i < values.length; i++) {
    const [now, before] = [values[i]!, values[i - 1]!];
    if (now !== null && before !== null && before !== 0) out[i] = (now / before - 1) * 100;
  }
  return out;
}

export type Pair = { x: number; y: number; /** Where on the axis each value sits: j = i + lag. */ i: number; j: number };
export type Correlation = {
  /** Pearson's r, or null when there is no answer. */
  r: number | null;
  /** How many pairs there were, answer or not. */
  n: number;
  why: "too_few_pairs" | "no_variation" | null;
  pairs: Pair[];
};

/**
 * Pearson's r between x and y, pairing x[i] with y[i + lag]: a positive lag asks whether X leads
 * Y. Both ends of a pair lie on the axis given; nothing is paired with a Period outside it.
 */
export function pearson(x: Values, y: Values, options: { lag?: number } = {}): Correlation {
  const lag = options.lag ?? 0;
  const pairs: Pair[] = [];
  for (let i = 0; i < x.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= y.length) continue;
    const [a, b] = [x[i]!, y[j]!];
    if (a !== null && b !== null) pairs.push({ x: a, y: b, i, j });
  }
  const n = pairs.length;
  if (n < MIN_PAIRS) return { r: null, n, why: "too_few_pairs", pairs };
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let [sxy, sxx, syy] = [0, 0, 0];
  for (const p of pairs) {
    const [dx, dy] = [p.x - mx, p.y - my];
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!(sxx > 0) || !(syy > 0)) return { r: null, n, why: "no_variation", pairs };
  return { r: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), n, why: null, pairs };
}

export type LagResult = { lag: number; r: number | null; n: number };

/** r at every lag from −maxLag to +maxLag, in that order. */
export function lagProfile(x: Values, y: Values, options: { maxLag?: number } = {}): LagResult[] {
  const max = options.maxLag ?? 24;
  const out: LagResult[] = [];
  for (let lag = -max; lag <= max; lag++) {
    const { r, n } = pearson(x, y, { lag });
    out.push({ lag, r, n });
  }
  return out;
}

/** The lag with the largest |r|; of equals, the first from −max upward (as v1). Null when none has an answer. */
export function strongest(profile: readonly LagResult[]): (LagResult & { r: number }) | null {
  let best: (LagResult & { r: number }) | null = null;
  for (const p of profile) if (p.r !== null && (best === null || Math.abs(p.r) > Math.abs(best.r))) best = { ...p, r: p.r };
  return best;
}

export type RollingResult = { r: number | null; n: number } | null;

/**
 * r at lag 0 over the trailing `window` Periods ending at each place on the axis. Null before
 * the first full window.
 */
export function rollingCorrelation(x: Values, y: Values, options: { window: number; minN?: number }): RollingResult[] {
  const w = options.window;
  const out = new Array<RollingResult>(x.length).fill(null);
  for (let i = w - 1; i < x.length; i++) {
    const { r, n } = pearson(x.slice(i - w + 1, i + 1), y.slice(i - w + 1, i + 1));
    out[i] = { r, n };
  }
  return out;
}

// --- two Series on one axis ---------------------------------------------------------------------

export type StatsSeries = {
  freq: Frequency;
  continuity: "discrete" | "held";
  /** In Period order, with every gap explicit, as a Release holds them. */
  observations: readonly TransformObservation[];
};

export type Basis = "chg" | "lvl";
export type FramePeriod = { period: string; period_start: string; period_end: string };
export type PairFrame =
  | { ok: true; freq: Frequency; basis: Basis; periods: FramePeriod[]; x: (number | null)[]; y: (number | null)[] }
  | { ok: false; reason: "frequency_not_supported" | "bad_window"; message: string };

const pad2 = (n: number): string => String(n).padStart(2, "0");
const monthOf = (date: string): string => date.slice(0, 7);
const nextMonth = (month: string): string => {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return m === 12 ? `${String(y + 1).padStart(4, "0")}-01` : `${month.slice(0, 4)}-${pad2(m + 1)}`;
};

function unsupported(s: StatsSeries): string | null {
  if (s.continuity === "held" || s.freq === "irregular") return "a series whose values stand until the next one has no period-to-period movement to compare";
  if (s.freq !== "monthly" && s.freq !== "quarterly" && s.freq !== "annual") return `a ${s.freq.replace("_", " ")} series must be brought to a monthly or slower frequency first`;
  return null;
}

/**
 * Two Series on one axis of Periods, as changes or as levels, cut to a window.
 *
 * As v1 did it: every Series is laid on an axis of months, each value in the month its Period
 * starts.
 */
export function pairFrame(a: StatsSeries, b: StatsSeries, basis: Basis, window: TransformWindow = {}): PairFrame {
  for (const s of [a, b]) {
    const why = unsupported(s);
    if (why) return { ok: false, reason: "frequency_not_supported", message: why };
  }
  if (window.from !== undefined && window.to !== undefined && window.from > window.to) return { ok: false, reason: "bad_window", message: "the window ends before it starts" };
  const months = [...a.observations, ...b.observations].map((o) => monthOf(o.period_start)).sort();
  const periods: FramePeriod[] = [];
  if (months.length > 0) {
    for (let m = months[0]!; m <= months.at(-1)!; m = nextMonth(m)) {
      const bounds = periodBounds("monthly", m)!;
      periods.push({ period: m, period_start: bounds.start, period_end: bounds.end });
    }
  }
  const lay = (s: StatsSeries): (number | null)[] => {
    const by = new Map(s.observations.map((o) => [monthOf(o.period_start), o.value]));
    const levels = periods.map((p) => by.get(p.period) ?? null);
    return basis === "chg" ? changes(levels) : levels;
  };
  const [x, y] = [lay(a), lay(b)];
  const from = window.from ?? "0001-01-01";
  const to = window.to ?? "9999-12-31";
  const keep = periods.map((p) => p.period_start >= from && p.period_start <= to);
  const cut = <T,>(list: T[]): T[] => list.filter((_, i) => keep[i]);
  return { ok: true, freq: "monthly", basis, periods: cut(periods), x: cut(x), y: cut(y) };
}
