/** The glossary: the site's own words, each defined once (M3). */
import { describe, expect, it } from "vitest";
import { DATA_STATES, STATE_INFO } from "./figure";
import { GLOSSARY, GLOSSARY_GROUPS, glossaryEntry, glossaryHref } from "./glossary";

describe("the glossary", () => {
  it("has an entry, with its mark, for every Data state and for Suppressed", () => {
    for (const state of [...DATA_STATES, "suppressed"] as const) {
      const entry = GLOSSARY.find((e) => e.mark === state);
      expect(entry, state).toBeDefined();
      expect(entry!.term).toBe(STATE_INFO[state].word);
      expect(entry!.definition).toContain(STATE_INFO[state].meaning);
      expect(entry!.definition).toContain(STATE_INFO[state].shape); // the mark is described in words too
    }
  });

  it("defines the words a series page uses about where a number comes from", () => {
    for (const slug of ["origin", "channel", "rights", "release", "legacy-representation", "held-series", "period", "frequency", "takeaway", "not-shown-here"]) {
      expect(glossaryEntry(slug), slug).not.toBeNull();
    }
  });

  it("slugs are unique, safe in an address, and found by lookup; anything else is not an entry", () => {
    const slugs = GLOSSARY.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(glossaryEntry(slug)!.slug).toBe(slug);
      expect(glossaryHref("/macro-atlas", slug)).toBe(`/macro-atlas/docs/glossary/${slug}`);
    }
    for (const bad of ["", "Origin", "../data", "origin/", "constructor", "__proto__", "toString"]) expect(glossaryEntry(bad), bad).toBeNull();
  });

  it("every cross-reference leads to an entry, and every entry is in a group that is listed", () => {
    for (const entry of GLOSSARY) {
      for (const slug of entry.see ?? []) expect(glossaryEntry(slug), `${entry.slug} -> ${slug}`).not.toBeNull();
      expect(GLOSSARY_GROUPS).toContain(entry.group);
    }
  });

  it("definitions are plain sentences that describe and do not evaluate", () => {
    for (const entry of GLOSSARY) {
      expect(entry.definition, entry.slug).toMatch(/^[A-Z].*\.$/s);
      expect(entry.definition, entry.slug).not.toMatch(/\b(good|bad|better|worse|reliable|unreliable|trustworthy|accurate|misleading|should|unfortunately|simply|obviously)\b/i);
    }
  });
});
