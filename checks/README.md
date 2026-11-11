# checks

Tables of expected behaviour, specified independently of the code that must satisfy them.

| File | Run by | Pins down |
|---|---|---|
| `permits-cases.json` | pytest and Vitest | the `permits(rightsUsed, surface)` contract (M0's default body; M6 extends it) |
| `period-cases.json` | pytest and Vitest | Period bounds and successors, worked out from a calendar |
| `release-cases.json` | pytest and Vitest | every rule of the release contract, as edits to the fixture release |
| `v1-links.json` | Vitest | what v1's own page did with its 11 presets and with ten hash links: selection, mode, range, layers. Recorded by `scripts/record-v1-links.py` driving v1's built page in a browser; holds keys, months and Event titles, no values. The Explorer must open the same (`site/src/lib/explorer/state.test.ts`, `site/src/lib/legacy/explorer.test.tsx`) |
| `v1-compare-pairs.json` | Vitest | two recorded pairs of ranges over which the Explorer's compare ranges must reproduce v1's result, and the windows, Series and lags over which its statistics are compared with v1's `web/stats.js` (`site/src/lib/legacy/explorer2.test.ts`; `docs/method/statistics.md`). Keys and months, no values |
| `v1-parity-windows.json` | Vitest | the three recorded windows over which the engine's Transforms are compared with v1 (`docs/method/transforms.md`) |

A table that both languages run is how the Python and TypeScript sides are kept from drifting.
`spot.yaml` (independently sourced spot values for published Releases) arrives with the writer (M9).
