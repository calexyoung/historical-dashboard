/** What the figure component puts in the HTML for the cases a model test cannot see (M3). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Figure } from "./Figure";
import { renderFigure } from "@/lib/figure";
import { CREATED, observations, series } from "@/lib/figure/testing";

const html = (...list: Parameters<typeof series>[0][]) =>
  renderToStaticMarkup(<Figure figure={renderFigure({ created: CREATED }, list.map(series))} basePath="/macro-atlas" explorerHref="/macro-atlas/explore?s=fx_rate" />);

describe("the figure in the HTML", () => {
  it("a Series with no values still says why there is no sentence, names its gaps and has its table", () => {
    const markup = html({ observations: observations("monthly", "2025-01", [null, null]) });
    expect(markup).toContain('data-silence="no_values"');
    expect(markup).toContain("No summary sentence: the series has no values.");
    expect(markup).not.toContain('role="img"');
    expect(markup).toContain('data-state="missing"');
    expect(markup.match(/<tr/g)).toHaveLength(3);
  });

  it("a state is in the table row it belongs to: stale on the last value, break on the first row of the new basis", () => {
    const markup = html({ maxLag: "P1M", breaks: [{ period: "2024-06", note: "New basis." }], observations: observations("monthly", "2024-05", [4.1, 4.2, 4.3]) });
    const rows = [.../<tbody>([\s\S]*?)<\/tbody>/.exec(markup)![1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toContain("data-state");
    expect(rows[1]).toContain('data-state="break"');
    expect(rows[1]).toContain("New basis.");
    expect(rows[2]).toContain('data-state="stale"');
    expect(rows[1]).not.toContain('data-state="stale"');
  });

  it("exactly one of a takeaway and a reason for silence, and three drawings per plot", () => {
    const said = html({ observations: observations("monthly", "2025-11", [4.2, 4.3]) });
    expect(said).toContain("data-takeaway");
    expect(said).not.toContain("data-silence");
    expect(said.match(/<svg[^>]*role="img"/g)).toHaveLength(3);
    const silent = html({ observations: observations("monthly", "2025-11", [4.2, 4.3], { "2025-12": "partial" }) });
    expect(silent).toContain('data-silence="partial"');
    expect(silent).not.toContain("data-takeaway");
  });

  it("carries no script, no inline handler and no style element", () => {
    expect(html({ observations: observations("monthly", "2025-11", [4.2, 4.3]) })).not.toMatch(/<script|<style|\son[a-z]+=/);
  });
});
