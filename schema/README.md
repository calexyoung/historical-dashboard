# The release contract

`release.schema.json` is the contract between whatever writes a Release and everything that reads
one (PLAN 4.2). Words in capitals are defined in `/CONTEXT.md`. This is **v0**
(`schema_version` `0.5.0`; M10 added `vintages/`, M19 Events, M20 Claims, locks and latest rows, M22 the headline Series and the search index): it already carries what tracks A to D need, and later milestones add
to it (locks, search, downloads) by raising the version. A reader refuses a version it does
not know. It still reads 0.1.0, the contract before vintages: such a Release holds no
`vintages/` file, so every Release kept in a root stays readable (ADR 0024). Writers write the newest.

`series.schema.json` is a different contract: one entry of the Catalog, the file
`catalog/series/{key}.json` that a person edits (ADR 0026, `docs/method/catalog.md`). It shares
the definitions of key, frequency, Origin, Channel and Recipe with the release contract (a test
keeps the copies equal) and has no Rights block: Rights are looked up in the register. The
release writer turns Catalog entries into a Release's `catalog.json`.

`coverage.schema.json` is a third: a coverage matrix, the file `catalog/coverage/{name}.json`
(M14, `docs/method/catalog.md`). It names Series by key and holds no data and no Rights.

Three things write a Release: the committed fixture (`fixtures/public`), the legacy converter
(M2) and the real writer (M9). Two validators read the contract and must agree:

| Language | Entry point | Used by |
|---|---|---|
| Python | `atlas.release.validate_release(directory)` | the writers, `atlas check` |
| TypeScript | `validateRelease(id, files)` from `@macro-atlas/core/release` | the ReleaseReader (M1) |

Both run the shared table `checks/release-cases.json` and report the same issue codes.
TypeScript's types and its copy of the schema are generated: `npm run gen` after any change here
(CI fails if they are stale).

## Layout of a Release

```
{root}/CURRENT                       text: the promoted release id
{root}/releases/{release_id}/
  manifest.json                      profile, versions, rights register reference, one row per
                                     series file (kind, sha256, channel, rights, representation),
                                     the withheld list, the check report
  catalog.json                       every Series known, including withheld ones (by name)
  series/{key}.json                  stored Series at native frequency
  derived/{key}.json                 outputs of Recipes
  vintages/{key}.json                what was held for a stored Series over time (optional)
  content/annotations.json           every Annotation, one shape
  content/events.json                the Events, whole (0.3.0; a 0.1.0 or 0.2.0 Release has none)
  content/claims.json                the Claims, each with its locks by name (0.4.0)
  locks/{claim_id}.v{n}.lock.json    a Claim lock, as the bytes it was written as (0.4.0)
  evidence/latest.json               each locked Reading's latest Evidence row, and the drift (0.4.0)
  content/highlights.json            the headline Series of each Segment, in the Overview's order (0.5.0)
  search.json                        what a reader can search for, as words (0.5.0)
```

Beside `CURRENT` and `releases/` a root written by the release writer (M9) also holds `LOCK`,
`root.json`, `STATUS.json`, `pins.json`, `withdrawn.json`, `trash/` and `.staging/`. They are the
writer's own (`docs/method/release-writer.md`) and no part of this contract: a reader needs only
`CURRENT` and `releases/`.

`{root}` is `$ATLAS_PUBLIC` for public-profile Releases and `$ATLAS_LOCAL` for local-profile
ones; they default to `var/public` and `var/local`, both git-ignored and outside the Docker build
context. Any other file in a release directory is an error in v0, so nothing rides along
unchecked.

## Conventions the schema cannot express

**Periods.** An Observation's `period` is a label; its shape follows the Series' native frequency.
`period_start` and `period_end` are the first and last calendar day of the Period, **both
inclusive**, with no time and no zone.

| `freq` | Label | Covers |
|---|---|---|
| `annual` | `2024` | 1 January to 31 December |
| `quarterly` | `2024-Q1` | calendar quarters |
| `monthly` | `2024-02` | the calendar month |
| `weekly` | `2024-W03` | the ISO 8601 week, Monday to Sunday; the year is the ISO week-year |
| `daily` | `2024-02-29` | every calendar day |
| `business_daily` | `2024-03-01` | Monday to Friday; a holiday is an explicit missing Observation |
| `irregular` | `2024-11-05` | one day; no cadence (for example one Observation per election) |

A Series whose year does not follow the calendar (a fiscal year) is not expressible in v0.

The calendar runs from 0001-01-01 to 9999-12-31. A Period that does not lie wholly inside it does
not exist, and the last Period of each frequency has no successor. `checks/period-cases.json`
pins the arithmetic down for both languages.

**Instants** (`created`, a source's `fetched`, an input's `generated`) are written exactly as
`YYYY-MM-DDTHH:MM:SS`, an optional fraction, then `Z`: UTC only, capital `T` and `Z`, no leap
seconds. A time that is not known is `null`, never a stand-in.

**Strict JSON.** Numbers are finite doubles: a literal too large to be one (`1e400`) is refused.
An object that names a key twice is refused, because JSON leaves the result undefined and two
readers could see different values. Both are `invalid_json`, in either language.

**Gaps are explicit.** Between a file's bounds every Period at the native frequency is present.
A Period with no value is an Observation with `value: null` and `status: "missing"` (or
`"suppressed"`); leaving the Period out is an error (`implicit_gap`). A "sparse" Series is simply
one with a slow native frequency: a quarterly Series has one Observation per quarter and is never
spread over months. Irregular Series are exempt, since they have no cadence to leave a gap in.

**Held Series.** `continuity: "held"` means a value stands from its Period until the next
Observation, and is drawn as a step (an election result, a policy rate target). A missing
Observation ends the hold. The last value stands until the Release's `created` date.
`continuity: "discrete"` means each Observation describes its own Period only: nothing is drawn or
computed between Observations that the data does not contain.

**Staleness has a fixed clock.** `max_lag` (such as `P3M`) is how far the last Observation's
`period_end` may trail the manifest's `created`. A Release is immutable, so whether a Series was
stale *in that Release* never changes; how old the Release itself is, is a separate fact the site
reports.

**Representation.** `native` values are unrounded, at native frequency. `legacy_monthly_rounded`
marks whole Series carried over from v1's output; the two are never mixed in one Series and the
legacy one never appears in a public Release.

**Hashes.** A manifest row's `sha256` is the hash of the file's exact bytes. `state_hash` is the
writer's hash of the normalized state (PLAN 4.3) and is opaque to readers.

**Recipes.** `recipe.inputs` is ordered. `ratio` (`inputs[0] / inputs[1]`) and `difference`
(`inputs[0] - inputs[1]`) take exactly two inputs; `sum` and `product` take two or more;
`pct_change` takes one input and `params.lag`, a whole number of Periods at the frequency the
arithmetic is done at (the Derived series' own under `aggregate_then_compute`, the input's under
`compute_then_aggregate`). `order`
(aggregate before or after the arithmetic) is always stated; there is no default to guess. The
output's unit is the entry's own. Validators check structure only: the shape above, inputs exist,
no cycle, nothing shown rests on a withheld input. Only the engine in `packages/core` computes a
Recipe (ADR 0003): the release writer has it do so in the Node step (M11, ADR 0025), and a
Derived series' file begins at its first Period with a value and ends at its last. A Derived
entry written by that step names the Origin of the first stored Series its Recipe reaches, with
the Channel `computed`, and carries the most restrictive rights status of what it rests on; the
Recipe's inputs, not that one Origin, are its lineage.

**Vintages.** `vintages/{key}.json` holds every version of every Observation of one stored
Series: `rows` in Period order, a Period's versions in the order they were recorded. A version
was held from `recorded_from` up to, not including, `recorded_to` (`null`: held now); both are
retrieval times of Captures. `deleted` marks a Tombstone. `provider_from`, `provider_to` and
`provider_precision` are set only where the Origin, or an archive of its releases, dates the
version; a day is written as that day at `00:00:00Z` with precision `date`. `provider_coverage`
is the span over which that record is known complete. `metadata` is the history of what was
declared and where the values came from, as a fixed selection of fields; its `rights` is what
the register said when the bytes were fetched and authorises nothing. `captures` are the
complete Captures recorded, oldest first, each with the `scope` it asked about; one whose
`change` is `none` is a Capture confirmation. The versions current now are exactly the Series'
own file, once that file's gaps are written out. A Series need not have a vintage file; a
legacy Series, a Derived series and a withheld Series never have one. Only the engine answers
an as-of question from it (`docs/method/vintage-resolution.md`).

**Annotations.** One shape for every layer. `category` is the layer within a kind (an Event's
category); `attributes` holds named facts a layer needs to draw itself (the party of a term of
government). There is no field for a judgment, on an Annotation or anywhere else in the contract
(ADR 0011), and unknown fields are refused. An Annotation typed in from somebody's record (a
term of government, a recession) says where from in `provenance` (0.3.0), so the rights check of
a Release can ask the gate about it; one that is v1's is never in a public-profile Release.

**Events** (0.3.0, M19; ADR 0033). `content/events.json` holds each Event whole: id, date and
its precision (a day, a month or a year), an optional end, title, category, status, topics,
related Series, its citations (each with an archived copy or the reason there is none, one or
the other) and its description. Every Event is drawn as exactly one Annotation of kind
`event`, with the id `event-{id}`, `ref: content/events/{id}.md`, the Event's title, category
and first citation, and an anchor as precise as the Event's date: a day is a date, a month or a
year is that Period, an Event with an end is a span of whole days. `related_series` is not
checked against the Release's catalog: a Release may name a Series it does not hold. A
public-profile Release holds no draft Event. `schema/event.schema.json` is the authoring form
(the front matter of `content/events/{id}.md`).

## Rules beyond the schema

**Claims** (0.4.0, M20; ADR 0011, ADR 0034; `docs/method/claims.md`). `content/claims.json`
holds each Claim as its file does, with the quote, and lists its locks, oldest first: each is
`in_release` with the hash of its file's bytes, or named without its numbers (`withdrawn`,
`not_carried`) with the reason. `locks/{claim_id}.v{n}.lock.json` is a Claim lock: the frozen
record, the Release it was computed against, the lineage of its numbers, and each Reading's
*then* and *now when checked* Evidence rows with their Window sensitivity. `evidence/latest.json`
is there exactly when a lock has a latest row: for the newest lock of each Claim whose newest
lock is in the Release, the *latest* row of every Reading and the drift entries. No shape among
these has a field for a finding, a rating or a label, and a figure's value is a number or null.
A public-profile Release holds no draft Claim, no public Claim without a lock, and no lock
computed on a local-profile Release. The hash a lock carries of itself (`lock_sha256`) is the
writer's own and is checked by `atlas check`, not here. `schema/claim.schema.json` is the
authoring form (the front matter of `content/claims/{id}.md`).

**The headline Series and the search index** (0.5.0, M22; ADR 0036). `content/highlights.json`
lists the six Segments once each, in the order of the Overview, each with Series keys that are
in this Release's `catalog.json` under that Segment, none twice. `search.json` is one entry
for every Series of the Catalog, then every Event, then every Claim, in their files' order:
`kind`, `id`, `title`, `text`, `keywords`, and `withheld: true` for a Series on the manifest's
withheld list. It must be exactly the projection `search_document` (Python) and
`searchDocument` (TypeScript) make of the Release's own files. Neither file is made from an
Observation; a description or a quote is content a person wrote.

Checks run in stages and stop at the first stage that reports something. Vintage files are
the last stage: they are judged against Series files already known to be sound.

| Stage | Code | Meaning |
|---|---|---|
| files | `unknown_file` | a file the contract does not name |
| files | `missing_file` | `manifest.json`, `catalog.json` or `content/annotations.json` is absent; or, from 0.3.0, `content/events.json`; or, from 0.4.0, `content/claims.json`; or, from 0.5.0, `content/highlights.json` or `search.json` |
| JSON | `invalid_json` | a file is not JSON |
| version | `unsupported_schema_version` | the reader does not know this `schema_version` |
| schema | `schema` | a file breaks `release.schema.json` |
| rules | `release_id_mismatch` | `release_id` is not the directory name |
| rules | `duplicate_key` | two catalog entries share a key |
| rules | `withheld_unknown` | a withheld key is not in the catalog |
| rules | `withheld_present` | a withheld Series has a file or a manifest row |
| rules | `orphan_series_file` | a file whose key is not in the catalog |
| rules | `misplaced_series_file` | a derived Series in `series/`, or a stored one in `derived/` |
| rules | `missing_series_file` | a catalog entry that is not withheld has no file |
| rules | `missing_manifest_row`, `orphan_manifest_row` | files and manifest rows do not match one to one |
| rules | `hash_mismatch` | a file's bytes do not match the manifest |
| rules | `manifest_mismatch` | a manifest row disagrees with the catalog or the file's folder |
| rules | `series_mismatch` | a file's key, frequency or representation disagrees with the catalog |
| rules | `bad_period` | a label does not fit the frequency, or the dates are not that Period's |
| rules | `unordered_periods` | Observations out of order, or a Period twice |
| rules | `implicit_gap` | a Period left out between the bounds |
| rules | `bounds_mismatch` | the file's bounds are not its first and last Observation |
| rules | `unknown_recipe_input`, `recipe_cycle`, `withheld_input` | Recipe structure |
| rules | `duplicate_annotation_id`, `unknown_series_ref`, `bad_anchor` | Annotations |
| rules | `duplicate_event_id`, `bad_event_date` | two Events share an id; an Event's date or end is not a day, month or year of the calendar as its precision says, or it ends before it starts |
| rules | `event_projection` | an Event has no Annotation, or its Annotation does not say what it says; an Annotation of kind `event` is the projection of no Event |
| rules | `duplicate_claim_id` | two Claims share an id |
| rules | `claim_lock` | a lock file that no Claim lists, is not named for what it holds, or is not the bytes or the record the Claim lists; a Claim whose locks are not listed whole from 1, or that lists one as in the Release when it is not (or the other way round); a public Claim with no lock; a lock computed on a local-profile Release in a public one |
| rules | `claim_evidence` | `evidence/latest.json` is not exactly the newest in-release lock of each Claim, once each, with that lock's Readings in order; or it is missing, or there with nothing in it |
| rules | `highlights` | `content/highlights.json` does not list the six Segments in order, or names a key that is not in the Catalog, is under another Segment, or is listed twice |
| rules | `search_projection` | `search.json` is not the projection of the Release's own Catalog, withheld list, Events and Claims |
| rules | `unsigned_register`, `legacy_in_public`, `draft_in_public` | a public Release must name a signed rights register and hold no legacy data (a Series, or an Annotation that is v1's) and no drafts (a Series, an Event or a Claim) |
| vintages | `orphan_vintage_file` | a vintage file for a key with no file under `series/` |
| vintages | `withheld_present` | a withheld Series has a vintage file |
| vintages | `manifest_mismatch`, `hash_mismatch` | a vintage file and the manifest's `vintages_sha256` do not match one to one, or the bytes differ |
| vintages | `vintage_mismatch` | the file is not for that Series (key, frequency, a legacy Series); a version's dates are not its Period's; versions out of Period order, two held at once, or two current; a provider time without precision or the other way round; a version that names metadata the file lacks or a Channel that is not its metadata's; two different metadata under one hash; a version held from or to a time that is no Capture's, or before the metadata it names was recorded; two versions the Origin dated in force at once; Captures or metadata not oldest first; a scope or coverage that ends before it begins; the versions current now are not the Series' own file |

## What this contract does not decide

**A valid Release is not thereby permitted anywhere.** The last three rules are a second line of
defence for the interim data rule (PLAN 6.1). Whether a Series may be shown or handed out on a
Surface is decided by `permits(rightsUsed, surface)` (`atlas/rights.py`,
`packages/core/src/rights.ts`) over the rights register (`schema/rights-register.json`, ADR 0020). `rights_register.signed` in
a manifest records which register a writer built against; it does not authorise any Series by
itself. The release writer (M9) sets it true only when that register can be trusted and permits
every Series the Release publishes for display on production (ADR 0023). The fixture sets it because every value in
the fixture is invented by this project.
