# Query, series pages and their twins

How a reader, a script or an agent gets the values of one Series (PLAN sections 3, 4.2, 4.5 and
7; M17; ADR 0031). This page is the contract. `site/src/lib/query` implements Query,
`site/src/lib/twin` the twins, `site/src/lib/series-page.ts` the page, and each is tested from
this text (`query/full.test.ts`, `twin/twin.test.ts`, `series-page-ii.test.tsx`,
`site/tests/built/served.test.ts`, `site/e2e/series2.spec.ts`). Words in capitals are defined in
`/CONTEXT.md`.

## The address is the question

```
/data/{key}                    the page
/data/{key}.csv                the values the page shows, long format
/data/{key}.json               the same, with Provenance, Rights and the as-of evidence
/data/{key}.md                 the page in Markdown, with the values as a table
/data/{key}.metadata.json      the Catalog's record of the Series; no value
```

All five take the same parameters and answer from the same Release with the same Query:

| Parameter | Means |
|---|---|
| `transform` | one of `lin, chg, ch1, pch, pc1, pca, log, rebase, z, drawdown` (`transforms.md`); default `lin` |
| `freq` | a frequency slower than the Series' own to bring it to first: `weekly, monthly, quarterly, annual` (`daily` and `business_daily` are accepted and are slower than nothing) |
| `agg` | how to combine, in place of the Series' declared rule: `mean, last, sum`. Only one its Measure kind allows |
| `start`, `end` | calendar dates, both inclusive |
| `as_of` | what was known before this date (00:00 in New York) or instant (`vintage-resolution.md`) |

A twin refuses a parameter it does not know, a value outside the list, or a parameter given
twice, with 400 and the list. A page lets an unknown parameter pass (links arrive with things
appended) but shows no value when a known one cannot be honoured: an answer to a question nobody
asked is never shown in its place. `pin=` is not taken yet (M18).

A renamed key answers 308 to its permanent key, question and all.

## The order of work

Resolve the Vintage, bring it to the frequency asked for, apply the Transform (PLAN 4.5). The
window is applied last, so a Transform keeps its look-back.

## What an as-of answer says

| Field (JSON) | |
|---|---|
| `basis` | the weakest Basis among the Periods the answer used; not the whole Series' (ADR 0024). Used means: the Periods shown; the Period before the first, for `chg`, `pch`, `pca`; the same Periods a year earlier, for `ch1`, `pc1`; and, for a Derived series, the Periods of each input its Recipe set those beside. A year earlier means the whole months a year earlier. Where that is not worked out exactly (a Recipe over Recipes, or an input at another frequency than the Series) the whole inputs' weakest Basis is claimed |
| `cutoff`, `capture_gap`, `same_day_release` | as `vintage-resolution.md` defines them |
| `metadata_in_force` | the unit in force at the Cutoff, whether it has changed since, and Periods still held then under other metadata |
| `left_out_periods` | Periods kept out of arithmetic because they were under other metadata. Without a Transform or a slower frequency nothing is left out; they are shown as held and named |
| each Observation | its own `basis`, `known_from`, `known_by`, `last_checked`, when the Series is answered as it is |

An unavailable answer is an answer: 200, `basis: "unavailable"`, a `reason`, and no Observation.
The page shows the Unavailable state and no value anywhere on it: no figure, no latest value, no
list of later versions. A Derived series is computed from each input's own Vintage.

## Revisions

The page lists every version a Release holds of each Period whose value or Status changed, with
the Origin's clock (published) and Macro Atlas's (first held, held until) in separate columns,
the Captures taken and the days between them with none. The latest 48 versions are listed, never part of one Period's history, and
`?revisions=all` lists every one, newest first, 5,000 to a page (`&revisions_page=2` for the next). It is today's whole history, so it is left off
an as-of view, which links to it.

## Rights

- The page asks for the Permission to **display**; `.csv`, `.json` and `.md` ask for
  **redistribute**. A Series that may be shown but not handed out has its page, and its three
  files answer 403 with the gate's reason and no value. The page then offers only the metadata
  twin and says why.
- Asking about the past (`as_of`, the revisions table) asks the gate about every Origin, dataset
  and Channel the Series' history came through as well. A refusal there leaves today's values
  alone.
- A Withheld Series has its page and its metadata twin, by name with the reason; its files of
  values are 403.
- `.metadata.json` is a fixed selection of the Catalog entry. It never holds a value, and where
  the Series may not be shown it says nothing of its coverage either.
- On the local Surface every file of values is stamped "not for publication", in its content
  and in the name a browser saves it under (CSV, JSON and Markdown alike). On a public Surface no register row is signed today, so every file of values is
  403 (PLAN 6.1).

## Text from a Release

A name, a description, a unit or a note is written into every file as text. In Markdown it is
escaped so that it cannot bring HTML, a link or an image, emphasis, a heading, a list or a table
cell with it; in CSV no
cell begins as a formula and a comment stays one line; JSON is JSON.

## Caps

| | |
|---|---|
| Observations in one answer | 50,000 |
| Versions read for one as-of answer or one vintage table | 250,000 |
| Time | 5 s for an answer and for a vintage table; one that took longer is not given (503) |
| Bytes of one twin | 8 MiB (422) |

Rate limits by address are the read API's (M24).

## Caching

A refusal is never stored. On the local Surface, and on staging, nothing is. On production a
file the gate allowed carries `Cache-Control: public, max-age=300` and an `ETag` made from its
own bytes; the gate always answers before a validator is compared. A copy may outlive a
withdrawal by up to five minutes.

## Status

`/api/v1/status`: the Release, its age, each source's outcome when the Release was made, each
Series with its last Period and whether it is past its limit (where it may be shown), and how
the writer's last run ended (a fixed selection of `STATUS.json`). `status` is, most serious
first: `degraded` (a newer Release could not be opened), `stale` (older than a day and a half),
`stale_inputs` (a fresh Release with a failed or stale source, or a Series past its limit), `ok`.

## To see it

```
make v2-dev
open http://localhost:3000/macro-atlas/data/fx_price_index?as_of=2025-12-13
curl -s 'http://localhost:3000/macro-atlas/data/fx_price_index.csv?as_of=2025-12-13'
curl -s  http://localhost:3000/macro-atlas/api/v1/status
```
