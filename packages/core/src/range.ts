/**
 * The range across the members of a group (PLAN M23; ADR 0037). The contract is
 * `docs/method/topics.md`; this module is tested from that text.
 *
 * `rangeAcross(members, { of })` answers, for each Period, with how many members have a value
 * that counts, which they are, and the lowest, the middle and the highest of those values. It
 * is what "the United States against the G20 range" is drawn from.
 *
 * What counts: a value its origin published as an observation (final, preliminary or
 * revised). An estimate, a projection, a partial Period and a missing or suppressed value do
 * not. The median is unweighted: each member is one value, whatever the size of its economy.
 * With an even count it is the mean of the two middle values.
 *
 * A Period has a range only when at least `least` members count in it; by default that is
 * more than half of `of`, the number of members the group was declared with (not the number
 * handed in: a member the caller could not show is still part of the denominator). Below
 * that the three figures are null and the count and the members are still given. Membership
 * changes from Period to Period, so the range can move when no member's value has: that is
 * why every Period says who was counted.
 *
 * The caller hands in only what it may use (the rights gate is asked before this is called,
 * so a refused Series is never an argument here) and only Series that can be compared: one
 * frequency, one unit, one kind of measure. This function cannot know either; it does refuse
 * Periods that do not line up. Pure. Adding it changed no Transform, aggregation or Measure,
 * so `SEMANTICS_VERSION` stayed 0.8.0.
 */
export type RangeObservation = { period: string; period_start: string; period_end: string; value: number | null; status: string };
export type RangeMember = { key: string; observations: readonly RangeObservation[] };

export type RangePeriod = {
  period: string;
  period_start: string;
  period_end: string;
  /** How many members count in this Period. */
  n: number;
  /** Their keys, in the order the members were given. */
  members: string[];
  /** Null when fewer than `least` members count. */
  minimum: number | null;
  median: number | null;
  maximum: number | null;
};

export type RangeAcross = {
  /** The number of members the group was declared with: the denominator a page states. */
  of: number;
  /** The fewest members a Period's range is stated for. */
  least: number;
  /** Every Period any member has an Observation for, in order. */
  periods: RangePeriod[];
};

/** Statuses of a value that is not an observation its origin published. */
const NOT_COUNTED: ReadonlySet<string> = new Set(["estimate", "projected", "partial", "missing", "suppressed"]);

export function rangeAcross(members: readonly RangeMember[], options: { of: number; least?: number }): RangeAcross {
  const of = options.of;
  if (!Number.isInteger(of) || of < 1) throw new Error("a range is of a whole number of declared members");
  if (members.length > of) throw new Error(`${members.length} members were given, more members than the ${of} declared`);
  const least = options.least ?? Math.floor(of / 2) + 1;
  if (!Number.isInteger(least) || least < 1) throw new Error("the least number of members is a whole number above zero");

  const byPeriod = new Map<string, { start: string; end: string; values: number[]; members: string[] }>();
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.key)) throw new Error(`the member ${member.key} was given twice`);
    seen.add(member.key);
    for (const o of member.observations) {
      let held = byPeriod.get(o.period);
      if (!held) byPeriod.set(o.period, (held = { start: o.period_start, end: o.period_end, values: [], members: [] }));
      else if (held.start !== o.period_start || held.end !== o.period_end) throw new Error(`the members' Periods are not the same Periods (${o.period})`);
      if (o.value === null || NOT_COUNTED.has(o.status)) continue;
      if (!Number.isFinite(o.value)) throw new Error(`${member.key} holds a value for ${o.period} that is not a finite number`);
      held.values.push(o.value);
      held.members.push(member.key);
    }
  }

  const ordered = [...byPeriod].sort(([, a], [, b]) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  // Periods of one frequency do not overlap: two that do are of different frequencies.
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]![1].start <= ordered[i - 1]![1].end) throw new Error(`the members' Periods are not the same Periods (${ordered[i - 1]![0]} and ${ordered[i]![0]})`);
  }
  const periods = ordered.map(([period, held]): RangePeriod => {
    const base = { period, period_start: held.start, period_end: held.end, n: held.values.length, members: held.members };
    if (held.values.length < least) return { ...base, minimum: null, median: null, maximum: null };
    const sorted = [...held.values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
    return { ...base, minimum: sorted[0]!, median, maximum: sorted.at(-1)! };
  });
  return { of, least, periods };
}
