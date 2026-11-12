# Statistics

How two Series moved together over a window: Pearson's r, r at a range of lags, and r over a
rolling window. This page is the contract; `packages/core` implements it (`src/stats.ts`) and is
tested from this text (`src/stats.test.ts`). The Explorer's Relationships panel
(`site/src/lib/explorer/relationships.ts`) is the only reader of it so far.

`semantics_version`: **0.5.0** (0.4.0, M5: statistics added; 0.5.0, M10: vintage resolution
added, `docs/method/vintage-resolution.md`. No statistic changed).

**Statistics here are descriptive** (PLAN 4.5). A correlation says how two Series moved together
in one window. It does not say that one moved the other, and the page never calls one
significant, strong or weak. There is no p-value, no significance star and no test (see S1).

## Two Series on one axis: `pairFrame(a, b, basis, window)`

Everything starts by putting two Series on one axis of Periods.

- **Each Series stays at its own frequency.** A pair is compared at the **slower** of the two
  (monthly, quarterly, annual). The faster Series is combined into the slower Period as its
  Catalog entry declares (`agg`): `mean`, `sum`, or `last`. `mean` and `sum` need every finer
  Period of the slower one (three months, twelve months, four quarters) to have a value; `last`
  needs the last one. A Period that is not whole has no value: nothing is made from part of a
  quarter. A Series whose `agg` is `none` or absent cannot be brought to a slower frequency, and
  the pair has no answer, with that as the reason. At its own frequency nothing needs combining
  and `agg` is not asked.
- **Other cadences take no part.** A held Series (the election margins) and an irregular one have
  no Period-to-Period movement to compare. A daily or weekly Series must be brought to monthly
  first, which arrives with M11. Each is unavailable with its reason, never silently skipped.
- **Basis.** `chg` (the default): the percent change from the Period before, at the pair's
  frequency, where both Periods have a value and the earlier is not zero. `lvl`: the values
  themselves. Changes are the default because two Series that merely trend over the same years
  correlate on levels whatever connects them.
- **What counts as a value.** An Observation with a value counts unless its Status is
  `projected` or `partial`: a projection is not a measurement and part of a Period is not the
  Period. Preliminary, revised and estimated values count. No change is taken into a Period in
  which the Catalog records a break, and a slower Period with a break inside it has no value:
  the two sides are not comparable.
- **The window.** A change is taken on the whole Series first, and the window is cut afterwards,
  so the window's first Period has a change when the Period before the window has a value (as
  in v1). A Period belongs to the window by its first day, as in a Transform
  (`transforms.md`). The axis covers every Period of a stated window whether or not either
  Series reaches it, so that a Period with nothing is counted as a Period with no pair.

The answer is the frequency, the list of Periods, and one value or null per Period for each
Series. Nothing is filled, interpolated or carried forward.

## `pearson(x, y, { lag, minN })`

Pearson's r over the pairs `x[i]`, `y[i + lag]` where both have a value. A positive lag asks
whether X leads Y; a lag is counted in Periods of the pair's frequency. Both ends of a pair lie
inside the window. The answer always carries `n`, the number of pairs, and the pairs themselves
with their places on the axis.

- Fewer than `minN` pairs (default 8, v1's floor; never below 3): no answer, `too_few_pairs`.
- Either side identical throughout: no answer, `no_variation`. This is asked of the values
  directly, because a sum of decimals can round the mean away from them and invent a variance.
- r is held to [−1, 1].

## `lagProfile` and `strongest`

r at every lag from −24 to +24, each with its n. `strongest` is the lag with the largest |r|; of
equals, the first from −24 upward, as v1. It is reported with the count of lags tried, because
the largest of 49 tries is larger than one try would be.

## `rollingCorrelation(x, y, { window, minN })`

r at lag 0 over the trailing `window` Periods ending at each Period, with its n; nothing before
the first full window. The Explorer offers 24 and 36 months, counted in the pair's own Periods
(8 and 12 quarters). A window shorter than the floor on pairs (two or three years, for an annual
pair) has no answer and says so.

## What a reader is shown with every figure

n; the window; the frequency the pair was compared at, and how a faster Series was combined; how
many Periods of the window had no pair; the lag, in words. And always, whether or not there is an
answer: that the figures are descriptive, what the basis does to a shared trend, that
neighbouring Periods resemble each other so n overstates the evidence, and that a lag search
and a rolling window can swing on one Period.

## Compared with v1

`site/src/lib/explorer/v1-statistics.test.ts` ports v1's 16 statistics cases
(`tests/test_stats.py`, which runs `web/stats.js`): the same inputs and expected numbers, asked
of v2's modules.

| v1 case | In v2 |
|---|---|
| 1 perfect ±1 · 2 near zero · 3 fewer than 8 pairs · 4 skips missing · 5 lag alignment | `pearson`, same numbers |
| 6 z-score, population sd · 7 z-score respects the range | `transform(…, "z")`; v2 answers for the range only, where v1 returned the whole axis with nulls |
| 8 rebase with leading gaps · 9 rebase from the first value in the range | `transform(…, "rebase")` |
| 10 year over year | `transform(…, "pc1")` |
| 11 changes, no fill | `changes` |
| 12 `fillSparse` stop rules | **Not ported** (`transforms.md`, D5). The case checks instead that a quarterly Series answers once per quarter |
| 13 `pValue`, `normCdf` | **Not ported** (S1). The case checks that the engine has neither |
| 14 `addM`, `fmtM`, `fmtN` | `nextPeriod`, `periodWords`, `together`. v1 wrote 1,234,567 as "1.23M"; v2 writes it out |
| 15 drawdown | `transform(…, "drawdown")` |
| 16 rolling correlation window | `rollingCorrelation` |

`site/src/lib/legacy/explorer2.test.ts` then compares the page with v1's own `stats.js` on v1's
data, over the recorded windows and Series in `checks/v1-compare-pairs.json`: for monthly pairs,
on changes and on levels, r and n at three lags, every lag of the lag profile and every rolling
window are v1's (to the places shown).

| | Where v2 differs from v1, on purpose | Why |
|---|---|---|
| **S1** | No p-value, no `p < 0.05` star, no "normal approximation" (v1's `pValue`). | With trending, autocorrelated Series and a search over 49 lags it misleads (PLAN 4.5). v1's own footnote said it was optimistic. |
| **S2** | v1's first caveat. `rollingCorr` took a `minN` argument and ignored it; the floor of 8 was fixed inside `pearson`. In v2 `pearson`, `lagProfile` and `rollingCorrelation` all take the floor and honour it. | The argument said one thing and the code did another. |
| **S3** | v1's second caveat. v1 took changes month over month on its axis of months, so a quarterly or annual series, never observed in two adjacent months, had no change at all and every change-based correlation with it had n = 0. v2 compares at the pair's common frequency, quarter over quarter or year over year. | A quarterly series does change; v1 could not see it. |
| **S4** | A monthly Series paired with a slower one is combined by its declared `agg`. v1 paired the slower value with the single month it was placed on (on levels) or with nothing (on changes). | The quarter's figure describes three months, not its first. |
| **S5** | Projected and partial values are left out, and no change crosses a recorded break. v1 had neither state. | They are not comparable measurements. |
| **S6** | A held Series (the election margins) takes no part. In v1 it was sparse like a quarterly one: no changes; on levels, a handful of months. | A result that stands for four years is one observation. |
| **S7** | The axis is the window. v1's `n` and its `p` counted pairs only; v2 also says how many Periods of the window had no pair. | Missingness is part of the answer (PLAN 4.5). |

Aggregation by `agg` is the piece of M11's aggregation that statistics cannot do without; it is
here now, for statistics only, and M11 extends the same function to Transforms (ADR 0019).
