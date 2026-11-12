# The legacy release

`python -m atlas legacy-release` (or `make v2`, which also starts the site) converts v1's
committed output into one **local-profile Release** under `$ATLAS_LOCAL` (default `var/local`,
git-ignored). It lets the v2 site be used on v1's data while the agency sources are built. It is
governed by the interim data rule (PLAN 6.1) and by ADR 0016.

## What it reads, and what it never does

| Reads, in place | For |
|---|---|
| `data/atlas.json` | 123 series as v1 built them, and v1's own `generated` time |
| `atlas/catalog.yaml` | units, aggregation, staleness limits, ranges, which series v1 computed |
| `atlas/events.yaml` | 83 events |
| `atlas/politics.yaml` | votes for the two election margins; governance bands |
| `atlas/approval.yaml` | presidential approval by quarter; presidential terms |

It fetches nothing and imports no network library. It writes only under `$ATLAS_LOCAL`, and
refuses a root that is, holds or lies inside `$ATLAS_PUBLIC` or `$ATLAS_STORE` (links resolved).
It has no option for another Profile, and promotion refuses a Release whose Profile is not the
one its root is for. The Release goes through the staging helper (`atlas/staging.py`): built in
`.staging/`, validated against the contract, renamed into `releases/`, then `CURRENT` is replaced
in one step.

## What each Series keeps

| | In the Release |
|---|---|
| Key, name, unit, note | v1's, unchanged (the note becomes the description) |
| Values | v1's, unchanged: already rounded by v1 (2 places for percentages, 3 otherwise) |
| Representation | `legacy_monthly_rounded`, for every Series |
| Cadence | v1's `M`, `W` and `D` series are monthly (v1 had already taken the monthly mean or close); `Q` is quarterly (`2024-Q1`, from v1's `2024-01`); `A` is annual; the election margins are irregular, one Observation on each election day, and **held**; approval is quarterly, as it was entered (v1 repeated each quarter over three months) |
| Gaps | a month, quarter or year v1 left out is an explicit missing Observation |
| Channel | `fred`, `yahoo`, `direct` (Eurostat, ONS, OECD), `hand_entered`, or `computed` (gold in euros), read from what `atlas.json` says was actually used |
| Origin | the FRED series id or Yahoo symbol; the producing agency reads "Not recorded by v1" |
| Rights | status `unknown`, not reviewed: nothing is settled (decision D2) |
| Lineage | v1's computed series carry a Recipe naming their inputs (ADR 0016) |
| Segment, measure kind | v2's words, assigned by fixed tables in `atlas/legacy.py`; v1's own category is kept as a topic |

Annotations: presidential terms and v1's five band sets as governance spans at v1's month
resolution; recessions as spans read from v1's 0/1 recession series. Each is marked as v1's
(`provenance.representation: legacy_monthly_rounded`), which no public-profile Release may hold.

Events are no longer the converter's (M19, ADR 0033). v1's 83 are files (`content/events`), and
the content compiler projects them, drafts included, with the ids the converter gave them
before. `atlas/events.yaml` is v1's own and is not read here; the manifest records
`content/events` among the inputs instead.

The manifest records each input's path, hash and commit, the conversion time as `created`, and
`atlas.json`'s own `generated` time separately.

## Where it may be seen

On the local Surface only. A build for a public Surface refuses a local-profile Release and
answers 503 on every path (ADR 0015). Every page of a legacy Release carries the strip
"Local build · v1 data via FRED and Yahoo · not for publication".
