/** What the change strip puts in the HTML (M22): three labelled cells, each a door, in ink. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeStrip } from "./ChangeStrip";
import { changeStrip } from "@/lib/figure";
import { CREATED, observations, onDays, series } from "@/lib/figure/testing";

const html = (over: Parameters<typeof series>[0]) => {
  const s = series(over);
  const strip = changeStrip(s, CREATED);
  const cells = strip.cells?.map((cell) => ({ ...cell, href: `/explore?s=${s.key}&y=${cell.years}` })) ?? null;
  return renderToStaticMarkup(<ChangeStrip name={s.name} latest={strip.latest?.words ?? null} marks={strip.marks} cells={cells} reason={strip.reason} basePath="/macro-atlas" />);
};

describe("the change strip in the HTML", () => {
  it("states the latest value, then one labelled cell per span, each a link under the base path", () => {
    const markup = html({ freq: "annual", observations: observations("annual", "2015", [13.5, 12.7, 12.3, 11.8, 10.5, 11.5, 11.6, 11.5, 11.1, 10.6, 10.4]) });
    expect(markup).toContain("10.4% in 2025");
    expect([...markup.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual(["1 year", "5 years", "10 years"]);
    expect([...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/macro-atlas/explore?s=fx_rate&amp;y=1", "/macro-atlas/explore?s=fx_rate&amp;y=5", "/macro-atlas/explore?s=fx_rate&amp;y=10"]);
    expect(markup).toContain("−3.1 pts");
    expect(markup).toContain('aria-label="Fixture rate, 10 years: 3.1 points lower than ten years earlier. Open in the Explorer."');
    // No colour says up or down: the figure is in the link's own colour whichever way it went.
    expect(markup).not.toMatch(/text-(red|green|nominal|outage|delayed)/);
  });

  it("a cell with no figure names the Data state, as a mark and a word, and is still a door", () => {
    const markup = html({ observations: observations("monthly", "2024-12", Array.from({ length: 13 }, (_, i) => 4 + i / 10), { "2025-12": "estimate" }) });
    expect(markup).toContain('data-state="estimate"');
    expect(markup).toContain("The value for December 2025 is an estimate");
    expect(markup.match(/<a /g)!.length).toBeGreaterThanOrEqual(3);
    expect(markup).not.toMatch(/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /); // no link inside a link
  });

  it("a Series with no cadence has its latest value and the reason, and no cells", () => {
    const markup = html({ freq: "irregular", continuity: "held", observations: onDays({ "2020-11-03": 4.5, "2024-11-05": -1.5 }) });
    expect(markup).toContain("no fixed cadence");
    expect(markup).not.toContain("<dl");
  });
});
