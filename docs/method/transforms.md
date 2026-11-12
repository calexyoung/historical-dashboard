# Transforms

A **Transform** is a named, reader-chosen re-expression of a Series for viewing or testing
(`CONTEXT.md`). It does not create a new Series and it is never stored. This page is the contract
for the ten Transforms on the engine's allowlist (PLAN 4.5): v1's six scale modes, and the four
M11 added (`chg`, `ch1`, `pch`, `pca`). It is also the contract for bringing a Series to a slower
frequency and for Recipes, which produce Derived series. `packages/core` implements it
(`transform()` in `src/transform.ts`, `aggregate()` in `src/aggregate.ts`, `evaluateRecipe()` in
`src/recipe.ts`) and is tested from this text.

`semantics_version` for this contract: **0.6.0**. A change in behaviour here raises it.
(0.3.0, M4: a Series may offer only some Transforms; see "Which Transforms a Series offers".
0.4.0, M5: statistics were added to the engine, `docs/method/statistics.md`; no Transform changed.
0.5.0, M10: vintage resolution was added, `docs/method/vintage-resolution.md`; no Transform changed.
0.6.0, M11: aggregation, four Transforms and Recipes were added, and two things M2 defined
changed. They are listed under "What 0.6.0 changed".)

## The request

A Transform is asked of one Series over a **window**: two calendar dates, `from` and `to`, both
inclusive, either of which may be left open. A reader who thinks in months means the first day of
the first month to the last day of the last.

## What goes in

Observations at the Series' **native frequency**, exactly as the Release holds them. A quarterly
Series is one Observation per quarter. Nothing is spread over months, interpolated or carried
forward before a Transform runs.

### Which Observations belong to a window

- **Discrete Series** (`continuity: discrete`): an Observation belongs to the window when its
  Period **starts** inside it (`from ≤ period_start ≤ to`). So a window that opens in February
  does not include the first quarter, although the two overlap; and a window that closes in May
  includes the second quarter, which began in April. This is the rule v1 applied to quarterly and
  annual series, where every value sat on the first month of its Period.
- **Held Series** (`continuity: held`): the same, plus the Observation that is *standing* when
  the window opens: the last one that starts before `from`, counted once. If that Observation is
  missing, nothing is standing (a missing Observation ends the hold) and nothing is added.

An Observation outside the window is not in the answer. The order of the answer is Period order.

### Missing values

A missing or suppressed Observation has no value going in and none coming out. It is never
filled. Where a Transform needs a second Observation (`pc1`) and that one is missing, the answer
for that Period is empty too.

## Which Transforms a Series offers

The Catalog may list, per Series, the Transforms it offers (`allowed_transforms`). One that is
not on the list is **unavailable** for that Series (`not_offered`), whatever the window holds;
the answer names the ones that are offered. No list, or an empty one, rules nothing out: the
engine's own rules below still apply. The list is a fact about the Series, not about a window,
so that a Transform does not come and go as a reader moves the window.

The Explorer never hides this: a selected Series that does not offer the chosen Transform stays
selected and is listed as not drawn, with the reason.

How the list is made is the business of whoever writes the Catalog. The legacy converter
(`atlas legacy-release`) writes it from v1's values by one rule:

- `lin`, `z` and `chg`: always.
- `ch1`: always, except for an irregular Series.
- `pch`, `pc1`, `pca`, `log`, `rebase` and `drawdown`: only where **every** value the Series
  holds is above zero. Each of them divides by one of the Series' own values or takes its
  logarithm. On a Series that reaches zero or goes below it (a yield spread, a balance, a growth
  rate, a 0/1 flag, a vote margin) the result reads the wrong way round or means nothing: a
  percent change from a negative value has the wrong sign, and an index whose base the Series
  later crosses is not an index.
- `pc1` and `pca`: never for an irregular Series.

The release writer (`atlas release`) applies the same rule to what it publishes from the store
and to the Derived series the engine computes.

On v1's data that leaves 104 of the 126 Series with all ten, 20 with `lin`, `chg`, `ch1` and `z`,
and the two election margins (irregular) with `lin`, `chg` and `z`.

## The six Transforms v1 had

Below, *x* is an Observation's value and the *window values* are the non-missing values of the
Observations that belong to the window, in Period order.

| Name | v1's mode | Answer for each Observation in the window | Unit of the answer |
|---|---|---|---|
| `lin` | raw | *x*, unchanged | the Series' own |
| `log` | log | the natural logarithm of *x*; empty when *x* ≤ 0 | natural log of the Series' unit |
| `rebase` | rebase | 100 · *x* / *base*, where *base* is the first window value | index, base Period = 100 |
| `z` | z | (*x* − *mean*) / *sd* over the window values, *sd* being the population standard deviation (divide by *n*) | standard deviations from the window mean |
| `pc1` | yoy | 100 · (*x* / *x₋₁* − 1), where *x₋₁* is the Observation one year earlier; empty when either is missing or *x₋₁* is 0 | percent change from a year earlier |
| `drawdown` | dd | 100 · (*x* / *peak* − 1), where *peak* is the largest window value up to and including this Observation; empty when *peak* ≤ 0 | percent below the running peak |

Details that decide edge cases:

- **`rebase`** needs a base above zero. With no window value at all, or a first window value that
  is zero or negative, the Transform is **unavailable** and says why: an index on a negative base
  turns every sign around. The base Period and value are part of the answer.
- **`z`** is unavailable with no window values or when every window value is the same (*sd* = 0;
  this is asked of the values directly, since a rounded mean of identical decimals is not exact).
  The mean, *sd* and *n* are part of the answer. Each Observation counts once, whatever the
  length of its Period or of its hold.
- **`pc1`** looks back one year by counting Periods at the native frequency: 12 for monthly, 4 for
  quarterly, 1 for annual. It reads Observations from before the window, so the first year of a
  window is not empty if the Release holds the year before. It is unavailable for an irregular
  Series (there is no "one year earlier" Observation). A weekly or daily Series is brought to
  months first ("Daily and weekly Series", below). A negative *x₋₁* is computed as written; the sign of the
  answer then runs against the direction of the move, which is why `allowed_transforms` keeps
  `pc1` off Series that cross zero (above).
- **`drawdown`** starts its running peak at the first Observation in the window, the standing one
  included for a held Series.
- **`log`** is a value, not an axis setting. A chart of `log` values is drawn on a linear axis.
- A Transform that is **unavailable** has no Observations in its answer, only the reason. A
  Transform that is available may still have empty Periods, each with its reason.

Results are computed in double precision and are not rounded; rounding happens only at display.
Carried-over v1 values were already rounded by v1 (`legacy_monthly_rounded`), and a Transform of
them inherits that.

## The four that compare with an earlier Observation

FRED's names and FRED's formulas. *x₋₁* is the Observation **before** this one in the Series (not
in the window: like `pc1` they read back past the window's start). Gaps are explicit in a
Release, so for a Series with a cadence that is the previous Period, and a missing one gives an
empty answer. *x₋ᵧ* is the Observation one year earlier, counted as for `pc1`. *n* is the number
of Periods in a year: 12 for monthly, 4 for quarterly, 1 for annual.

| Name | Answer for each Observation in the window | Unit of the answer | Empty when |
|---|---|---|---|
| `chg` | *x* − *x₋₁* | the Series' own | there is no *x₋₁* (`no_earlier`) |
| `ch1` | *x* − *x₋ᵧ* | the Series' own | there is no *x₋ᵧ* (`no_year_earlier`) |
| `pch` | 100 · (*x* / *x₋₁* − 1) | percent change from the Observation before | no *x₋₁*; *x₋₁* is 0 (`zero_earlier`) |
| `pca` | 100 · ((*x* / *x₋₁*)ⁿ − 1) | percent change from the Observation before, compounded over a year | no *x₋₁*; *x₋₁* is 0 |

- An **irregular** Series has an Observation before, so `chg` and `pch` answer (the change
  from one election's margin to the next). It has no year of Periods: `ch1`, `pc1` and `pca`
  are unavailable (`frequency_not_supported`).
- The answer says what it was measured against: `ch1` and `pc1` the look-back in Periods, `pca`
  the Periods per year.

## Bringing a Series to a slower frequency

`aggregate(series, to)` answers with one Observation per Period of the slower frequency. It is
used by the Transforms that need months ("Daily and weekly Series"), by Recipes, and from M18 by
the Explorer when Series of different frequencies are combined.

**How values combine is declared, never guessed.** The Catalog gives every Series a Measure kind
and may give it an `agg`. Only these pairs exist:

| Measure kind | `agg` may be | Why |
|---|---|---|
| stock | `last` or `mean` | a level at a moment: the Period's closing level, or its average level |
| flow | `sum` | an amount over a Period adds up |
| rate | `mean` | a percentage does not add up |
| index | `mean` or `last` | as a stock |
| annualized | `mean` | already stated per year: three monthly annual rates do not sum to a quarter's |

No `agg`, or `agg: none`: the Series cannot be brought to a slower frequency
(`aggregation_not_declared`). Any other pair is an error (`aggregation_not_allowed`).

**Which Period a Period belongs to.** The slower Period that contains its **last day**. Days,
months and quarters nest; a week belongs to the month (or quarter, or year) it ends in. The
order is daily and business-daily, then weekly, monthly, quarterly, annual; only a slower
target exists (`not_slower`), an irregular Series has no Periods to combine (`no_cadence`), and
a held Series is not combined (`held`): its values stand for stretches the Observations do not
count.

**What comes out for each slower Period**, from its member Periods:

- `sum`: the sum, if **every** member has a value. A total with a hole in it is not the total,
  so one missing member leaves the Period empty.
- `mean`: the mean of the values present, if **more than half** of the members have one.
- `last`: the last value present in the Period, under the same more-than-half rule.
- Each answer carries how many members the Period has and how many had a value.
- **Status**: the least settled among the members used, in the order final, revised,
  preliminary, estimate, projected, partial.

### Partial periods

A slower Period is **partial** when the Series does not cover all of it: the Series begins
after the Period's first member, or ends before its last. Its value is still given (the sum,
mean or last value *so far*), with Status `partial`. A Period built on a partial member is
partial too.

- Working days: a month that begins or ends on a weekend is whole once its first and last
  working days are in. A holiday inside the month is a missing member, not a short month.
- Weeks: a month is whole when the Series reaches the last week that ends in it.
- A member that is present but empty still spoils a sum to date.

**A partial Period is never compared.** For `chg`, `ch1`, `pch`, `pc1` and `pca`, if this
Observation or the earlier one it is measured against has Status `partial`, the answer for the
Period is empty (`partial_period`). That holds for a Period this engine found partial and for
one the Origin marks partial. `lin` and the other Transforms show a partial value as it is, with
its Status. Month-to-date against a full month a year ago is not a year-over-year change.

### Daily and weekly Series

- `chg` and `pch` stay at the Series' own frequency: the change from the working day, or the
  week, before.
- `pc1`, `ch1` and `pca` are answered **on months**: the Series is first brought to monthly by
  its declared `agg`, and the Transform is taken on that. The answer has one Observation per
  month, and says so (`aggregated`: from which frequency, to monthly, by which method). A day
  is not compared with the same day a year earlier (calendars do not line up, and one day's
  move compounded over a year is noise).
- A daily or weekly Series that does not declare how it combines cannot be brought to months,
  and those three are unavailable for it (`aggregation_not_declared`).
- The window is applied to the months: a month belongs to it when it starts inside it.

## Recipes

A **Recipe** is the declared rule that produces a Derived series (`CONTEXT.md`): its inputs, the
operation, and the order of aggregation and arithmetic. Only the engine computes one (ADR 0003).
`evaluateRecipe(key, catalog, load, { asOf })` answers for one Derived series.

| `op` | Inputs | Answer for a Period |
|---|---|---|
| `ratio` | exactly two | `inputs[0]` / `inputs[1]`; empty when the divisor is 0 |
| `difference` | exactly two | `inputs[0]` − `inputs[1]` |
| `sum` | two or more | their sum |
| `product` | two or more | their product |
| `pct_change` | one, and `params.lag` | 100 · (*x* / *x* `lag` Periods earlier − 1); empty when that is 0 or missing |

- **The dependency closure.** An input may itself be a Derived series. The engine walks the
  inputs to the stored Series at the bottom, computes each Derived series after everything it
  rests on, and **fails on a cycle, naming it** from a Series back to itself
  (`a → b → c → a`). An input the Catalog does not know, or the Release does not hold, is a
  failure too.
- **The stated order.** The output is at the Derived series' own frequency.
  `aggregate_then_compute`: each input that is finer is first brought to that frequency by
  its own declared `agg`; then the arithmetic. `compute_then_aggregate`: the arithmetic is done
  at the inputs' frequency, which must be one and the same for all of them
  (`mixed_frequencies`), and the result is brought to the output frequency by the Derived
  series' own Measure kind and `agg`. An input slower than the output is refused
  (`input_too_coarse`): nothing is spread over finer Periods.
- **`lag` counts Periods of the frequency the arithmetic is done at**: the output's under
  `aggregate_then_compute`, the inputs' under `compute_then_aggregate`.
- **Units.** A `sum` or a `difference` needs every input in the same unit (the same unit text
  and unit kind); otherwise it is refused (`incompatible_units`). A `ratio`, a `product` and a
  `pct_change` take any. The output's unit is the Derived series' own, as the Catalog words it.
- **Periods are matched by label.** A Period for which any input has no value has none. An
  input Observation with Status `partial` gives no derived value (the rule above). A result
  that is not a finite number is empty.
- **Status**: the least settled among the Observations used.
- **A Derived series begins at its first Period with a value and ends at its last**, with every
  Period between them present, the empty ones explicit. A Recipe that gives no value at all has
  no answer (`no_values`); the release writer withholds it by name.

### As-of, Basis and Rights

- **Each stored input's Vintage is resolved on its own** (`docs/method/vintage-resolution.md`),
  with its own Basis, Cutoff, Capture gap and same-day flag, all reported per input.
- **The answer's Basis is the weakest among its inputs.** If any input is `unavailable`, so is
  the answer, and it holds no Observation: today's figures never stand in. An answer that is
  not as-of (the Release's own state, which is what `derived/{key}.json` holds) has no Basis.
- **Metadata in force.** In an as-of answer an input's unit is the one in force at the Cutoff,
  and that is the unit the rule on units judges. Periods an input still held under other
  metadata then are left out of the arithmetic and listed (`left_out_periods`).
- **Rights.** The answer carries the most restrictive Rights status among the stored Series it
  rests on, in the order `public_domain`, `cc_by`, `citation_required`, `permission_required`,
  `no_redistribution`, `unknown` (a status nobody recognises counts as `unknown`). It also
  carries the whole lineage (every Origin, dataset and Channel reached, its own included) for
  `permits()`. The status is a summary; whether anything may be shown is the gate's answer on
  the lineage.

## What 0.6.0 changed

Two things M2 defined behave differently from 0.6.0 on. Everything else is addition.

| | Before | From 0.6.0 | Why |
|---|---|---|---|
| **C1** | `pc1` on a weekly, daily or business-daily Series was unavailable (`frequency_not_supported`). | It is answered on months, if the Series declares how it combines; otherwise unavailable with `aggregation_not_declared`. | PLAN 4.5: daily year-over-year aggregates first. |
| **C2** | `pc1` compared any two Observations that had values. | It is empty (`partial_period`) when either has Status `partial`. | A Period still under way is not a full one. No Series in v1's data or the fixture has that Status, so no published answer moved. |

Also new: the Catalog's list for a Series may now name ten Transforms ("Which Transforms a
Series offers"), and the legacy converter writes the longer list. The Explorer still offers
v1's six; the other four are answered by Query and reach the Explorer with M18.

## Compared with v1

`site/src/lib/legacy/parity.test.ts` converts v1's committed output with
`atlas legacy-release` into a temporary directory, runs every one of the 126 Series through the
six Transforms v1 had over three recorded windows (`checks/v1-parity-windows.json`), and compares each
answer with what v1's own `web/stats.js` gives when driven the way v1's `app.js` drove it. Which
Observations belong to each window is worked out from v1's own list of months, not taken from
the engine. The test fails on any difference that is not one of the deliberate ones below, and
it checks each deliberate one against v1's own function applied at the Series' real cadence.

| | Where v2 differs from v1, on purpose | Why |
|---|---|---|
| **D1** | `rebase` when the first value in the window is negative: v1 divided by it; v2 is unavailable. (A zero base was already empty in v1.) | Dividing by a negative base flips every sign: a yield curve that steepened would be drawn as falling. |
| **D2** | `z` on a held Series (the two election margins): v1 repeated each result over every month it stood and took the mean and deviation over months; v2 counts each election once. | The months are not observations. A margin that stood for four years is one result, not forty-eight. |
| **D3** | `pc1` on an irregular Series (the two election margins): v1 compared each month with the month a year before on the repeated values, giving 0 except in the year after an election; v2 is unavailable. | There is no Observation one year earlier to compare with. |
| **D4** | Presidential approval is quarterly, as it was entered. v1 repeated each quarter over its three months, so a window that does not open on a quarter boundary took a part-quarter as its start, and a window that does not close on one weighted the last quarter less in `z`. v2 applies the membership rule above to quarters. | The three months were one figure. |
| **D5** | The plot fill: for a sparse series v1 repeated the last answer across the months up to the next Observation (and across months v1 had no value for). v2's answer has one row per Observation and an explicit empty row for a gap. | Drawing a step or a point at the real cadence is the figure's job (M3), not the data's. |
| **D6** | `log`: v1 passed positive values through and drew them on a logarithmic axis; v2 returns the natural logarithm. The comparison is `exp(v2) = v1`. | One meaning for `log`, the same as FRED's, wherever the answer is used (a table or a download has no axis). |

| **D7** | Which Transforms a Series offers (M4): v1 offered all six for every series. In v2 a Series that is not above zero throughout offers, of those six, only `lin` and `z`, by the Catalog's list. The comparison above is run without the list, so it still covers every Series and Transform. | A percent change, an index or a logarithm of a series that crosses zero misleads. The Explorer says which Series is not drawn and why. |

Everything else is equal to v1 to within floating-point error (a relative difference under
10⁻⁹), for every Series, Transform and window.

`site/src/lib/legacy/cpi-yoy.test.ts` does the same for the first Recipe: the engine's
`pct_change` over twelve months of v1's `cpi` agrees with v1's own `cpi_yoy` in every month to
v1's two decimals, and June 2022 is within 0.15 of the published 9.1 percent (v1 held the
seasonally adjusted index, rounded; the published figure is from the unadjusted one, and
`checks/spot.json` holds the release writer to 9.1 within 0.05 on that).
