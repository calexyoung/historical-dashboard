---
status: accepted (Gate 1, 2026-11-11)
---

# One analytical engine, in TypeScript

A claim's evidence must not disagree with its own chart. So everything that turns stored
observations into an answer (vintage resolution, aggregation by measure kind, transforms, recipes
for derived series, claim measures, window sensitivity) is implemented once, in a pure TypeScript package with no file or network
access. Pages, the read API, the Explorer in the browser, the claim CLI and the bulk export all call
it. Python never computes a derived value; v1's `derive_yoy` and `div` become recipes.

## Considered options

- **Compute derived series in Python at ingest and transforms in TypeScript, tied by shared test
  vectors.** Less change from v1, but two engines with an overlap that has to be policed forever,
  and exactly the overlap (year-over-year) that claims use most.
- **Engine in Python, called by the site.** The Explorer could not run it in the browser.

## Consequences

- Node is part of the authoring toolchain (`atlas claims compute` runs the engine).
- Expected results in the engine's tests are specified independently (hand-computed tables and
  published figures), not by comparing two callers of the same code.
- Every answer and every claim lock records the engine's `semantics_version`. A behaviour change
  bumps it. Old versions are not kept executable: a lock keeps its frozen numbers, and a drift
  report flags locks whose numbers would differ under the new version for a person to re-lock.
