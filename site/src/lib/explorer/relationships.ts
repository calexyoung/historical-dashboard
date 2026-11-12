/**
 * Relationships: how the selected Series moved together in the window (PLAN M5 and 4.5;
 * docs/method/statistics.md). Descriptive only.
 *
 * `relationshipsFor` answers with everything the Explorer's Relationships panel shows: r for
 * every pair, and for one chosen pair a scatter, r at every lag and r over a rolling window, each
 * with the numbers a reader needs to weigh it (n, the window, the frequency the two were compared
 * at, how many Periods had no pair) and with guard text that is always there. It never calls a
 * correlation significant, strong or weak, and it never says one Series moved another.
 *
 * The arithmetic is the engine's (`@macro-atlas/core`, stats.ts). Hidden here: which Series can
 * take part and why not, the pair when the address names none, how a lag and a rolling span are
 * counted at the pair's frequency, and every word.
 */
import { lagProfile, MIN_PAIRS, pairFrame, pearson, rollingCorrelation, strongest, type Frequency, type PairFrame, type StatsSeries, type TransformObservation } from "@macro-atlas/core";
import type { CatalogEntry } from "@macro-atlas/core/release";
import { lagDrawing, rollingDrawing, scatterDrawing } from "../figure/relationships";
import type { SvgNode } from "../figure/svg";
import { fixed, labelStart, list, periodWords } from "../figure/words";
import { MAX_LAG, type ExplorerState } from "./state";

type Change = Partial<Omit<ExplorerState, "notes">>;

export type MatrixCell = {
  /** r to two places, or null when there is no answer. */
  r: string | null;
  n: number;
  /** The whole cell in words: the pair, r, n and the frequency, or why there is no answer. */
  words: string;
  /** The address that makes this the chosen pair; null on the diagonal and where a Series cannot take part. */
  query: string | null;
  chosen: boolean;
  self: boolean;
};

export type PairView = {
  x: { key: string; name: string };
  y: { key: string; name: string };
  lag: number;
  /** "r = 0.612 · r² = 0.375 · n = 118", or why there is no answer. */
  answer: { r: string; r2: string; n: number } | null;
  noAnswer: string | null;
  /** The frame in words: basis, frequency (and how a faster Series was combined), window, pairs and gaps, lag. */
  facts: string[];
  scatter: { drawing: SvgNode; rows: { x: string; y: string; xPeriod: string; yPeriod: string }[]; xHead: string; yHead: string } | null;
  lags: { drawing: SvgNode; rows: { lag: number; label: string; r: string | null; n: number; query: string; current: boolean }[]; strongest: string | null; unit: string };
  rolling: { span: 24 | 36; periods: number; drawing: SvgNode | null; note: string | null; rows: { period: string; r: string | null; n: number }[]; unit: string };
};

export type Relationships = {
  /** Why there is nothing to show (fewer than two Series), else null. */
  empty: string | null;
  basis: "chg" | "lvl";
  series: { key: string; name: string; short: string }[];
  /** Series that are selected but cannot take part, each with the reason. */
  left_out: { key: string; name: string; reason: string }[];
  matrix: MatrixCell[][];
  pair: PairView | null;
  /** Always shown with any figure here. */
  guard: string[];
};

export type RelationshipInput = {
  entry: CatalogEntry;
  /** The whole Series, through Query; null when it may not be shown. */
  observations: readonly TransformObservation[] | null;
  reason: string | null;
  /**
   * A Series finer than monthly (daily, weekly): the whole Series as Query combined it to each
   * frequency a pair can be compared at, or why it could not be. It then takes part at monthly
   * or slower, combined once from its own Periods by its own declared rule (ADR 0032).
   */
  at?: Partial<Record<"monthly" | "quarterly" | "annual", readonly TransformObservation[] | string>>;
};
const RUNGS = ["monthly", "quarterly", "annual"] as const;

const MONTHS_PER: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, annual: 12 };
const UNIT_WORD: Partial<Record<Frequency, [one: string, many: string]>> = { monthly: ["month", "months"], quarterly: ["quarter", "quarters"], annual: ["year", "years"] };
const COMBINED: Record<string, string> = { mean: "averaged over", sum: "summed over", last: "taken at the end of" };

const minus = (text: string): string => text.replace(/^-/, "−");
const rWords = (r: number, places: number): string => {
  const text = r.toFixed(places);
  return minus(Number(text) === 0 ? text.replace("-", "") : text);
};
const short = (name: string): string => (name.length > 18 ? `${name.slice(0, 17).trimEnd()}…` : name);
const signedLag = (lag: number): string => (lag > 0 ? `+${lag}` : minus(String(lag)));

function statsSeries(input: RelationshipInput): StatsSeries {
  const e = input.entry;
  const breaks = (e.breaks ?? []).map((b) => labelStart(e.freq, b.period)?.period_start).filter((d): d is string => d !== undefined);
  return { freq: e.freq, continuity: e.continuity, observations: input.observations ?? [], agg: e.agg, breaks };
}

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

export function relationshipsFor(
  inputs: readonly RelationshipInput[],
  window: { from: string; to: string; words: string },
  state: Pick<ExplorerState, "levels" | "lag" | "sx" | "sy" | "roll" | "table">,
  queryWith: (change: Change) => string,
): Relationships {
  const basis = state.levels ? "lvl" : "chg";
  const guard = [
    "These figures describe how the series moved together in this window. They do not say that one moved the other.",
    basis === "chg"
      ? "They are taken on percent changes from one period to the next, which takes out most of a trend the two share."
      : "They are taken on levels. Two series that both rise or both fall over the window correlate closely on levels whatever connects them.",
    "Neighbouring periods resemble each other, so n overstates how much separate evidence there is. For that reason no significance test is shown.",
  ];
  const left_out = inputs.filter((i) => i.observations === null).map((i) => ({ key: i.entry.key, name: i.entry.name, reason: i.reason ?? "Its values may not be shown here." }));
  const able = inputs.filter((i) => i.observations !== null);
  const series = able.map((i) => ({ key: i.entry.key, name: i.entry.name, short: short(i.entry.name) }));
  if (able.length < 2) return { empty: "Select at least two series to see how they moved together.", basis, series, left_out, matrix: [], pair: null, guard };

  const stats = able.map(statsSeries);
  const rung = (i: RelationshipInput): number => (i.at ? 0 : RUNGS.indexOf(i.entry.freq as (typeof RUNGS)[number]));
  /** A Series as the engine's pair frame takes it: one finer than monthly, as Query combined it to the pair's frequency. */
  const statsAt = (index: number, target: (typeof RUNGS)[number] | undefined): StatsSeries | string => {
    const input = able[index]!;
    if (!input.at || target === undefined) return stats[index]!;
    const combined = input.at[target];
    if (combined === undefined) return `the series was not combined to ${target} periods`;
    if (typeof combined === "string") return combined.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase());
    const native = input.entry.freq;
    const breaks = (input.entry.breaks ?? []).map((b) => labelStart(native, b.period)?.period_start).filter((d): d is string => d !== undefined);
    return { freq: target, continuity: input.entry.continuity, observations: combined, agg: input.entry.agg, breaks };
  };
  const frames = new Map<string, PairFrame>();
  const frameOf = (a: number, b: number): PairFrame => {
    const id = `${a}:${b}`;
    if (!frames.has(id)) {
      const target = RUNGS[Math.max(rung(able[a]!), rung(able[b]!))];
      const [x, y] = [statsAt(a, target), statsAt(b, target)];
      const failed = typeof x === "string" ? x : typeof y === "string" ? y : null;
      frames.set(id, failed !== null || typeof x === "string" || typeof y === "string" ? { ok: false, reason: "no_aggregation", message: failed! } : pairFrame(x, y, basis, { from: window.from, to: window.to }));
    }
    return frames.get(id)!;
  };
  const many = (freq: Frequency, n: number): string => `${n} ${UNIT_WORD[freq]![n === 1 ? 0 : 1]}`;

  // --- the pair: what the address names, else the first two (v1's rule) ---
  const keys = series.map((s) => s.key);
  const sx = state.sx !== null && keys.includes(state.sx) ? state.sx : keys[0]!;
  const sy = state.sy !== null && keys.includes(state.sy) && state.sy !== sx ? state.sy : keys.find((k) => k !== sx)!;
  const [ix, iy] = [keys.indexOf(sx), keys.indexOf(sy)];

  const matrix: MatrixCell[][] = able.map((rowInput, a) =>
    able.map((colInput, b): MatrixCell => {
      const pairName = `${rowInput.entry.name} and ${colInput.entry.name}`;
      if (a === b) return { r: null, n: 0, words: `${rowInput.entry.name} with itself`, query: null, chosen: false, self: true };
      const chosen = a === ix && b === iy;
      const query = queryWith({ sx: keys[a]!, sy: keys[b]!, lag: 0 });
      const frame = frameOf(a, b);
      if (!frame.ok) return { r: null, n: 0, words: `${pairName}: no answer. ${sentence(frame.message)}`, query, chosen, self: false };
      const c = pearson(frame.x, frame.y);
      if (c.r === null) {
        const why = c.why === "no_variation" ? "one of them does not vary in the window" : `${c.n} ${c.n === 1 ? "pair" : "pairs"}, fewer than ${MIN_PAIRS}`;
        return { r: null, n: c.n, words: `${pairName}: no answer (${why}).`, query, chosen, self: false };
      }
      return { r: rWords(c.r, 2), n: c.n, words: `${pairName}: r = ${rWords(c.r, 2)} over ${many(frame.freq, c.n)}.`, query, chosen, self: false };
    }),
  );

  // --- the chosen pair ---
  const [ex, ey] = [able[ix]!.entry, able[iy]!.entry];
  const frame = frameOf(ix, iy);
  const pairBase = { x: { key: ex.key, name: ex.name }, y: { key: ey.key, name: ey.name }, lag: state.lag };
  const lagRows = (profile: { lag: number; r: number | null; n: number }[], unit: string) =>
    profile.map((p) => ({ lag: p.lag, label: p.lag === 0 ? "0" : `${signedLag(p.lag)} ${unit}`, r: p.r === null ? null : rWords(p.r, 2), n: p.n, query: queryWith({ sx, sy, lag: p.lag }), current: p.lag === state.lag }));
  if (!frame.ok) {
    const none = Array.from({ length: 2 * MAX_LAG + 1 }, (_, i) => ({ lag: i - MAX_LAG, r: null, n: 0 }));
    return {
      empty: null,
      basis,
      series,
      left_out,
      matrix,
      guard,
      pair: {
        ...pairBase,
        answer: null,
        noAnswer: sentence(frame.message),
        facts: [],
        scatter: null,
        lags: { drawing: lagDrawing({ profile: none, current: state.lag, label: "No lag has an answer." }), rows: lagRows(none, "periods"), strongest: null, unit: "periods" },
        rolling: { span: state.roll, periods: 0, drawing: null, note: sentence(frame.message), rows: [], unit: "periods" },
      },
    };
  }

  const freq = frame.freq;
  const [one, units] = UNIT_WORD[freq]!;
  const c = pearson(frame.x, frame.y, { lag: state.lag });
  const words = (i: number) => periodWords(freq, frame.periods[i]!, "short");
  const basisWords = basis === "chg" ? `percent change from the ${one} before` : "levels";
  const combined = [ex, ey].filter((e) => e.freq !== freq).map((e) => `${e.name} is ${e.freq.replace("_", " ")}, ${COMBINED[e.agg ?? ""] ?? "combined over"} each ${one}`);
  const offAxis = frame.periods.length - Math.abs(state.lag);
  const facts = [
    `Compared on ${basisWords}, ${freq}${combined.length > 0 ? ` (${list(combined)})` : ""}.`,
    `Window: ${window.words}, ${many(freq, frame.periods.length)}.`,
    state.lag === 0
      ? `${c.n} of ${many(freq, frame.periods.length)} have a value for both; ${frame.periods.length - c.n} ${frame.periods.length - c.n === 1 ? "does" : "do"} not.`
      : `Lag ${signedLag(state.lag)}: each ${one} of ${ex.name} is paired with ${ey.name} ${many(freq, Math.abs(state.lag))} ${state.lag > 0 ? "later" : "earlier"}. ${c.n} of the ${Math.max(0, offAxis)} pairs that fit in the window have a value for both.`,
  ];

  let answer: PairView["answer"] = null;
  let noAnswer: string | null = null;
  if (c.r === null) noAnswer = c.why === "no_variation" ? "No answer: one of the two does not vary over these pairs." : `No answer: ${c.n} ${c.n === 1 ? "pair" : "pairs"}, and fewer than ${MIN_PAIRS} is too few.`;
  else answer = { r: rWords(c.r, 3), r2: (c.r * c.r).toFixed(3), n: c.n };

  const decimals = (values: number[]): number => (basis === "chg" ? 2 : Math.min(4, Math.max(0, ...values.map((v) => (String(v).split(".")[1] ?? "").length))));
  const axisWords = (e: CatalogEntry): string => (basis === "chg" ? `${short(e.name)}, % change` : `${short(e.name)}, ${e.unit}`);
  const [dx, dy] = [decimals(c.pairs.map((p) => p.x)), decimals(c.pairs.map((p) => p.y))];
  const scatter: PairView["scatter"] =
    c.r === null
      ? null
      : {
          drawing: scatterDrawing({
            points: c.pairs.map((p) => ({ x: p.x, y: p.y })),
            xLabel: axisWords(ex),
            yLabel: axisWords(ey),
            label: `Scatter of ${ex.name} against ${ey.name}: ${c.n} pairs, r = ${rWords(c.r, 2)}. The pairs are in the table below when the table is shown.`,
          }),
          rows: state.table ? c.pairs.map((p) => ({ x: minus(fixed(p.x, dx)), y: minus(fixed(p.y, dy)), xPeriod: words(p.i), yPeriod: words(p.j) })) : [],
          xHead: basis === "chg" ? `${ex.name}, % change` : `${ex.name}, ${ex.unit}`,
          yHead: basis === "chg" ? `${ey.name}, % change` : `${ey.name}, ${ey.unit}`,
        };

  const profile = lagProfile(frame.x, frame.y, { maxLag: MAX_LAG });
  const best = strongest(profile);
  const lags: PairView["lags"] = {
    drawing: lagDrawing({
      profile,
      current: state.lag,
      label: `r between ${ex.name} and ${ey.name} at each lag from −${MAX_LAG} to +${MAX_LAG} ${units}. Every value is in the table below.`,
    }),
    rows: lagRows(profile, units),
    strongest:
      best === null
        ? null
        : `Largest |r| of the ${profile.filter((p) => p.r !== null).length} lags with an answer: ${best.lag === 0 ? "no lag" : `lag ${signedLag(best.lag)} ${best.lag === 1 || best.lag === -1 ? one : units}`}, r = ${rWords(best.r, 2)}. The largest of many tries is larger than a single try would be; it is not evidence that one series leads the other.`,
    unit: units,
  };

  const periods = state.roll / MONTHS_PER[freq]!;
  let rolling: PairView["rolling"];
  if (periods < MIN_PAIRS) {
    rolling = { span: state.roll, periods, drawing: null, note: `A window of ${state.roll} months is ${many(freq, periods)}: fewer than the ${MIN_PAIRS} pairs a correlation needs.`, rows: [], unit: units };
  } else {
    const rolled = rollingCorrelation(frame.x, frame.y, { window: periods });
    const any = rolled.some((w) => w !== null && w.r !== null);
    rolling = {
      span: state.roll,
      periods,
      drawing: any
        ? rollingDrawing({
            points: frame.periods.map((p, i) => ({ date: p.period_start, r: rolled[i]?.r ?? null })),
            label: `r between ${ex.name} and ${ey.name} over the ${many(freq, periods)} ending at each ${one}, with no lag.${state.table ? " Every value is in the table below." : ""}`,
          })
        : null,
      note: any ? null : `No answer anywhere: this needs a window of ${many(freq, periods)} inside the range shown, with at least ${MIN_PAIRS} pairs in it.`,
      rows: state.table ? rolled.flatMap((w, i) => (w === null ? [] : [{ period: words(i), r: w.r === null ? null : rWords(w.r, 2), n: w.n }])) : [],
      unit: units,
    };
  }

  guard.push(`The lag profile tries ${2 * MAX_LAG + 1} lags and the rolling window moves one ${one} at a time; a swing in either can come from a single ${one} entering or leaving.`);
  return { empty: null, basis, series, left_out, matrix, pair: { ...pairBase, answer, noAnswer, facts, scatter, lags, rolling }, guard };
}
