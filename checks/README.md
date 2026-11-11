# checks

Tables of expected behaviour, specified independently of the code that must satisfy them.

| File | Run by | Pins down |
|---|---|---|
| `permits-cases.json` | pytest and Vitest | the `permits(rightsUsed, surface)` contract (M0's default body; M6 extends it) |
| `period-cases.json` | pytest and Vitest | Period bounds and successors, worked out from a calendar |
| `release-cases.json` | pytest and Vitest | every rule of the release contract, as edits to the fixture release |
| `v1-parity-windows.json` | Vitest | the three recorded windows over which the engine's Transforms are compared with v1 (`docs/method/transforms.md`) |

A table that both languages run is how the Python and TypeScript sides are kept from drifting.
`spot.yaml` (independently sourced spot values for published Releases) arrives with the writer (M9).
