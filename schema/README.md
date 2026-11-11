# The release contract

`release.schema.json` is the contract between whatever writes a Release and everything that reads
one (PLAN 4.2). Words in capitals are defined in `/CONTEXT.md`. This is **v0**
(`schema_version` `0.1.0`): it already carries what tracks A to D need, and later milestones add
to it (vintages, locks, search, downloads) by raising the version.

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
  content/annotations.json           every Annotation, one shape
```

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
`pct_change` takes one input and `params.lag`, a whole number of the input's Periods. `order`
(aggregate before or after the arithmetic) is always stated; there is no default to guess. The
output's unit is the entry's own. Validators check structure only: the shape above, inputs exist,
no cycle, nothing shown rests on a withheld input. Only the engine in `packages/core` computes a
Recipe (ADR 0003).

**Annotations.** One shape for every layer. `category` is the layer within a kind (an Event's
category); `attributes` holds named facts a layer needs to draw itself (the party of a term of
government). There is no field for a judgment, on an Annotation or anywhere else in the contract
(ADR 0011), and unknown fields are refused.

## Rules beyond the schema

Checks run in stages and stop at the first stage that reports something.

| Stage | Code | Meaning |
|---|---|---|
| files | `unknown_file` | a file the contract does not name |
| files | `missing_file` | `manifest.json`, `catalog.json` or `content/annotations.json` is absent |
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
| rules | `unsigned_register`, `legacy_in_public`, `draft_in_public` | a public Release must name a signed rights register and hold no legacy data and no drafts |

## What this contract does not decide

**A valid Release is not thereby permitted anywhere.** The last three rules are a second line of
defence for the interim data rule (PLAN 6.1). Whether a Series may be shown or handed out on a
Surface is decided by `permits(rightsUsed, surface)` (`atlas/rights.py`,
`packages/core/src/rights.ts`) and, from M6, by the rights register. `rights_register.signed` in
a manifest records which register a writer built against; it does not authorise any Series by
itself, and a writer may set it only as M9 specifies. The fixture sets it because every value in
the fixture is invented by this project.
