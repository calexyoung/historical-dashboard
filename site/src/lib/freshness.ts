/**
 * How fresh the Release being served is: the dot and its word in the top bar (PLAN section 3).
 * Always a shape, a colour and a word together, never colour alone. Pure.
 */
import type { Failure } from "./release/reader";

export type FreshnessState = "current" | "stale" | "refresh_failed";
export type Freshness = { state: FreshnessState; word: string; detail: string; ageSeconds: number };

/** The refresh is daily (ADR 0008), so a Release older than a day and a half has missed one. */
export const STALE_AFTER_SECONDS = 36 * 3600;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day in UTC, day first: "1 Jan 2026". */
export function formatDay(instant: string): string {
  const d = new Date(instant);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function freshness(created: string, refreshFailed: Omit<Failure, "ok"> | null, now: number): Freshness {
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(created)) / 1000));
  const day = formatDay(created);
  if (refreshFailed) {
    return { state: "refresh_failed", word: "Refresh failed", detail: `showing the release of ${day}`, ageSeconds };
  }
  if (ageSeconds > STALE_AFTER_SECONDS) {
    const days = Math.floor(ageSeconds / 86_400);
    return { state: "stale", word: "Stale", detail: `release of ${day}, ${days} ${days === 1 ? "day" : "days"} old`, ageSeconds };
  }
  return { state: "current", word: "Current", detail: `release of ${day}`, ageSeconds };
}
