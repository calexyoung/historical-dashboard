---
status: accepted (M2, 2026-11-11)
---

# The legacy converter carries v1's values as they are, computed ones included

ADR 0003 says one engine, in TypeScript, computes every derived value, and PLAN 4.2 says only the
Node step writes `derived/`. M2's legacy converter (`atlas legacy-release`, Python) has to put
v1's 126 series into a Release so the v2 site can be used before the real sources exist. Fifteen
of those series were computed by v1 (fourteen year-over-year series and gold in euros), and three
are built by v1 from hand-entered files (presidential approval and two election margins). This
records how that fits the rule.

## Decisions

1. **A narrow exception, for the legacy converter only.** It copies v1's computed series into
   `derived/` as v1 wrote them. It does not recompute them, and it is not a second engine: no
   other Python code may write `derived/`, and the release writer (M9) leaves it to the Node step.
2. **The recipe on a legacy derived Series is lineage, not a promise.** `pct_change` of the
   parent, or `ratio` of two inputs, says what v1 computed the Series from, so the rights gate is
   asked about every input. The stored values are the authority. Running the recipe on the
   parent's values would not reproduce them exactly: v1 computed from unrounded monthly values
   and rounded afterwards, and only the rounded ones survive. Nothing recomputes them; Query
   serves the stored Observations.
3. **The two election margins and approval are stored Series, not derived ones.** Their inputs
   (vote counts, quarterly figures) are hand-entered in v1's YAML files and are not Series. The
   converter applies v1's own arithmetic to them, and a test checks the result against v1's build
   step. They live in `series/` with the channel `hand_entered`.
4. **Everything from the converter is `legacy_monthly_rounded`, local profile, rights not
   settled.** So none of it can be served on a public Surface (ADR 0006, PLAN 6.1), whatever a
   recipe says. Its manifest's `semantics_version` is `v1-legacy`: the v2 engine did not write
   these files.
5. **What v1 did not record is said, not guessed.** v1 knows a FRED series id or a Yahoo symbol,
   not the agency that produces the series, so the Origin's producer reads "Not recorded by v1".
   That placeholder is not an Origin a rights register row can clear; real Origins arrive with the
   agency adapters (M10 onward). v1 has no Status for an Observation either: values are carried
   as `final` (approval, which v1 labels approximate, as `estimate`), and the legacy
   representation is what tells a reader not to rely on that.

## Consequences

- The converter is removed at cutover unless Alex keeps it for local use (PLAN 4.2). The exception
  goes with it.
- A reader of a legacy Release sees v1's numbers exactly, at each Series' real cadence. What the
  engine's Transforms then do with them, and where that deliberately differs from v1's page, is
  listed in `docs/method/transforms.md`.
