/**
 * How one answer of Query is said in words: what the values are once a Transform or a slower
 * frequency has been applied, and what an as-of answer rests on. Shared by the series page and
 * its twins, so the page and the files say the same thing. Labels and template sentences only.
 */
import type { TransformName, VintageBasis } from "@macro-atlas/core";
import { dayWords } from "./figure/words";
import type { SeriesAnswer, VintageInfo } from "./query";
import type { SeriesRequest } from "./series-request";

/** The unit of the values as answered. `lin` and `log` keep the Series' own (a logarithm is said separately). */
export function shownUnit(transform: TransformName, unit: string): string {
  switch (transform) {
    case "chg":
      return `change from the period before, ${unit}`;
    case "ch1":
      return `change from a year earlier, ${unit}`;
    case "pch":
      return "percent change from the period before";
    case "pc1":
      return "percent change from a year earlier";
    case "pca":
      return "percent change from the period before, at an annual rate";
    case "log":
      return `natural logarithm of ${unit}`;
    case "rebase":
      return "index, first value in the window = 100";
    case "z":
      return "standard deviations from the mean of the window";
    case "drawdown":
      return "percent below the highest value so far in the window";
    default:
      return unit;
  }
}

const FREQ = (f: string): string => f.replace("_", " ");

/** "percent change from a year earlier · brought from monthly to quarterly by mean · from 1 Jan 2025"; null for the Series as it is. */
export function shownAs(request: SeriesRequest, series: Pick<SeriesAnswer, "unit" | "aggregated">): string | null {
  const parts: string[] = [];
  if (request.transform !== "lin") parts.push(shownUnit(request.transform, series.unit));
  if (series.aggregated) parts.push(`brought from ${FREQ(series.aggregated.from)} to ${FREQ(series.aggregated.to)} by ${series.aggregated.method}`);
  if (request.start && request.end) parts.push(`${dayWords(request.start, "short")} to ${dayWords(request.end, "short")}`);
  else if (request.start) parts.push(`from ${dayWords(request.start, "short")}`);
  else if (request.end) parts.push(`to ${dayWords(request.end, "short")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The five kinds of evidence behind an as-of answer (CONTEXT.md, Basis), strongest first. */
export const BASIS_INFO: Record<VintageBasis, { word: string; slug: string; meaning: string }> = {
  provider: { word: "Provider vintage", slug: "provider-vintage", meaning: "The origin's own record of its releases dates these values: they are what it had published before that time." },
  atlas_observed: { word: "Atlas-observed", slug: "atlas-observed", meaning: "Macro Atlas held these values before that time. That shows they were public by then; it cannot show when they were first reported." },
  legacy: { word: "Legacy", slug: "legacy-basis", meaning: "The values are v1's output, one state with one date. They are what v1 held when it generated its file." },
  uncertain: { word: "Uncertain", slug: "uncertain", meaning: "Macro Atlas held these values at its last look before that time, but one or more days went unseen in between, so a figure may have changed on a day nobody looked." },
  unavailable: { word: "Unavailable", slug: "unavailable", meaning: "Nothing here says what was known before that time. No value is shown in its place." },
};

const UNAVAILABLE: Record<string, string> = {
  no_coverage: "that is before Macro Atlas first fetched this series, and outside any record of the origin's releases it holds",
  no_vintages: "this release holds no history for this series, only its values as they are now",
  legacy_not_dated: "these are v1's values and the release does not say when v1 generated them",
  legacy_held_after_cutoff: "these are v1's values, generated after that time; v1 kept one state and no history",
  input_unavailable: "a series it is computed from has no answer for that time",
  input_not_held: "this release does not hold a series it is computed from",
};
export const unavailableWords = (reason: string | undefined): string => UNAVAILABLE[reason ?? ""] ?? "this release cannot say what was known then";

/** "13 December 2025" for a date; an instant as it was written. */
export const asOfWords = (asOf: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? dayWords(asOf) : asOf);
const instantWords = (instant: string): string => `${dayWords(instant.slice(0, 10), "short")}, ${instant.slice(11, 16)} UTC`;
const days = (n: number): string => `${n} whole ${n === 1 ? "day" : "days"}`;

/**
 * An as-of answer in sentences, the first of which names the Cutoff. Each states a fact of the
 * answer (docs/method/vintage-resolution.md); none says what to make of it.
 */
export function asOfLines(vintage: VintageInfo): string[] {
  const precise = vintage.cutoff?.precision === "datetime";
  const lines = [`As known before ${asOfWords(vintage.as_of)}${precise ? "" : " (00:00 in New York)"}. Basis: ${BASIS_INFO[vintage.basis].word}.`];
  if (vintage.basis === "unavailable") {
    lines.push(`No answer: ${unavailableWords(vintage.reason)}.`);
    return lines;
  }
  const gap = vintage.capture_gap;
  if (gap) {
    const next = gap.to === null ? "There has been no Capture since." : `The next Capture, ${instantWords(gap.to)}, ${gap.changed_across ? "found a change" : "found nothing changed"}.`;
    lines.push(`Last Capture before then: ${instantWords(gap.from)}. ${gap.missed_days > 0 ? `${days(gap.missed_days)} went unseen between it and that time.` : "No day went unseen between it and that time."} ${next}`);
  }
  for (const input of vintage.inputs ?? []) {
    lines.push(`Computed from ${input.key} as known then (${input.basis ? BASIS_INFO[input.basis].word : "no basis"}${input.capture_gap ? `; last Capture ${instantWords(input.capture_gap.from)}` : ""}).`);
  }
  if (vintage.same_day_release) lines.push("A version is dated to that same day; it does not count as known before it.");
  if (vintage.metadata?.differs_from_current) lines.push(`The unit recorded then: ${vintage.metadata.unit}. It has changed since.`);
  const others = vintage.metadata?.other_metadata_periods ?? [];
  if (others.length > 0) {
    const named = others.length > 6 ? `${others.slice(0, 6).join(", ")} and ${others.length - 6} more` : others.join(", ");
    lines.push(
      vintage.left_out_periods.length > 0
        ? `Left out of the arithmetic, because they were still held under an earlier unit or definition: ${named}.`
        : `Still held then under an earlier unit or definition: ${named}.`,
    );
  }
  return lines;
}
