/**
 * The Takeaway: one sentence, from a fixed template, that states the latest figure and its
 * change (CONTEXT.md). It describes and never evaluates: the only words it can add to the
 * figures are "up from", "down from", "unchanged from", "higher than" and "lower than".
 *
 * The templates
 *   T1  {Name} was {value} in {period}, up from|down from|unchanged from {value} in {period}.
 *   T2  {Name} was {value} in {period}, {x}% higher|lower than a year earlier.
 *   T3  {Name} was {value} in {period}.
 *   T4  In {period}, {Name} was {value} and {Name} was {value}.
 *
 * "The latest" is the last Observation the Series holds, with or without a value: an older value
 * is never passed off as the latest. T2 is for levels (an index, a currency amount, a count, a
 * physical quantity) on a monthly, quarterly or annual cadence, where the engine's `pc1` has an
 * answer; otherwise T1 compares with the Observation immediately before; with no value there,
 * T3 makes no comparison. T4 needs Series that are comparable in every recorded respect.
 *
 * Silence. A figure has no sentence when one would mislead (PLAN section 3):
 *   no_values, missing   there is nothing to state for the latest Period
 *   stale                the Series trails the Release by more than its limit
 *   partial, estimate, projected   on either value a sentence would use
 *   break                a break lies after the earlier value, up to and including the latest
 *                        (dated by its own label, whether or not an Observation sits on it)
 *   not_comparable       two Series that differ, or whose difference is not recorded
 * The reason is returned in words, and the figure prints it where the sentence would be.
 */
import { staleness, transform } from "@macro-atlas/core";
import type { FigureObservation, ShownSeries } from "./index";
import { dayWords, fixed, labelStart, list, periodWords, preposition, together } from "./words";

export type SilenceRule = "no_values" | "missing" | "stale" | "partial" | "estimate" | "projected" | "break" | "not_comparable";
export type Silence = { rule: SilenceRule; text: string };
export type TakeawayResult = { takeaway: string; silence: null } | { takeaway: null; silence: Silence };

const quiet = (rule: SilenceRule, why: string): TakeawayResult => ({ takeaway: null, silence: { rule, text: `No summary sentence: ${why}.` } });

const YEAR_EARLIER_KINDS = new Set(["index", "currency", "count", "physical"]);
const PERIODS_PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, annual: 1 };

/** A value with its unit: "4.3%", or "105" with the unit to follow in brackets. */
const bare = (unit: string): boolean => unit.trim() === "%";
const valueText = (text: string, unit: string): string => (bare(unit) ? `${text}%` : text);
const unitNote = (unit: string): string => (bare(unit) ? "" : ` (${unit})`);

/** Whether a value may be stated as an observed, whole-period figure. */
function unusable(s: ShownSeries, o: FigureObservation): TakeawayResult | null {
  const when = periodWords(s.freq, o);
  if (o.status === "partial") return quiet("partial", `${when} is a partial period`);
  if (o.status === "estimate") return quiet("estimate", `the value for ${when} is an estimate`);
  if (o.status === "projected") return quiet("projected", `the value for ${when} is a projection, not an observation`);
  return null;
}

type Single =
  | { ok: false; result: TakeawayResult }
  | { ok: true; latest: FigureObservation & { value: number }; sentence: string };

function single(s: ShownSeries, created: string): Single {
  const no = (result: TakeawayResult): Single => ({ ok: false, result });
  const obs = s.observations;
  const last = obs.at(-1);
  if (!last || !obs.some((o) => o.value !== null)) return no(quiet("no_values", "the series has no values"));
  const when = periodWords(s.freq, last);
  if (last.value === null) return no(quiet("missing", `the latest period (${when}) has no value`));
  const stale = staleness(last.period_end, s.maxLag, created);
  if (stale.known && stale.stale) {
    return no(quiet("stale", `the series is stale. Its latest value is for ${when} and this release was made on ${dayWords(created.slice(0, 10))}`));
  }
  const refused = unusable(s, last);
  if (refused) return no(refused);

  const latest = last as FigureObservation & { value: number };
  const prep = preposition(s.freq);
  const head = (value: string) => `${s.name} was ${valueText(value, s.unit)} ${prep} ${when}${unitNote(s.unit)}`;
  // A break is dated by its own label, not by an Observation: one that falls between two
  // Observations of a slow or irregular Series still separates them. A label that cannot be
  // dated is treated as lying between, so an unreadable break never lets a sentence through.
  const brokenSince = (earlier: FigureObservation) =>
    (s.breaks ?? []).find((b) => {
      const at = labelStart(s.freq, b.period);
      return at === null || (at.period_start > earlier.period_start && at.period_start <= latest.period_start);
    });
  const breakSilence = (period: string) => {
    const at = labelStart(s.freq, period);
    return no(quiet("break", `the series has a break at ${at ? periodWords(at.freq, at) : period}, between the two periods a sentence would compare`));
  };

  // T2: against the same Period a year earlier, computed by the engine.
  const lag = PERIODS_PER_YEAR[s.freq];
  if (lag !== undefined && s.unitKind !== undefined && YEAR_EARLIER_KINDS.has(s.unitKind) && obs.length > lag) {
    const earlier = obs[obs.length - 1 - lag]!;
    const answer = transform({ freq: s.freq, continuity: s.continuity, observations: obs }, "pc1", { from: latest.period_start });
    const change = answer.ok ? answer.observations.at(-1)?.value : null;
    if (earlier.value !== null && earlier.value > 0 && latest.value > 0 && change !== null && change !== undefined) {
      const refusedEarlier = unusable(s, earlier);
      if (refusedEarlier) return no(refusedEarlier);
      const broken = brokenSince(earlier);
      if (broken) return breakSilence(broken.period);
      const [value] = together([latest.value]);
      const size = Math.abs(change);
      const percent = fixed(size, size !== 0 && size < 0.05 ? 2 : 1);
      const tail = change === 0 ? "unchanged from a year earlier" : `${percent}% ${change > 0 ? "higher" : "lower"} than a year earlier`;
      return { ok: true, latest, sentence: `${head(value!)}, ${tail}.` };
    }
  }

  // T1: against the Observation immediately before. T3 when that one has no value.
  const before = obs.length > 1 ? obs[obs.length - 2]! : null;
  if (before === null || before.value === null) return { ok: true, latest, sentence: `${head(together([latest.value])[0]!)}.` };
  const refusedBefore = unusable(s, before);
  if (refusedBefore) return no(refusedBefore);
  const broken = brokenSince(before);
  if (broken) return breakSilence(broken.period);
  const [value, earlier] = together([latest.value, before.value]);
  const direction = latest.value > before.value ? "up from" : latest.value < before.value ? "down from" : "unchanged from";
  return { ok: true, latest, sentence: `${head(value!)}, ${direction} ${valueText(earlier!, s.unit)} ${prep} ${periodWords(s.freq, before)}.` };
}

/** Why Series may not share a sentence, or null when they may. Unrecorded is never "the same". */
function notComparable(all: ShownSeries[]): string | null {
  const same = <T>(of: (s: ShownSeries) => T) => all.every((s) => of(s) === of(all[0]!));
  if (!same((s) => s.unit)) return "they are not in the same unit";
  if (!same((s) => s.freq) || !same((s) => s.continuity)) return "they are not at the same frequency";
  if (!same((s) => s.representation)) return "one holds v1's rounded values and the other does not";
  const facts: [string, (s: ShownSeries) => string | undefined, string][] = [
    ["what they measure", (s) => s.measureKind, "they do not measure the same kind of quantity"],
    ["the kind of unit", (s) => s.unitKind, "they are not in the same kind of unit"],
    ["seasonal adjustment", (s) => s.seasonalAdjustment, "they differ in seasonal adjustment"],
    ["price basis", (s) => s.priceBasis, "they differ in price basis"],
    ["the country", (s) => s.country, "they are not for the same country"],
  ];
  for (const [name, of, differ] of facts) {
    if (all.some((s) => of(s) === undefined)) return `${name} is not recorded for them`;
    if (!same(of)) return differ;
  }
  if (!same((s) => s.observations.at(-1)?.period)) return "their latest values are for different periods";
  return null;
}

export function takeawayFor(all: ShownSeries[], created: string): TakeawayResult {
  if (all.length === 0) return quiet("no_values", "there is no series to describe");
  const each = all.map((s) => single(s, created));
  if (all.length === 1) {
    const only = each[0]!;
    return only.ok ? { takeaway: only.sentence, silence: null } : only.result;
  }
  const why = notComparable(all);
  if (why) return quiet("not_comparable", `these series are not comparable (${why})`);
  for (const one of each) if (!one.ok) return one.result;
  const first = all[0]!;
  const values = together(each.map((one) => (one as Extract<Single, { ok: true }>).latest.value));
  const parts = all.map((s, i) => `${s.name} was ${valueText(values[i]!, s.unit)}`);
  const when = periodWords(first.freq, first.observations.at(-1)!);
  return { takeaway: `${preposition(first.freq) === "in" ? "In" : "On"} ${when}, ${list(parts)}${unitNote(first.unit)}.`, silence: null };
}
