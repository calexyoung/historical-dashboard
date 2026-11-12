# The Catalog

The Catalog is the list of every Series Macro Atlas knows about (CONTEXT.md). Since M12 it is
one file per Series, `catalog/series/{key}.json`, each valid against
`schema/series.schema.json`. The decisions behind it are in ADR 0026. Words in capitals are
defined in `/CONTEXT.md`.

```
python -m atlas check                    validate the Catalog in four layers
python -m atlas add series KEY ...       write a draft Series file
python -m atlas catalog                  what is proposed for every Series, and the gate's answer today
python -m atlas catalog --list           the same, one line per Series
python -m atlas catalog --write          regenerate docs/v2/catalog-migration.md, v1-coverage.md and g20-coverage.md
```

None of these fetches anything or writes outside the repository's own files.

## What a Series file says

| Field | Meaning |
|---|---|
| `key` | Permanent. Also the file's name. A key's definition does not change; a different quantity takes a new key |
| `name`, `unit`, `seasonal_adjustment` | The declared metadata the vintage store records as history |
| `unit_kind`, `measure_kind`, `agg` | What kind of number it is and how finer Periods may be combined (`none`: never) |
| `freq`, `continuity` | Native frequency; whether a value stands until the next one |
| `price_basis`, `base_period` | Nominal or real, and the base of an index or of real prices |
| `country`, `segment`, `topics` | ISO alpha-3 or a group code (EA, EU, G20, WLD); one of the six Segments; topic slugs |
| `source` | A stored Series: its Origin (producer, dataset, identifier, address) and the Channel used or proposed. An Endpoint is named only once an adapter fetches it |
| `source.channel: null` with `no_channel` | No route is known. `kind` says which: `rights_restriction`, `no_route_established`, `discontinued` |
| `recipe` | A Derived series: the operation, its ordered inputs and the order of aggregation. It has no `source`; its lineage is its inputs |
| `fallback` | Other Sources it could be taken from. Listing one clears nothing |
| `refresh`, `max_lag`, `range` | How often the Origin publishes; how old the last value may be; a sanity range |
| `status` | `draft`: declared only. `active`: captured and recorded, or computed. `retired`: no longer updated |
| `earlier_metadata`, `metadata_from` | Earlier versions of name, unit and adjustment, and when the entry's own took effect |
| `migration` | For a Series carried over from v1: what v1 took it from, how the proposed figure relates to v1's (`same`, `representation`, `different`), a note, the milestone planned |

**There is no Rights block and no Permission in a Series file.** The schema has no place for
either, at any depth. The Rights of a Series are looked up in the rights register for its
Origin and dataset each time the Catalog is read (`atlas.catalog.rights_block`); for a Derived
series they are the most restrictive status among the stored Series it rests on, with all
their owners and attributions. Whether a value may be shown is the rights gate's answer, from
a signed row (ADR 0020). Nothing typed into the Catalog can grant anything.

## Draft, active, retired

A **draft** is a declaration. Nothing is captured, replayed, computed or released for it, and
a local Release keeps v1's own Series, with v1's own provenance, for its key. 74 of the
Catalog's 188 Series are drafts today.

A stored Series becomes **active** when an adapter fetches it: its `source.channel` names the
Endpoint (an id from the rights register's capture lists) and its Origin's identifier. From
then on it is in the series table the vintage store replays (`docs/method/vintage-store.md`)
and the release writer publishes from, under the rights gate. A Derived series is active when
the engine computes it: every input must be active or retired.

A **retired** Series is no longer updated. If it was ever bound, it stays in the series table
so that its history is still replayed and shown. A Derived series that is not a draft stays
in the table too.

Changing the name, unit or adjustment of a Series that has been recorded is a revision of its
metadata. Move the old values into `earlier_metadata` (the first version has `"from": null`),
and say in `metadata_from` when the new ones take effect, written like `2026-04-01T00:00:00Z`.
Every version states all three fields.
A replay applies to each Capture the version in force when it was retrieved.

## `atlas check`

Four layers, in order. A layer runs only when every layer before it found nothing, so the
output shows a problem and never its consequences. Each error names the file. Exit 1 on any.

| Layer | Fails when |
|---|---|
| **schema** | A file is not strict JSON (a name given twice is refused), is not a valid Series, or is not named for its key. This is where a typed Rights block or Permission is refused |
| **references** | A Recipe takes a key that is not in the Catalog. An alias is another Series' key or another's alias. A Series is bound to an Endpoint the register does not list; or one on another Origin's row; or one that does not fetch its dataset, uses another adapter or Channel, or does not ask for its identifier (a BLS series, a value field of a Treasury table, a column of a Board package, a series key of an IMF dataflow, the codes of a series in a Census flat file, a column heading of the construction workbook, a series of a hand-entered file); or an identifier of an Endpoint is bound to two Series. A Series bound to a Board package is not of the frequency the package is read at, or the Endpoint pins no unit and multiplier for its column (M13). A Series bound to an IMF endpoint is not of the frequency its key ends in, or is an index and the Endpoint pins no reference period for it (M14). A Series bound to a Census file is not monthly; a Series bound to a hand-entered file is not of the file's frequency or unit (M16). A hand-entered file under `catalog/manual` is not in its format, lacks a citation, or is read by no endpoint of the register (M16). A coverage matrix has a cell that does not fit the Catalog (below) |
| **semantics** | `agg` is not one the Measure kind allows (the engine's own table: a stock by last or mean, a flow by sum, a rate by mean, an index by mean or last, an annualized figure by mean; `none` always). The Recipes go round in a circle (the cycle is named). A Derived series is finer than an input, or takes an irregular one. A difference or sum takes inputs that are not in one unit (the engine's rule), or gives a result in another kind of unit; the difference of two percentages is not in percentage points; a percent change is not in percent. An active stored Series names no Endpoint; a Derived series that is not a draft has an input that is a draft or is not bound to an Endpoint. A range is upside down. The dated metadata versions do not start from the start or are out of order |
| **rights** | The rights register is one the gate cannot trust. A Series that is not a draft comes through an intermediary Channel that no amendment to ADR 0006 has cleared (PLAN 6.1: nothing is fetched through FRED or Yahoo). A hand-entered file is in the repository and its Origin's row is not signed for `store` and `redistribute`: a committed file is a public copy (M16) |

`python -m atlas check --v1` is v1's data check on `data/atlas.json`, which this name ran
before M12; `make check` calls it. Events and Claims add layers of their own (M19, M20).

`make v2-check` runs `atlas check` and `atlas catalog --check`, and the pytest suite holds the
committed Catalog to every layer.

## `atlas add series`

```
python -m atlas add series construction_total \
  --name "Total construction spending" --unit "millions of U.S. dollars, annual rate" \
  --unit-kind currency --measure-kind annualized --freq monthly --agg mean \
  --seasonal-adjustment saar --price-basis nominal --country USA --segment infrastructure \
  --producer "U.S. Census Bureau" --dataset "Value of Construction Put in Place"
```

It writes `catalog/series/construction_total.json` with `status: draft`, prints what the
rights register holds for the Origin (its row and whether it is signed, or that it has none),
and names the next command. It never overwrites a file, never commits and never fetches. For
a Derived series give `--recipe`, `--inputs` and, for `pct_change`, `--lag`, and no producer.
A Series with no route takes `--no-channel "why"` and `--no-channel-kind`.

## The migration table

`docs/v2/catalog-migration.md` lists every Series with what v1 took it from, the Source
proposed, and one of three proposals. It is generated (`python -m atlas catalog --write`) and
a test fails if it is stale.

| Proposal | Worked out as |
|---|---|
| **re-source from X** | The Channel is direct (or hand-entered), the Origin has a register row, and that row's *proposal* allows display |
| **needs D2** | The Channel is an intermediary; or the Origin has no register row; or its row proposes no display |
| **withheld** | `source.channel` is null; the entry's `no_channel` says why |

A Derived series takes the least favourable proposal among the stored Series it rests on.

The proposal reads what each register row proposes and never its decision, so it is advice:
signing or refusing a row changes what the gate does, and leaves the table as it was. "Still
open" lists what stands between a proposal and a live Series that the Catalog and the register
can show: no adapter yet, an identifier not settled, a representation or quantity that differs
from v1's, open questions on the register row. `python -m atlas catalog` prints, apart from
all that, how many Series the rights gate would show on production today. Today: none.

## The v1 coverage report

`docs/v2/v1-coverage.md` accounts for every series v1 showed as one of three (PLAN M16; ADR
0030). It is generated with the migration table and a test fails if it is stale.

| Class | Worked out as |
|---|---|
| **live from origin** | A stored Series that is not a draft, is bound to an Endpoint, and comes by the direct or the hand-entered Channel; or a Derived series that is not a draft and rests only on such Series |
| **live via a cleared channel** | The same, through an intermediary Channel that the register lists in `cleared_intermediaries`. A Derived series is in this class when the least direct thing it rests on is |
| **withheld** | Everything else, with the reason: the entry's own `no_channel`; an intermediary that is not cleared; an Origin with no register row; a row that proposes no display; a hand-entered file that waits for a decision; no reader yet (with the milestone planned). A Derived series gives the reason of the Series that holds it back |

"Live" says what the pipeline reads. What a public Surface shows is the rights gate's answer,
which the page prints for the day it was written. The comparison of each live Series with
v1's figures is `docs/v2/v1-overlap.md`.

## Coverage matrices

A coverage matrix says, for a set of countries and a set of indicators, which Series of the
Catalog fills each cell, or why none does. It is declared in `catalog/coverage/{name}.json`
(`schema/coverage.schema.json`); today there is one, `g20.json`: the nineteen countries of the
G20 and the euro area by seven indicators.

| A cell is | Meaning |
|---|---|
| `{"series": key}` | A Series of the row's own country |
| `{"shared": key}` | A Series of the group the row says it is a `member_of` (a euro-area country and the euro) |
| `{"none": reason, "waits_for": "M36"}` | No Series, and why. A column may carry a `default` of this kind for rows that do not fill the cell |

A `series` or `shared` cell may carry a `note`: a dated fact a reader should know, such as
where the history begins. The declaration says only which Series belongs where. Whether that
Series is captured, what is proposed for a draft and what is still open, why a withheld Series
is withheld, and what the rights gate would show today are worked out from the Catalog and the
register each time the page is written. A matrix grants nothing and holds no data.

`atlas check` holds every matrix to the Catalog. In the schema layer: the file is a valid
matrix and no two columns share a name. In the references layer: every cell is filled or its
column has a default; a cell's Series is in the Catalog and is a Series of the row's country
(shared: of the group the row is a member of, which the row must name); a Series fills one
cell of a row; no country has two rows; a row fills no column the matrix does not have.

`docs/v2/g20-coverage.md` is generated from `g20.json` (`python -m atlas catalog --write`) and
`python -m atlas catalog --check` fails when it is stale. On the page a bare key is a Series in
the pipeline, `(draft)` and `(withheld)` are the Catalog's own states, `(EA)` marks a shared
Series, and a dash is a cell with no Series; every cell that is not in the pipeline is
explained below the matrix.

## The one-off migration

`scripts/migrate_catalog.py` wrote the first 127 files from v1's `atlas/catalog.yaml` and a
hand-written table of proposals. From v1 it took the key, the name, the category, the
staleness limit, the range and which series are computed from which. It added, per key, the
Origin, the Channel proposed, the native frequency, the unit in words, the adjustment, the
price basis and the country. Identifiers it did not know well enough are null and marked "not
settled". The BLS identifiers were asked of the keyless BLS API once on 2026-11-11 (each
exists; nothing was stored). The Series files are the Catalog now and are edited directly;
the script is the record of how they were first written.
