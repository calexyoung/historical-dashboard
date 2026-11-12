# Vintage resolution

How Macro Atlas answers "what did the data say before this date?" (PLAN 4.5 and M10; ADR 0005,
ADR 0022, ADR 0024). This page is the contract; `packages/core` implements it (`resolve()` in
`src/vintage.ts`) and is tested from this text (`src/vintage.test.ts`). Words in capitals are
defined in `/CONTEXT.md`.

`semantics_version`: **0.6.0** (0.5.0, M10: vintage resolution added; no Transform or statistic changed. 0.6.0, M11: Recipes resolve each input with these rules, `docs/method/transforms.md`; nothing here changed).

## The question and the answer

`resolve(series, asOf, release)` takes one Series as a Release holds it (its own Observations
and, when the Release has one, `vintages/{key}.json`) and a question:

| `asOf` | Means |
|---|---|
| `2026-06-10` | before 00:00 in New York on that date |
| `2026-06-10T18:00:00Z` | before that instant (UTC, written as a Release writes an instant) |
| `null` | no as-of question: the Release's own state, with no Basis |

It returns a **VintageAnswer**: the Observations that were known before the Cutoff, each with
its own Basis, and

| Field | Meaning |
|---|---|
| `basis` | The weakest Basis among the Observations: `provider`, `atlas_observed`, `legacy`, `uncertain` or `unavailable`, strongest first |
| `reason` | Why an answer is unavailable (below) |
| `cutoff` | The instant, the New York day it falls on, and whether the question named a day or an instant |
| `capture_gap` | The last Capture before the Cutoff, the next one, the whole days between that were not seen, and whether the next one found a change |
| `same_day_release` | A version is dated to the Cutoff's own day |
| `metadata` | The metadata in force at the Cutoff |
| `release_id`, `semantics_version` | Echoed in every answer |

**An unavailable answer holds no Observation.** It is never filled with today's figures.

## The Cutoff

A value counts only if it was public **strictly before** the Cutoff. For a date the Cutoff is
00:00 America/New_York on that date, so nothing published on the day itself counts. For an
instant it is that instant. (PLAN 4.5; D7 is open with Alex and this is its recommended default.)

Instants are ordered exactly as written, to the nanosecond a Release may carry: a Capture one
microsecond before the Cutoff is before it.

A version dated only to the day cannot be placed against an hour. It counts only when its day
is earlier than the Cutoff's New York day, whatever time the question named.

## Two clocks, never mixed

A version of an Observation can be dated two ways.

- **The Origin's clock.** `provider_from` is when the Origin published the version, taken from
  the Origin or an archive of its releases, to the minute or to the day (`provider_precision`).
  `provider_coverage` is the span over which that record is known to be complete.
- **Macro Atlas's clock.** `recorded_from` and `recorded_to` are the retrieval times of the
  Captures that first held the version and that replaced it. They show a value was public no
  later than a time; they cannot show when it was first reported.

A retrieval time is an upper bound on a publication time, so the two are not comparable and one
answer never uses both.

1. **Inside the Origin's record** (`provider_coverage.from` ≤ Cutoff ≤ `provider_coverage.to`)
   only versions the Origin dated take part. The version in force for a Period is the one
   published before the Cutoff and not superseded before it. Basis: `provider`. A version Macro
   Atlas merely held is left out, even one it held earlier than it learned of the Origin's.
2. **Otherwise**, the answer is what Macro Atlas held just before the Cutoff: for each Period
   the version with `recorded_from` before the Cutoff and not replaced before it. Every version
   takes part, including those the Origin dated. Basis: `atlas_observed` or `uncertain` (below).
3. **Before both** (no Capture before the Cutoff and the Cutoff outside the Origin's record):
   `unavailable`, reason `no_coverage`.

A Period whose version in force is a Tombstone is absent. Between the first and the last Period
of an answer every Period is present, as in a Release's own file: one with no version in force
is an explicit `missing` Observation with no Basis.

An answer on the Origin's clock can hold no Observation and still be a `provider` answer: on the
morning of a first release the complete record says nothing had been published.

## The Capture gap, and `uncertain`

On Macro Atlas's clock an answer rests on the last Capture before the Cutoff. If one or more
whole New York days lie between that Capture's day and the Cutoff's day, the figure could have
changed on a day nobody looked, and the answer is `uncertain`.

- `missed_days` counts those days: after the last Capture's day, before the Cutoff's day.
- **A Capture vouches only for the Periods it asked about** (its `scope`; ADR 0022, point 5).
  Each Observation is judged against the last Capture before the Cutoff whose scope holds its
  whole Period (`last_checked`), so an old Period that has slid out of a source's window is
  `uncertain` while recent ones are `atlas_observed`. The answer's `basis` is the weakest.
- The answer stays `uncertain` even when the next Capture found nothing changed.
  `changed_across` reports what that Capture found, for the Periods it asked about, and
  upgrades nothing.

What this does not do: it knows no schedule. A day counts as seen if any Capture was taken on
it, so a failed second run on a day with a first one is not a gap, and a weekend is one unless
the job ran. That matches how the capture job reports missed days (`docs/method/capture.md`).

## The same-day flag

`same_day_release` is true when a version is dated to the Cutoff's own New York day: the
claimant may or may not have seen it. On the Origin's clock that is a version published that
day. On Macro Atlas's clock it is also a version first held that day, except

- what the Series' first Capture found (that is when Macro Atlas began to watch, not a release);
- a version that restates the one before it under new metadata (same value, same Status).

The flag is set whether or not the version counts toward the answer.

A question about a date before 1900 has no Cutoff (`bad_as_of`): New York's clock is taken as
four or five hours behind UTC, which holds from 1883, and no record here reaches back so far.

## Metadata in force

A change of unit, definition, adjustment, Source or Rights is a Revision (ADR 0005). The answer
reports the metadata in force at the Cutoff, not today's:

- on Macro Atlas's clock, the last line of the metadata history recorded before the Cutoff, with
  `in_force_from`, whether it `differs_from_current`, and `other_metadata_periods`: Periods in
  the answer whose version was recorded under other metadata, because no Capture has asked
  about them since the change (ADR 0022, point 7);
- on the Origin's clock, the metadata the versions in the answer were recorded under, if they
  share one, with no `in_force_from`: the record does not say since when. Otherwise none.

`metadata.rights` is what the rights register said of the Origin when the bytes were fetched.
It is a record of that day and authorises nothing.

## Legacy Series

v1's output is one state, rounded, with one date: when v1 generated it
(`manifest.inputs[].generated`). A legacy Series answers

- `legacy`, with the Release's Observations, for a Cutoff after that instant;
- `unavailable` (`legacy_held_after_cutoff`) for any Cutoff at or before it;
- `unavailable` (`legacy_not_dated`) when the Release does not say when that was.

## Unavailable, and why

| `reason` | |
|---|---|
| `bad_as_of` | The question is not a calendar date or an instant |
| `no_vintages` | The Release holds no vintage file for the Series (this includes every Derived series until M11) |
| `no_coverage` | The Cutoff is before the first Capture and outside the Origin's record |
| `legacy_not_dated`, `legacy_held_after_cutoff` | As above |

## The weakest Basis

`BASES` lists the five strongest first and `weakestBasis()` picks the weakest of several. An
answer built from several Series (a Recipe, M11) or from a few Periods of one (a Measure, M20)
claims the weakest Basis among what it used.

## Where the rows come from

`vintages/{key}.json` in a Release (`schema/README.md`): the versions, the metadata history and
the Captures of one stored Series, written by the release writer from the vintage store
(`docs/method/release-writer.md`). The site's reader opens them with the Release, and
`asOf(release, key, date)` in `site/src/lib/release/as-of.ts` hands `resolve()` its input.

No adapter dates a version by the Origin's clock yet, so every real answer today would be
Atlas-observed, uncertain or unavailable. The `provider` path is exercised by the fixture
release and arrives for real data with provider vintages (M30).

## To see it

```
node scripts/as-of.mjs fx_price_index 2025-12-13          the fixture: a day inside its Capture gap
node scripts/as-of.mjs fx_output_quarterly 2025-11-28     the fixture: the Origin's own record
node scripts/as-of.mjs unrate 2026-11-20 --root var/local v1's data after `make v2`: legacy
```
