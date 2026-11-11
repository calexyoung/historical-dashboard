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
import { nextPeriod, periodBounds, type Frequency } from "./period";
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
export function pearson(x: Values, y: Values, options: { lag?: number; minN?: number } = {}): Correlation {
  const lag = options.lag ?? 0;
  // Two points always lie on a line, so no floor below three is taken.
  const floor = Math.max(3, options.minN ?? MIN_PAIRS);
  const pairs: Pair[] = [];
  for (let i = 0; i < x.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= y.length) continue;
    const [a, b] = [x[i]!, y[j]!];
    if (a !== null && b !== null) pairs.push({ x: a, y: b, i, j });
  }
  const n = pairs.length;
  if (n < floor) return { r: null, n, why: "too_few_pairs", pairs };
  // Identical values have no variation. Asked directly, because a sum of decimals can round the
  // mean away from the values and invent one.
  if (pairs.every((p) => p.x === pairs[0]!.x) || pairs.every((p) => p.y === pairs[0]!.y)) return { r: null, n, why: "no_variation", pairs };
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
export function lagProfile(x: Values, y: Values, options: { maxLag?: number; minN?: number } = {}): LagResult[] {
  const max = options.maxLag ?? 24;
  const out: LagResult[] = [];
  for (let lag = -max; lag <= max; lag++) {
    const { r, n } = pearson(x, y, { lag, minN: options.minN });
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
 * the first full window. A window may hold fewer pairs than Periods (gaps); `minN` is the fewest
 * that still gets an answer.
 */
export function rollingCorrelation(x: Values, y: Values, options: { window: number; minN?: number }): RollingResult[] {
  const w = options.window;
  const out = new Array<RollingResult>(x.length).fill(null);
  for (let i = w - 1; i < x.length; i++) {
    const { r, n } = pearson(x.slice(i - w + 1, i + 1), y.slice(i - w + 1, i + 1), { minN: options.minN });
    out[i] = { r, n };
  }
  return out;
}

// --- two Series on one axis ---------------------------------------------------------------------

export type Aggregation = "mean" | "last" | "sum" | "none";

export type StatsSeries = {
  freq: Frequency;
  continuity: "discrete" | "held";
  /** In Period order, with every gap explicit, as a Release holds them. */
  observations: readonly TransformObservation[];
  /** How finer Periods combine into a coarser one, as the Catalog declares it (`agg`). */
  agg?: Aggregation;
  /** The first day of each Period from which the Series is on a new basis (the Catalog's `breaks`). */
  breaks?: readonly string[];
};

export type Basis = "chg" | "lvl";
export type FramePeriod = { period: string; period_start: string; period_end: string };
export type PairFrame =
  | {
      ok: true;
      /** The frequency the two were compared at: the slower of their own. */
      freq: Frequency;
      basis: Basis;
      /** The axis: every Period of the window at that frequency, in order. */
      periods: FramePeriod[];
      /** One value per Period for each Series; null where it has none. */
      x: (number | null)[];
      y: (number | null)[];
    }
  | { ok: false; reason: "frequency_not_supported" | "no_aggregation" | "bad_window"; message: string };

/** The frequencies statistics are taken at, fastest first, and how many of each make the next. */
const LADDER = ["monthly", "quarterly", "annual"] as const;
type Rung = (typeof LADDER)[number];
const PARTS: Record<Rung, Partial<Record<Rung, number>>> = { monthly: { quarterly: 3, annual: 12 }, quarterly: { annual: 4 }, annual: {} };
const NOUN: Record<Rung, string> = { monthly: "months", quarterly: "quarters", annual: "years" };

/** A value that is a measurement of a whole Period: not a projection, not part of a Period. */
const observed = (o: TransformObservation): number | null => (o.status === "projected" || o.status === "partial" ? null : o.value);

function unsupported(s: StatsSeries): string | null {
  if (s.continuity === "held" || s.freq === "irregular") return "a series whose values stand until the next one has no period-to-period movement to compare";
  if (!(LADDER as readonly string[]).includes(s.freq)) return `a ${s.freq.replace("_", " ")} series must be brought to a monthly or slower frequency first`;
  return null;
}

/** The label of the Period of `freq` that holds a date. */
function labelAt(freq: Rung, date: string): string {
  const [year, month] = [date.slice(0, 4), Number(date.slice(5, 7))];
  return freq === "annual" ? year : freq === "quarterly" ? `${year}-Q${Math.floor((month - 1) / 3) + 1}` : date.slice(0, 7);
}

type Level = { value: number | null; /** A break falls inside the Period or opens it: no change is taken into it. */ broken: boolean };

/** A Series' values by Period label at `target`, its own frequency or a slower one. */
function levelsAt(s: StatsSeries, target: Rung): Map<string, Level> | string {
  const own = s.freq as Rung;
  const out = new Map<string, Level>();
  const breaks = s.breaks ?? [];
  const brokenIn = (start: string, end: string) => breaks.some((d) => d >= start && d <= end);
  if (own === target) {
    for (const o of s.observations) out.set(o.period, { value: observed(o), broken: brokenIn(o.period_start, o.period_end) });
    return out;
  }
  const parts = PARTS[own][target]!;
  if (s.agg === undefined || s.agg === "none") return `the series does not say how its ${NOUN[own]} combine into ${NOUN[target]}, so it cannot be compared at that frequency`;
  const groups = new Map<string, TransformObservation[]>();
  for (const o of s.observations) {
    const label = labelAt(target, o.period_start);
    groups.set(label, [...(groups.get(label) ?? []), o]);
  }
  for (const [label, group] of groups) {
    const bounds = periodBounds(target, label)!;
    const broken = brokenIn(bounds.start, bounds.end);
    // A break after the Period's first day splits it between two bases: it has no one value.
    const split = breaks.some((d) => d > bounds.start && d <= bounds.end);
    const values = group.map(observed);
    let value: number | null = null;
    if (split) value = null;
    else if (s.agg === "last") {
      const last = group.find((o) => o.period_end === bounds.end);
      value = last ? observed(last) : null;
    } else if (group.length === parts && values.every((v) => v !== null)) {
      const sum = (values as number[]).reduce((a, b) => a + b, 0);
      value = s.agg === "sum" ? sum : sum / parts;
    }
    out.set(label, { value, broken });
  }
  return out;
}

/**
 * Two Series on one axis of Periods, as changes or as levels, cut to a window.
 *
 * Each Series stays at its own frequency; the pair is compared at the slower of the two, the
 * faster one combined as its Catalog entry declares. A change is taken from the Period before
 * at that frequency, on the whole Series, and only then is the window cut: the window's first
 * Period has a change if the Period before the window has a value. A Period belongs to the
 * window by its first day, as in a Transform.
 */
export function pairFrame(a: StatsSeries, b: StatsSeries, basis: Basis, window: TransformWindow = {}): PairFrame {
  for (const s of [a, b]) {
    const why = unsupported(s);
    if (why) return { ok: false, reason: "frequency_not_supported", message: why };
  }
  if (window.from !== undefined && window.to !== undefined && window.from > window.to) return { ok: false, reason: "bad_window", message: "the window ends before it starts" };
  const freq = LADDER[Math.max(LADDER.indexOf(a.freq as Rung), LADDER.indexOf(b.freq as Rung))]!;
  const levels: Map<string, Level>[] = [];
  for (const s of [a, b]) {
    const at = levelsAt(s, freq);
    if (typeof at === "string") return { ok: false, reason: "no_aggregation", message: at };
    levels.push(at);
  }
  const starts: { label: string; start: string }[] = [...levels[0]!.keys(), ...levels[1]!.keys()].map((label) => ({ label, start: periodBounds(freq, label)?.start })).filter((p): p is { label: string; start: string } => p.start !== undefined);
  // A window with a stated edge is part of the axis up to that edge, whether or not either
  // Series reaches it: a Period neither has a value for is a Period with no pair.
  for (const edge of [window.from, window.to]) {
    if (edge === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(edge)) continue;
    const label = labelAt(freq, edge);
    const bounds = periodBounds(freq, label);
    if (!bounds) continue;
    // The Period that holds the window's first day belongs to the window only if it starts there.
    if (edge === window.from && bounds.start < edge) {
      const next = nextPeriod(freq, label);
      const after = next ? periodBounds(freq, next) : null;
      if (next && after && (window.to === undefined || after.start <= window.to)) starts.push({ label: next, start: after.start });
    } else starts.push({ label, start: bounds.start });
  }
  const periods: FramePeriod[] = [];
  if (starts.length > 0) {
    const first = starts.reduce((p, q) => (q.start < p.start ? q : p));
    const last = starts.reduce((p, q) => (q.start > p.start ? q : p));
    for (let label: string | null = first.label; label !== null; label = nextPeriod(freq, label)) {
      const bounds = periodBounds(freq, label)!;
      if (bounds.start > last.start) break;
      periods.push({ period: label, period_start: bounds.start, period_end: bounds.end });
    }
  }
  const lay = (by: Map<string, Level>): (number | null)[] => {
    const values = periods.map((p) => by.get(p.period)?.value ?? null);
    if (basis === "lvl") return values;
    return changes(values).map((change, i) => (by.get(periods[i]!.period)?.broken ? null : change));
  };
  const [x, y] = [lay(levels[0]!), lay(levels[1]!)];
  const from = window.from ?? "0001-01-01";
  const to = window.to ?? "9999-12-31";
  const keep = periods.map((p) => p.period_start >= from && p.period_start <= to);
  const cut = <T,>(list: T[]): T[] => list.filter((_, i) => keep[i]);
  return { ok: true, freq, basis, periods: cut(periods), x: cut(x), y: cut(y) };
}
