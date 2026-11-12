/**
 * When an Event happened, in words (M19): exactly as precisely as it was recorded. A month is
 * said as a month and a year as a year; a day the record does not give is never shown.
 */
import type { Event } from "@macro-atlas/core/release";
import { dayWords } from "./figure/words";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A day, a month or a year in words, exactly as precisely as it was recorded. */
function dateWords(date: string, style: "long" | "short"): string {
  if (date.length === 4) return date;
  if (date.length === 7) {
    const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
    return `${style === "long" ? month : month.slice(0, 3)} ${date.slice(0, 4)}`;
  }
  return dayWords(date, style);
}

/** When an Event happened, or from when to when. Never a day the record does not give. */
export function eventWhen(event: Pick<Event, "date" | "end">, style: "long" | "short" = "long"): string {
  if (event.end === undefined || event.end === event.date) return dateWords(event.date, style);
  // Two days of one month, in a list: "4 to 9 Aug 2025".
  if (style === "short" && event.date.length === 10 && event.date.slice(0, 7) === event.end.slice(0, 7)) {
    return `${Number(event.date.slice(8))} to ${dateWords(event.end, "short")}`;
  }
  return `${dateWords(event.date, style)} to ${dateWords(event.end, style)}`;
}
