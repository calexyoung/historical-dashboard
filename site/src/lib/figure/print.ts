/**
 * The light theme's colours as plain values, for a drawing that leaves the page (the Explorer's
 * chart export). On the page a drawing names its colours as `var(--color-…)` and the stylesheet
 * answers; a file has no stylesheet. export.test.ts checks these against globals.css.
 */
export const PRINT_COLORS: Record<string, string> = {
  "--color-void": "#ffffff",
  "--color-panel": "#ffffff",
  "--color-raised": "#f2f5f8",
  "--color-line": "#dde3ea",
  "--color-line-strong": "#b4bfcc",
  "--color-ink": "#111418",
  "--color-ink-2": "#434d5b",
  "--color-ink-3": "#5b6676",
  "--color-accent": "#2f5e95",
  "--color-band": "#d3e2f2",
  "--color-series-1": "#d55e00",
  "--color-series-2": "#007a5a",
  "--color-series-3": "#1f8ac0",
  "--color-series-4": "#a8528a",
  "--color-series-5": "#b97700",
  "--color-series-6": "#111418",
  "--color-series-7": "#7d7400",
  "--color-series-8": "#6b7480",
};

export const PRINT_FONT = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Markup with every `var(--color-…)` written out. A colour this list does not have is an error, not a guess. */
export function printColors(markup: string): string {
  return markup.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
    const value = PRINT_COLORS[name];
    if (value === undefined) throw new Error(`a drawing uses ${name}, which has no print colour`);
    return value;
  });
}
