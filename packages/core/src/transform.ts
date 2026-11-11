/**
 * Transforms: named, reader-chosen re-expressions of a Series (CONTEXT.md). The contract is
 * `docs/method/transforms.md`; this module is tested from that text.
 *
 * `transform(series, name, window)` answers for the Observations that belong to the window, at
 * the Series' native frequency. It never fills, interpolates or carries a value forward. It
 * either answers (some Periods may be empty, each saying why) or is unavailable with a reason.
 *
 * Pure. Hidden here: which Observations belong to a window (by Period start; plus the standing
 * Observation of a held Series), the look-back for `pc1`, and every edge of the arithmetic.
 */
import type { Frequency } from "./period";

/** Raised by any change in what a Transform returns (PLAN 4.5). */
export const SEMANTICS_VERSION = "0.3.0";

/** v1's six scale modes under FRED's names, plus v1's drawdown. The rest arrive in M11. */
export const TRANSFORMS = ["lin", "log", "rebase", "z", "pc1", "drawdown"] as const;
export type TransformName = (typeof TRANSFORMS)[number];

export type TransformObservation = {
  period: string;
  period_start: string;
  period_end: string;
  value: number | null;
  status: string;
};

/** What a Transform needs to know of a Series: its cadence, how values stand, its Observations. */
export type TransformSeries = {
  freq: Frequency;
  continuity: "discrete" | "held";
  /** In Period order, with every gap explicit, as a Release holds them. */
  observations: readonly TransformObservation[];
  /**
   * The Transforms the Catalog offers for this Series (`allowed_transforms`). Absent or empty:
   * none is ruled out. One that is not on the list is unavailable, whatever the window holds.
   */
  allowed?: readonly string[];
};

/** Calendar dates, both inclusive. Either may be left open. */
export type TransformWindow = { from?: string; to?: string };

/** Why one Period of an answer has no value. */
export type EmptyReason =
  | "missing"
  | "not_positive"
  | "no_year_earlier"
  | "zero_year_earlier"
  | "peak_not_positive";

export type TransformedObservation = TransformObservation & { empty?: EmptyReason };

export type UnavailableReason =
  | "unknown_transform"
  | "not_offered"
  | "bad_window"
  | "no_values"
  | "base_not_positive"
  | "no_variation"
  | "frequency_not_supported";

/** What the answer was measured against, where a Transform has such a thing. */
export type TransformReference =
  | { kind: "rebase"; period: string; value: number }
  | { kind: "z"; mean: number; sd: number; n: number }
  | { kind: "pc1"; lag: number };

export type TransformResult =
  | { ok: true; transform: TransformName; observations: TransformedObservation[]; reference?: TransformReference }
  | { ok: false; transform: string; reason: UnavailableReason; message: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isDate(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const m = DATE.exec(text);
  if (!m || Number(m[1]) < 1) return false;
  const d = new Date(Date.UTC(2000, Number(m[2]) - 1, Number(m[3])));
  d.setUTCFullYear(Number(m[1]));
  return d.toISOString().slice(5, 10) === text.slice(5); // rejects 2024-02-30
}

/** How many Periods make one year, where counting Periods can say so. */
const PERIODS_PER_YEAR: Partial<Record<Frequency, number>> = { monthly: 12, quarterly: 4, annual: 1 };

/** Indices of the Observations that belong to the window, in order (transforms.md). */
function members(series: TransformSeries, window: TransformWindow): number[] {
  const { observations } = series;
  const from = window.from ?? "0001-01-01";
  const to = window.to ?? "9999-12-31";
  const inside: number[] = [];
  let standing = -1;
  for (let i = 0; i < observations.length; i++) {
    const start = observations[i]!.period_start;
    if (start < from) standing = i;
    else if (start <= to) inside.push(i);
  }
  // A held value stands until the next Observation; a missing Observation ends the hold. If an
  // Observation starts on the very day the window opens, the earlier one has already given way.
  const replaced = inside.length > 0 && observations[inside[0]!]!.period_start === from;
  if (series.continuity === "held" && standing >= 0 && !replaced && observations[standing]!.value !== null) {
    inside.unshift(standing);
  }
  return inside;
}

const copy = (o: TransformObservation, value: number | null, empty?: EmptyReason): TransformedObservation => {
  const out: TransformedObservation = {
    period: o.period,
    period_start: o.period_start,
    period_end: o.period_end,
    value,
    status: o.status,
  };
  if (value === null && empty) out.empty = empty;
  return out;
};

export function transform(
  series: TransformSeries,
  name: TransformName,
  window: TransformWindow = {},
): TransformResult {
  const unavailable = (reason: UnavailableReason, message: string): TransformResult => ({
    ok: false,
    transform: String(name),
    reason,
    message,
  });
  if (!(TRANSFORMS as readonly string[]).includes(name)) {
    return unavailable("unknown_transform", `there is no transform called ${JSON.stringify(name)}`);
  }
  if (series.allowed && series.allowed.length > 0 && !series.allowed.includes(name)) {
    const offered = series.allowed.filter((t) => (TRANSFORMS as readonly string[]).includes(t));
    const list = offered.length > 1 ? `${offered.slice(0, -1).join(", ")} and ${offered.at(-1)}` : offered.join("");
    return unavailable("not_offered", `this series does not offer ${name}; it offers ${list || "none of the transforms the engine has"}`);
  }
  for (const edge of [window.from, window.to]) {
    if (edge !== undefined && !isDate(edge)) {
      return unavailable("bad_window", "a window runs between two calendar dates, written YYYY-MM-DD");
    }
  }
  if (window.from !== undefined && window.to !== undefined && window.from > window.to) {
    return unavailable("bad_window", "the window ends before it starts");
  }

  const all = series.observations;
  const picked = members(series, window);
  const present = picked.filter((i) => all[i]!.value !== null);
  const each = (compute: (value: number, index: number) => [number | null, EmptyReason?]): TransformedObservation[] =>
    picked.map((i) => {
      const o = all[i]!;
      if (o.value === null) return copy(o, null, "missing");
      const [value, empty] = compute(o.value, i);
      return copy(o, value !== null && Number.isFinite(value) ? value : null, empty ?? "missing");
    });

  switch (name) {
    case "lin":
      return { ok: true, transform: name, observations: each((x) => [x]) };

    case "log":
      return { ok: true, transform: name, observations: each((x) => (x > 0 ? [Math.log(x)] : [null, "not_positive"])) };

    case "rebase": {
      if (present.length === 0) return unavailable("no_values", "there is no value in the window to use as the base");
      const base = all[present[0]!]!;
      const b = base.value!;
      if (!(b > 0)) {
        return unavailable("base_not_positive", `the first value in the window (${base.period}) is not above zero, so it cannot be the base of an index`);
      }
      return {
        ok: true,
        transform: name,
        observations: each((x) => [(x / b) * 100]),
        reference: { kind: "rebase", period: base.period, value: b },
      };
    }

    case "z": {
      const n = present.length;
      if (n === 0) return unavailable("no_values", "there is no value in the window");
      // Identical values have no deviation. Asked directly, because a sum of decimals can
      // round the mean away from the values and invent one.
      const first = all[present[0]!]!.value!;
      if (present.every((i) => all[i]!.value === first)) {
        return unavailable("no_variation", "every value in the window is the same, so there is no deviation to measure");
      }
      let sum = 0;
      for (const i of present) sum += all[i]!.value!;
      const mean = sum / n;
      let squares = 0;
      for (const i of present) squares += (all[i]!.value! - mean) ** 2;
      const sd = Math.sqrt(squares / n); // population standard deviation
      if (!(sd > 0)) return unavailable("no_variation", "every value in the window is the same, so there is no deviation to measure");
      return {
        ok: true,
        transform: name,
        observations: each((x) => [(x - mean) / sd]),
        reference: { kind: "z", mean, sd, n },
      };
    }

    case "pc1": {
      const lag = PERIODS_PER_YEAR[series.freq];
      if (lag === undefined) {
        return unavailable(
          "frequency_not_supported",
          series.freq === "irregular"
            ? "an irregular series has no observation one year earlier to compare with"
            : `a ${series.freq.replace("_", " ")} series must be brought to a monthly or slower frequency first`,
        );
      }
      return {
        ok: true,
        transform: name,
        observations: each((x, i) => {
          const earlier = i >= lag ? all[i - lag]!.value : null;
          if (earlier === null) return [null, "no_year_earlier"];
          if (earlier === 0) return [null, "zero_year_earlier"];
          return [(x / earlier - 1) * 100];
        }),
        reference: { kind: "pc1", lag },
      };
    }

    case "drawdown": {
      let peak: number | null = null;
      return {
        ok: true,
        transform: name,
        observations: each((x) => {
          if (peak === null || x > peak) peak = x;
          return peak > 0 ? [(x / peak - 1) * 100] : [null, "peak_not_positive"];
        }),
      };
    }
  }
}
