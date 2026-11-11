# @macro-atlas/core

The one analytical engine (ADR 0003): everything that turns stored Observations into an answer is
implemented once, here, as pure TypeScript with no file or network access, and runs in Node and in
the browser.

| Entry | Holds (so far) |
|---|---|
| `@macro-atlas/core` | `permits()` and `createRightsGate()` (the rights gate over the rights register, ADR 0020), Period arithmetic, `transform()` for v1's six modes (`docs/method/transforms.md`), `staleness()` against a Release's own clock, statistics (`docs/method/statistics.md`), `resolve()` for as-of questions with every Basis (`docs/method/vintage-resolution.md`) |
| `@macro-atlas/core/release` | `validateRelease()`, the release types generated from `schema/release.schema.json`. Node only: it compiles a JSON Schema, so it stays out of browser bundles |

The rest of the transform allowlist, aggregation and recipes arrive from M11. A test bundles the
main entry for the browser and fails if anything in it imports a Node built-in. Tests: `npm test` at the repo root.
