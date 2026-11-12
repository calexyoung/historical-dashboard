# checks

Tables of expected behaviour, specified independently of the code that must satisfy them.

| File | Run by | Pins down |
|---|---|---|
| `permits-cases.json` | pytest and Vitest | the rights gate, `permits(rightsUsed, surface)`: against the committed register, in which nothing is signed, and against test registers that cross a row's status (signed, signed in part, unsigned, no row) with the Channel and the Surface (ADR 0020). The test registers and their signatures are test data |
| `period-cases.json` | pytest and Vitest | Period bounds and successors, worked out from a calendar |
| `release-cases.json` | pytest and Vitest | every rule of the release contract, as edits to the fixture release |
| `v1-links.json` | Vitest | what v1's own page did with its 11 presets and with ten hash links: selection, mode, range, layers. Recorded by `scripts/record-v1-links.py` driving v1's built page in a browser; holds keys, months and Event titles, no values. The Explorer must open the same (`site/src/lib/explorer/state.test.ts`, `site/src/lib/legacy/explorer.test.tsx`) |
| `v1-compare-pairs.json` | Vitest | two recorded pairs of ranges over which the Explorer's compare ranges must reproduce v1's result, and the windows, Series and lags over which its statistics are compared with v1's `web/stats.js` (`site/src/lib/legacy/explorer2.test.ts`; `docs/method/statistics.md`). Keys and months, no values |
| `spot.json` | `atlas-core verify`, in every release run | published figures a Release must reproduce where it holds the Series and Period |
| `japan-cpi.json` | `atlas crosscheck japan-cpi` and pytest | which months of Japan's consumer price index are compared between the IMF's series and the Statistics Bureau of Japan's file, on which base and to how many decimals (`docs/v2/japan-cpi-check.md`). No values |
| `v1-parity-windows.json` | Vitest | the three recorded windows over which the engine's Transforms are compared with v1 (`docs/method/transforms.md`) |

A table that both languages run is how the Python and TypeScript sides are kept from drifting.
`spot.json` holds spot values: figures published by someone other than this project, each with a
tolerance and its source, which the Node step of every release run compares with what the Release
holds (`docs/method/release-writer.md`). It is JSON so that the step needs no parser from npm. It
holds expectations, not data: the first is the 12-month change in the CPI to June 2022, 9.1.
