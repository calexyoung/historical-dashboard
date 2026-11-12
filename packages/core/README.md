# @macro-atlas/core

The one analytical engine (ADR 0003): everything that turns stored Observations into an answer is
implemented once, here, as pure TypeScript with no file or network access, and runs in Node and in
the browser.

| Entry | Holds (so far) |
|---|---|
| `@macro-atlas/core` | `permits()` and `createRightsGate()` (the rights gate over the rights register, ADR 0020), Period arithmetic, `staleness()` against a Release's own clock, statistics (`docs/method/statistics.md`), `resolve()` for as-of questions with every Basis (`docs/method/vintage-resolution.md`), `aggregate()` by Measure kind, `transform()` for the whole allowlist, and `evaluateRecipe()` for Derived series: dependency closure, the weakest Basis among inputs, the most restrictive Rights (`docs/method/transforms.md`) |
| `@macro-atlas/core/release` | `validateRelease()`, the release types generated from `schema/release.schema.json`. Node only: it compiles a JSON Schema, so it stays out of browser bundles |

A test bundles the main entry for the browser and fails if anything in it imports a Node
built-in. Tests: `npm test` at the repo root.

## atlas-core

`bin/atlas-core.mjs` is the engine from the command line, and the Node step of the publisher
(ADR 0002, ADR 0025):

```
node packages/core/bin/atlas-core.mjs verify --release STAGED [--spot checks/spot.json]
```

It computes the Derived series a staged Release asks for (`STAGED/engine-request.json`) into
`STAGED/derived/` and writes `STAGED/engine-report.json`, each file created new, and nothing
outside that directory. It runs this package's TypeScript as it is, on Node 22.18 or later, with
no `node_modules`: Node strips the types and one small hook finds the engine's extensionless
imports. Its file access is in `src/cli/`, which is no part of the main entry.
