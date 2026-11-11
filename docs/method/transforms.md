# Transforms

A **Transform** is a named, reader-chosen re-expression of a Series for viewing or testing
(`CONTEXT.md`). It does not create a new Series and it is never stored. This page is the contract
for the six Transforms the engine has now, which are v1's six scale modes; `packages/core`
implements it (`transform()` in `src/transform.ts`) and is tested from this text. The rest of the
allowlist in PLAN 4.5 (`chg`, `ch1`, `pch`, `pca`), aggregation to a coarser frequency and daily
year-over-year arrive in M11 and extend this page.

`semantics_version` for this contract: **0.3.0**. A change in behaviour here raises it.
(0.3.0, M4: a Series may offer only some Transforms; see "Which Transforms a Series offers".)

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

- `lin` and `z`: always.
- `log`, `rebase`, `pc1` and `drawdown`: only where **every** value the Series holds is above
  zero. Each of them divides by one of the Series' own values or takes its logarithm. On a
  Series that reaches zero or goes below it (a yield spread, a balance, a growth rate, a 0/1
  flag, a vote margin) the result reads the wrong way round or means nothing: a percent change
  from a negative value has the wrong sign, and an index whose base the Series later crosses is
  not an index.
- `pc1`: never for an irregular Series.

On v1's data that leaves 104 of the 126 Series with all six and 22 with `lin` and `z` only.

## The six Transforms

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
  Series (there is no "one year earlier" Observation) and, until M11, for weekly and daily ones
  (which must be aggregated first). A negative *x₋₁* is computed as written; the sign of the
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

## Compared with v1

`site/src/lib/legacy/parity.test.ts` converts v1's committed output with
`atlas legacy-release` into a temporary directory, runs every one of the 126 Series through all
six Transforms over three recorded windows (`checks/v1-parity-windows.json`), and compares each
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

| **D7** | Which Transforms a Series offers (M4): v1 offered all six for every series. In v2 a Series that is not above zero throughout offers only `lin` and `z`, by the Catalog's list. The comparison above is run without the list, so it still covers every Series and Transform. | A percent change, an index or a logarithm of a series that crosses zero misleads. The Explorer says which Series is not drawn and why. |

Everything else is equal to v1 to within floating-point error (a relative difference under
10⁻⁹), for every Series, Transform and window.
