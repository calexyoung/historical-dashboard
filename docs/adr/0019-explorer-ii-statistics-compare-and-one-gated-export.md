---
status: accepted (M5, 2026-11-11)
---

# Explorer II: statistics at a pair's common frequency, a second range on the same axis, and one gated export

M5 brings the Explorer to v1's parity: statistics, compare ranges, the snapshot table, marks at
the extremes, and CSV and PNG export. v1 did all of it in the browser on one axis of months. v2
draws every view on the server from its address (ADR 0018), keeps each Series at its own
frequency (ADR 0003, `transforms.md`), and may hand nothing out without asking the rights gate
(ADR 0006, PLAN 6.1). This records what followed from those three.

## Decisions

1. **The parameters a v1 link carried are real ones, under v1's names**: `cmp`, `basis`, `lag`,
   `sx`, `sy`, `roll`, `ext` (ADR 0018, point 6). A v1 link that asks for them now gets them.
   They are further fields of the same address, written in one fixed order; none has a second
   copy in the browser.
2. **Statistics are the engine's, and descriptive** (`docs/method/statistics.md`). No p-value is
   computed anywhere. v1's two caveats are fixed: the floor on pairs is honoured, and a pair is
   compared at the slower of its two frequencies, so quarterly and annual Series have changes.
3. **A faster Series is combined by its declared `agg`**, for statistics only. This is a piece
   of the aggregation PLAN 4.5 gives to M11, brought forward because caveat 2 cannot be fixed
   without it: a monthly Series and a quarterly one have no common axis otherwise. It is one
   function in `packages/core/src/stats.ts`; M11 extends it to Transforms and to daily and
   weekly Series rather than writing a second. For v1's carried-over Series `agg` is what v1's
   catalog said of how daily values became a month; it is the same statement about the measure
   (a price index is averaged, a month-end close is taken last, a flow is summed), and M16
   re-declares it per Series when they are re-sourced.
4. **Relationships read each Series' own values, whatever the chart's mode, and ignore the second
   range.** The matrix and the rolling correlation are at lag 0; only the pair's own figure,
   scatter and lag profile use `lag` (as v1). The whole Series is asked of Query, not the
   window, because a change at the window's first Period looks back one Period.
5. **A second range is drawn on the first range's time axis**, each of its Observations placed
   as many months after the left edge as it is after the second range's start. The axis keeps
   real dates (the first range's); v1 relabelled it "+N months". The second run has the Series'
   colour, line style and symbol and differs by weight: pale and wide, hollow symbols. Its own
   dates are in the readout, the table and the export. The Transform is applied to each range
   separately. No Layer is drawn while two ranges share the axis, as in v1, and the page says so.
   In the figure module a second run is a Series with its own key and a `ghost` reference to the
   Series it is a run of, so a run never collides with its Series in styles, tables or staleness.
6. **Marks at the extremes** (`ext=1`) are chosen by the value as drawn and labelled with the
   Series' own value and Period, the first of equals, on the first range only: v1's rule.
7. **One export function, and it asks the gate first.** `exportView(release, surface, state,
   format)` in `site/src/lib/export` asks `permits()` for the Permission `redistribute` with the
   full lineage of what the file would hold (the Series and every input of a derived one), and
   only then makes anything. On the local surface the default gate allows it and every file is
   stamped "not for publication", in its content and in its name. On any other surface the
   default gate refuses, the route answers 403 with one line of text, and the page does not
   offer the links. M6's register replaces the gate's body, not this function.
8. **The picture is a PNG made in the browser from a file the server made.** The export
   function's `svg` format is one standalone drawing: every plot, the Series by name, units,
   source line, Release id, engine version, the address, and the stamp, in the light theme's
   colours on an opaque ground. "Save chart as PNG" fetches it and rasterises it on a canvas at
   twice its size. So the gate and the stamp apply to the picture exactly as to the CSV, the
   server needs no rasteriser or fonts, and the enforced CSP is unchanged (`img-src` already
   allows `data:`). With JavaScript off the link downloads the SVG.
9. **The CSV is long, not wide**: one row per Series, run and Period, with the Series' own value
   beside the value as drawn, Period bounds, units and Status. v1's was one column per series on
   an axis of months, which cannot hold a quarter, a second range or a Status. It is exactly the
   rows of the chart's table, and a test holds it to that. Lines that begin with `#` carry the
   stamp, the Release, the address and the sources (`pandas.read_csv(…, comment="#")`).
10. **"Every series as one CSV"** (v1's "All data CSV") is the same function with `format=all`:
    the whole history of every Series the gate allows, capped at 500,000 rows. It is a local
    convenience until bulk files arrive (M25).

## What it costs (production build, measured in M5)

See ADR 0014's M5 amendment for script size. A view of eight Series with a second range, marks
and relationships is drawn in about the same time as before plus the relationships (a few
milliseconds: at most 28 pairs, 49 lags and one rolling line); `explorer2.test.ts` holds a warm
draw under 1.5 s. The tables behind the scatter and the rolling line are sent only with
`table=1`, as the chart's table is.

## Considered options

- **Compute statistics in the browser, as v1 did.** No round trip for a lag slider, but a second
  home for the arithmetic and state the address would have to mirror. The lag is a number field
  and a table of links instead of a slider; each change is one server draw.
- **Sample the faster Series at the slower Period's last month** instead of using `agg`. Simpler,
  but it silently treats a flow and a mean as a level.
- **Relabel the axis "+N months"** for a second range, as v1. The figure module's time axis is
  dates everywhere; a second kind of axis for one feature would be a second renderer.
- **Rasterise on the server.** Needs a rasteriser and fonts in the image, for the same picture.
- **A wide CSV like v1's.** Familiar in a spreadsheet, but it would have to invent rows for
  Series that are not monthly.

## Consequences

- M6 changes what `permits()` answers; exports follow without a change here. M18 adds "export
  that honours rights" per Series (today the gate answers for the whole file).
- M11's aggregation must reuse `stats.ts`'s combining of Periods and may then let a daily or
  weekly Series take part in relationships.
- `as_of`, `pin=` and saved queries are still M18's.

## Tests

`packages/core/src/stats.test.ts` (the contract, and the two caveats failing then fixed in the
history); `site/src/lib/explorer/v1-statistics.test.ts` (v1's 16 cases);
`site/src/lib/explorer/view.test.ts` and `site/src/lib/export/export.test.ts` (fixture);
`site/src/lib/legacy/explorer2.test.ts` (v1's data: two recorded compare pairs and the
statistics against v1's own `stats.js`, the CSV against the screen);
`site/tests/built/served.test.ts` (the route, and its refusal on a production build);
`site/e2e/explorer2.spec.ts` (a real browser, JavaScript on and off, 320 px to 1280 px, both
themes, the PNG's pixels).
