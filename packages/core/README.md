# @macro-atlas/core

The one analytical engine (ADR 0003): everything that turns stored Observations into an answer is
implemented once, here, as pure TypeScript with no file or network access, and runs in Node and in
the browser.

| Entry | Holds (so far) |
|---|---|
| `@macro-atlas/core` | `permits()` (the rights gate contract), Period arithmetic |
| `@macro-atlas/core/release` | `validateRelease()`, the release types generated from `schema/release.schema.json`. Node only: it compiles a JSON Schema, so it stays out of browser bundles |

Transforms arrive in M2, the rest of the engine from M11. Tests: `npm test` at the repo root.
