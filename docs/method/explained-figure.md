# The explained figure

An **Explained figure** is a chart that carries its own Takeaway, its unit in words, its source
line, a note on how to read it, the same data as a table and a door into the Explorer
(`CONTEXT.md`). This page is the contract for it. The `figure` module
(`site/src/lib/figure/`, `renderFigure(spec, series)`) implements it and is tested from this
text. How it is laid out at different widths is ADR 0017; how it looks is `DESIGN.md`.

Nothing here evaluates. The figure's own words are labels, the fixed sentences below, and the
Catalog's own text.

## How a Series is drawn

Decided by the Catalog entry, never by how dense the data looks.

| The Series is | Drawn as |
|---|---|
| held (`continuity: held`) | steps: a value stands from its Observation to the next, and the last one until the day the Release was made. A missing or suppressed Observation ends the hold |
| discrete; daily, business daily, weekly or monthly | a line through the Observations, broken wherever one has no value. A value with no neighbour on either side is a point |
| discrete; quarterly, annual or irregular | points only, one per Observation, not joined |

Every Observation is placed at the **start of its Period**. Nothing is filled, interpolated or
carried forward. Series in different units are never put on one axis: each unit gets its own
plot. The vertical axis is fitted to the data; when it does not start at zero, "How to read
this" says so, with the two ends. Tick labels are written in the shortest form in which every
tick reads differently from its neighbours (compact, then plain, then exponent), so a narrow
range far from zero is never flattened into one repeated label.

## Data states

Each state has a mark and a word, shown together; colour never carries a state. Marks are hollow
and in ink, so they cannot be taken for a Series' own filled symbol.

| State | Word | Mark | Where it comes from |
|---|---|---|---|
| preliminary | Preliminary | hollow circle | the Observation's Status |
| revised | Revised | hollow square | the Observation's Status |
| estimate | Estimate | hollow diamond | the Observation's Status |
| projected | Projected | cross | the Observation's Status |
| partial | Partial period | half-filled circle | the Observation's Status |
| stale | Stale | hollow triangle | computed: the last value's `period_end` plus the Catalog's `max_lag` is before the day the Release was made (`staleness()` in `packages/core`). With no `max_lag` recorded a Series is never called stale |
| missing | Missing | dashed bar | an Observation with no value |
| break | Break | dashed upright line | the Catalog's `breaks` |
| withheld | Withheld | barred circle | the manifest's `withheld` list; the reason is given and no value appears |

`suppressed` is a Status, not one of the nine Data states: a value the Origin holds back. It has
its own word (Suppressed) and mark (a solid bar), because it is neither merely missing nor
Withheld. A Series the rights gate refuses on this Surface is named like a withheld one, with the
words "Not shown here" and the gate's reason.

In the drawing a status mark sits on its Observation; where several in a row share a state, the
mark is on the first and the last of the run, and the line under the drawing gives the span
("2020 Q1 to 2024 Q4 (20 periods)"). Gaps are bars along the baseline. A break is a dashed line
at the Period from which the new basis applies. The stale mark sits on the last value. The same
states are named under the drawing and in the table's State column: a status on its own row, a
break on the first row of the new basis, stale on the row of the last value.

A break is dated by **its own Period label**, whether or not the Series has an Observation
there: a break in January 2023 separates an election in 2020 from one in 2024. A label that
cannot be dated at all is treated as lying between any two values, so it can only cause silence.

## The Takeaway

One sentence from a fixed template. The only words it can add to the figures are "up from",
"down from", "unchanged from", "higher than" and "lower than".

"The latest" is the **last Observation the Series holds**, with or without a value: an older
value is never passed off as the latest.

| | Template | Used when |
|---|---|---|
| T1 | *{Name} was {value} in {period}, up from / down from / unchanged from {value} in {period}.* | the default: against the Observation immediately before |
| T2 | *{Name} was {value} in {period}, {x}% higher / lower than a year earlier.* | an index, a currency amount, a count or a physical quantity, monthly, quarterly or annual, where both values are above zero. The percentage is the engine's `pc1` (`docs/method/transforms.md`) |
| T3 | *{Name} was {value} in {period}.* | the Observation before has no value: no comparison is made across a gap |
| T4 | *In {period}, {Name} was {value} and {Name} was {value}.* | two or more Series that are comparable |

A unit that is a bare percent sign is attached to the value ("4.3%"); any other unit follows in
brackets. Values in one sentence carry the same number of decimals. A day-dated Series says "on",
others "in".

### Silence

A figure has no sentence when one would mislead. The reason is printed where the sentence would
be, in words.

| Rule | A figure is silent when |
|---|---|
| partial | either value the sentence would use is for a partial Period |
| stale | the Series is stale in this Release |
| estimate, projected | either value the sentence would use is an estimate or a projection |
| break | a break lies after the earlier value and up to the latest (for T2, anywhere in the year) |
| non-comparable | two or more Series differ in unit, frequency, representation, kind of measure, kind of unit, seasonal adjustment, price basis, country or latest Period, **or** one of those facts is not recorded for them: what is not recorded is never assumed to be the same |
| missing, no values | the latest Period has no value, or the Series has none |

A preliminary or revised latest value keeps its sentence; the source line names the status.

## The lines under the drawing

- **Unit line:** the unit, then seasonal adjustment and price basis where recorded, then the
  cadence, then "v1's rounded output" for the legacy representation.
- **State line:** each state present, with its mark, its word and the Periods.
- **Source line:** `Source: {origin}, {how obtained} · data to {period} · {when obtained} ·
  {status of the latest value}`. Origin and Channel are both named and never merged. For v1's
  series the origin reads "origin not recorded by v1", with the FRED id or Yahoo symbol.

## The table

Every Observation is a row, in Period order, gaps included, with its state. A value is shown with
the fewest decimals that hold every value of the Series exactly. If that would take more than
six, values are shown to six places, the caption says so, and the exact value is in the cell's
`<data value>`. A value smaller than one millionth is written in full, in exponent form.
