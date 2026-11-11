// Period arithmetic against the shared, calendar-derived table (schema/README.md).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextPeriod, periodBounds } from "./period";

type Valid = { freq: string; label: string; start: string; end: string; next: string | null };
type Invalid = { freq: string; label: string; why: string };
const table = JSON.parse(
  readFileSync(new URL("../../../checks/period-cases.json", import.meta.url), "utf8"),
) as { valid: Valid[]; invalid: Invalid[] };

describe("periods", () => {
  it.each(table.valid)("$freq $label has its bounds and successor", (c) => {
    expect(periodBounds(c.freq, c.label)).toEqual({ start: c.start, end: c.end });
    expect(nextPeriod(c.freq, c.label)).toBe(c.next);
  });

  it.each(table.invalid)("$freq $label is refused ($why)", (c) => {
    expect(periodBounds(c.freq, c.label)).toBeNull();
    expect(nextPeriod(c.freq, c.label)).toBeNull();
  });
});
