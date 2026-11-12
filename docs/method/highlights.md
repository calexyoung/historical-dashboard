# The change over one, five and ten years

How Macro Atlas works out the figures of Highlights and of the Overview (CONTEXT.md: Highlights,
Overview). This is the contract for `changeOver` and `shownChange` in
`packages/core/src/highlights.ts`, which are tested from this text, and for what a page prints
of their answers (`site/src/lib/figure/change-strip.ts`).

`semantics_version`: **0.8.0** (0.8.0, M22: the change over a number of years added. It is the
comparison `ch1` and `pc1` already make, asked at the latest Period and at a lag of N years; no
Transform, aggregation, statistic, as-of rule or Measure changed, and the other method notes
stand as they are at 0.7.0).

## What is compared

The **latest value** of a Series, set beside the value of **the same Period N years earlier**,
for N = 1, 5 and 10.

1. **The latest value** is the last Observation that has a value. A later Period that has no
   value is not the latest; the page that shows a figure names the Period it is for.
2. **"N years earlier" is a Period, found by the calendar**: the same month of the earlier year
   for a monthly Series, the same quarter for a quarterly one, the year N before for an annual
   one. It is never the nearest Period that happens to have a value. If the Series holds no
   Observation for that Period (it does not go back that far), or holds one with no value, there
   is no figure and the reason is given: `no_observation_earlier`, `no_value_earlier`.
3. **The frequency.** A monthly, quarterly or annual Series is compared at its own frequency. A
   daily, business-daily or weekly Series is first brought to months by its own declared rule
   (`docs/method/transforms.md`, aggregation), exactly as `pc1` does, and the answer says so
   (`aggregated`). A Series with no declared rule, or whose values may not be combined, is not
   compared; nothing is guessed. An irregular Series has no Period a number of years earlier
   and is not compared.
4. **A partial Period is compared with nothing**, on either side (`partial_period`): its value
   covers only part of its Period.

## The figures

For each N the answer holds the two Observations and:

- **the change**: the latest value less the earlier one, in the Series' own unit;
- **the percent change**: the change as a percent of the earlier value, `100 × change /
  earlier`. Only where the earlier value is above zero: from zero there is none, and from a
  negative value it would read the wrong way round (`start_not_positive`). A percent that is
  not a finite number is not given (`not_finite`).

For N = 1 these are `ch1` and `pc1` at the latest Period, to the last digit.

## Which figure a page shows

One figure per cell, chosen by the unit the Series' values are in (`shownChange`):

| The Series is measured in | The figure shown | Written |
|---|---|---|
| percent, or percentage points | the change, in **percentage points** | `−0.2 pts`, "0.2 points lower than a year earlier" |
| anything else, earlier value above zero | the **percent change** | `+5.2%`, "5.2% higher than a year earlier" |
| anything else, earlier value zero or below | the change in the Series' **own unit** | `+4`, "4 higher than a year earlier" |

A percent of a percent is never shown: an unemployment rate that goes from 4.0 to 4.2 moved by
0.2 points, not by 5%.

Rounding is for reading only. A percent change has one decimal (two when it is below 0.05 and
not zero). A change in points or in the Series' own unit has as many decimals as the two values
are read with, and at least one for points. A figure that rounds to nothing has no sign.

## What a page does not print

These are presentation rules, the Takeaway's own (`docs/method/explained-figure.md`), applied
to a cell. The engine's answer is unchanged; the page names the Data state where the figure
would be, as a mark and a word.

| | The cell shows |
|---|---|
| either Period is a partial period | Partial period |
| either value is an estimate | Estimate |
| either value is a projection | Projected: a projection is never shown as an observation |
| the earlier Period has no value | Missing |
| the Catalog records a break after the first day of the earlier Period, up to the last day of the latest (a break dated inside either Period counts) | Break: the two values are on different bases |
| the Series does not go back to the earlier Period | "No data" and the Period |

A **preliminary** or **revised** value is a figure its origin published. It is compared, and the
state is marked beside the latest value. A **stale** Series keeps its figures, which are those
of the Periods named, and its latest value is marked Stale.

The words describe and never evaluate: "higher than", "lower than", "unchanged from". There is
no colour for up or down and no arrow: unemployment going up is not "good" or "bad" here.

## Doors

Every cell opens the Explorer at the window it compares across: from the first month of the
earlier Period to the last month of the latest one, with `freq=monthly` when the comparison was
made at months. A cell with no figure is a door too, where the earlier Period can be dated.

## Withheld

A Series the rights gate holds back is asked for like any other, through Query, and is refused
before any value is read. Its row holds its name and the reason: no value, no Period, no window
and no drawing.
