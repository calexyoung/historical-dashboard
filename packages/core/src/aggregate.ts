/**
 * Aggregation: bringing a Series to a slower frequency (PLAN 4.5; CONTEXT.md, Measure kind).
 * The contract is `docs/method/transforms.md`, "Bringing a Series to a slower frequency"; this
 * module is tested from that text.
 *
 * `aggregate(series, to)` answers with one Observation per Period of the slower frequency, or
 * is unavailable with a reason. How values combine is declared on the Series (`agg`) and must
 * be one its Measure kind allows; it is never guessed.
 *
 * Pure. Hidden here: which slower Period a Period belongs to, which combinations are allowed,
 * how many values a Period needs, what makes a Period partial, and which Status comes out.
 */
import { nextPeriod, periodBounds, periodContaining, type Frequency } from "./period";
import type { TransformObservation } from "./transform";

export type AggregateMethod = "mean" | "last" | "sum";

/** What each Measure kind may be combined by. Anything else is an error (PLAN 4.5). */
export const ALLOWED_AGGREGATION: Readonly<Record<string, readonly AggregateMethod[]>> = {
  stock: ["last", "mean"],
  flow: ["sum"],
  rate: ["mean"],
  index: ["mean", "last"],
  annualized: ["mean"],
};

export type AggregateSeries = {
  freq: Frequency;
  continuity: "discrete" | "held";
  /** As the Catalog declares them. */
  measure_kind?: string;
  agg?: string;
  /** In Period order, with every gap explicit, as a Release holds them. */
  observations: readonly TransformObservation[];
};

export type AggregatedObservation = TransformObservation & {
  /** How many of the Series' own Periods fall in this one, of those the Series reaches. */
  members: number;
  /** How many of them have a value. */
  present: number;
};

export type AggregateUnavailable =
  | "aggregation_not_declared"
  | "aggregation_not_allowed"
  | "not_slower"
  | "no_cadence"
  | "held";

export type AggregateResult =
  | { ok: true; freq: Frequency; /** Null when nothing was combined: the Series is already at `freq`. */ method: AggregateMethod | null; observations: AggregatedObservation[] }
  | { ok: false; reason: AggregateUnavailable; message: string };

const COARSENESS: Partial<Record<Frequency, number>> = { daily: 0, business_daily: 0, weekly: 1, monthly: 2, quarterly: 3, annual: 4 };

/** From the most settled to the least. What is computed from several is as settled as the least. */
const SETTLED = ["final", "revised", "preliminary", "estimate", "projected", "partial"];

/** The least settled Status among `statuses`; `final` for none. */
export function leastSettled(statuses: readonly string[]): string {
  let worst = 0;
  for (const status of statuses) worst = Math.max(worst, SETTLED.indexOf(status));
  return SETTLED[worst]!;
}

const DAY_MS = 86_400_000;
/** The first working day on or after a calendar day. */
function firstWorkingDay(date: string): string {
  let ms = Date.parse(`${date}T00:00:00Z`);
  while ([0, 6].includes(new Date(ms).getUTCDay())) ms += DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** How a Series may be combined, or why not. */
export function aggregationMethod(series: Pick<AggregateSeries, "measure_kind" | "agg">): AggregateMethod | { reason: AggregateUnavailable; message: string } {
  const { measure_kind: kind, agg } = series;
  if (agg === undefined || agg === "none") {
    return { reason: "aggregation_not_declared", message: "the catalog does not say how this series combines over a longer period" };
  }
  const allowed = ALLOWED_AGGREGATION[kind ?? ""];
  if (!allowed || !(allowed as readonly string[]).includes(agg)) {
    return {
      reason: "aggregation_not_allowed",
      message: allowed
        ? `a ${kind} is combined by ${allowed.join(" or ")}, not by ${agg}`
        : `${JSON.stringify(kind ?? null)} is not a measure kind`,
    };
  }
  return agg as AggregateMethod;
}

export function aggregate(series: AggregateSeries, to: Frequency): AggregateResult {
  const unavailable = (reason: AggregateUnavailable, message: string): AggregateResult => ({ ok: false, reason, message });
  const from = COARSENESS[series.freq];
  const target = COARSENESS[to];
  if (from === undefined || target === undefined) {
    return unavailable("no_cadence", "an irregular series has no regular periods to combine");
  }
  if (series.freq === to || (from === target && from === 0)) {
    if (series.freq !== to) return unavailable("not_slower", `${to.replace("_", " ")} is not slower than ${series.freq.replace("_", " ")}`);
    return {
      ok: true,
      freq: to,
      method: null,
      observations: series.observations.map((o) => ({ period: o.period, period_start: o.period_start, period_end: o.period_end, value: o.value, status: o.status, members: 1, present: o.value === null ? 0 : 1 })),
    };
  }
  if (target < from) return unavailable("not_slower", `${to.replace("_", " ")} is not slower than ${series.freq.replace("_", " ")}`);
  if (series.continuity === "held") {
    return unavailable("held", "a series whose values stand until the next one is not combined over longer periods");
  }
  const method = aggregationMethod(series);
  if (typeof method !== "string") return unavailable(method.reason, method.message);

  // A Period belongs to the slower Period that contains its last day.
  const groups: { label: string; members: TransformObservation[] }[] = [];
  for (const o of series.observations) {
    const label = periodContaining(to, o.period_end);
    if (label === null) continue;
    const last = groups.at(-1);
    if (last && last.label === label) last.members.push(o);
    else groups.push({ label, members: [o] });
  }

  const observations: AggregatedObservation[] = groups.map(({ label, members }, index) => {
    const bounds = periodBounds(to, label)!;
    const first = members[0]!;
    const final = members.at(-1)!;
    // Between its bounds a Series leaves no Period out, so only its two ends can fall short.
    let whole = true;
    if (index === 0) {
      const opens = series.freq === "business_daily" ? firstWorkingDay(bounds.start) : bounds.start;
      whole = first.period_start <= opens;
    }
    if (index === groups.length - 1) {
      const after = nextPeriod(series.freq, final.period);
      const ends = after === null ? null : periodBounds(series.freq, after);
      if (ends && periodContaining(to, ends.end) === label) whole = false;
    }
    const valued = members.filter((o) => o.value !== null);
    let value: number | null = null;
    if (method === "sum") {
      if (valued.length === members.length) value = valued.reduce((sum, o) => sum + o.value!, 0);
    } else if (valued.length * 2 > members.length) {
      value = method === "last" ? valued.at(-1)!.value! : valued.reduce((sum, o) => sum + o.value!, 0) / valued.length;
    }
    if (value !== null && !Number.isFinite(value)) value = null;
    const status = value === null ? "missing" : whole ? leastSettled(valued.map((o) => o.status)) : "partial";
    return { period: label, period_start: bounds.start, period_end: bounds.end, value, status, members: members.length, present: valued.length };
  });
  return { ok: true, freq: to, method, observations };
}
