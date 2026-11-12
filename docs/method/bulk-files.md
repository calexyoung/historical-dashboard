# Bulk files and discovery

How a whole Release leaves the site as files, and how a reader, a script or an agent finds
what the site holds (PLAN sections 3, 4.4 and 7; M25; ADR 0039). This page is the contract.
`atlas/publish/bulk.py` writes the files, `atlas/release.py` and `packages/core/src/release`
hold a Release to them, and `site/src/lib/downloads.ts`, `site/src/lib/twin/pages.ts` and
`site/src/lib/llms.ts` serve them. Each is tested from this text
(`tests/v2/test_publish_bulk.py`, `site/src/lib/twin/pages.test.ts`,
`site/src/lib/discovery.test.tsx`, `site/tests/built/discovery.test.ts`). Words in capitals
are defined in `/CONTEXT.md`.

## The files

A public-profile Release holds, under `downloads/`:

```
observations.parquet            every Observation of every Series in the files, one a row
observations.csv.gz             the same rows
observations.ndjson.gz          the same rows, as JSON Lines
vintages.parquet                every version the Release holds of each Period
observations.{licence}.parquet | .csv.gz | .ndjson.gz     the same rows, for one licence class
vintages.{licence}.parquet
datapackage.json                Frictionless Data Package v2: each file, its size, its SHA-256,
                                its columns, its licence, its Series
```

`{licence}` is a licence class of the rights register: `public_domain`, `cc_by`,
`citation_required` and so on. The whole tables and the tables by licence hold the same rows;
a reader who may only take public-domain data takes that file and needs no filter.

A local-profile Release has no bulk files. Neither does a public-profile Release in which
nothing may be redistributed; its check report says so.

## What is in them, and what is not

A file leaves the site, so it needs the Permission to **redistribute**. A Series is in the
tables only when the gate permits that on the production Surface for its own Origin, dataset
and Channel and for those of every Series it is computed from, to any depth.

| | In the bulk files |
|---|---|
| A Series the gate permits for redistribution | Yes |
| A Series that may be shown and not handed out | No. The datapackage's `left_out` names it with the gate's reason |
| A Derived series with such an input, to any depth | No, the same way |
| A Withheld Series | No. It has no file in the Release at all |
| v1's legacy representation | Never, whatever the gate says. A public-profile Release holds none |
| A Series' history, when the gate refuses an Origin, dataset or Channel it came through | Its Observations are in; its versions are not. `without_history` names it |

Leaving out is the only way anything is kept out. Nothing writes a row and then hides it.

## The Observations table

| Column | Type | |
|---|---|---|
| `key` | text | The Series' permanent key |
| `period` | text | The Period's label, in the shape of the Series' native frequency |
| `period_start`, `period_end` | date | First and last calendar day, both inclusive |
| `value` | number | As the Release holds it: not rounded. Empty when the Period has none |
| `status` | text | The Observation's data state |
| `frequency` | text | The Series' native frequency. Nothing is aggregated |
| `kind` | text | `stored` or `derived` |
| `unit` | text | |
| `licence` | text | The licence class of the Series |
| `ml_use` | boolean | False where the value is not for use in training machine-learning models (ADR 0041) |

Rows are ordered by key, then by Period. The three formats hold the same rows in the same
order. In CSV and JSON Lines a number is written as JSON writes it, so it reads back as the
same double the Parquet file holds; a date is `YYYY-MM-DD`.

## The versions table

One row per version in `vintages/{key}.json`: the columns above without `frequency` and
`kind`, and

| Column | |
|---|---|
| `deleted` | True when the Origin stopped listing the Period |
| `recorded_from`, `recorded_to` | Macro Atlas's clock: when it first held the version, and until when. Text, UTC |
| `provider_from`, `provider_to`, `provider_precision` | The Origin's clock, where the Origin gives one. Text, because an Origin may date a version only to the day |
| `channel` | The route the version was fetched through |
| `origin`, `unit`, `licence` | As recorded with that version: its own day's, not today's |

The two clocks are never merged into one column (`vintage-resolution.md`). A version's
`ml_use` is one answer for a Series' whole history: the Series' own today, and the gate's for
every Origin, dataset and Channel the history came through, whichever is stricter. It is in
both tables as the last column.

`licence` is the class the register gave when the version was captured, so
`vintages.{licence}.parquet` is split by that, and a Series whose class changed has rows in
two files. Whether a version is in any file at all is decided by today's register.

A file of versions is described in the datapackage by what was recorded with its rows: their
licence classes, the attribution each carried, the Origin each names. Today's terms address
is given only for a class a Series in the file still has today.

## The datapackage

`datapackage.json` follows the Frictionless Data Package v2 profile. Each resource has
`path`, `format`, `mediatype`, `bytes`, `hash` (`sha256:` and the digest), `schema.fields`,
`licenses` and `sources`, and fields of Macro Atlas's own: `rows`, `series` (the keys in the
file), `licences` (the classes of its rows), `licence` (on a file for one class) and
`attributions` (the lines each Origin asks to be cited with), `ml_use` (true only when every
row of the file may be described as usable for training machine-learning models) and
`ml_use_reserved` (each Series of the file that may not, with the sentence that says so and
why; the same is said in the resource's `description`). The package also carries
`release_id`, `created`, the rights register's version and hash, `left_out` and
`without_history`.

`licenses[].name` is an Open Definition id that says only what kind of terms apply:
`other-pd` (public domain), `other-at` (attribution asked), `other-closed`. The terms
themselves are at `licenses[].path`.

The release id is made from every file of the Release, the bulk files included, and from the
datapackage with its own `release_id` left empty.

## Checks

The writer checks the bytes it is about to stage, not what it meant to write
(`bulk files: every row is one that may be redistributed, in every format`, a failing check):
each table is read back in every format; its rows must be exactly those the Release's own
`series/`, `derived/` and `vintages/` files give for the Series the gate permits; the
gate is asked afresh about every key a row names; and the datapackage is held to the rows:
each resource's `series` must be exactly the keys in its file, with its count of rows and its
licence classes. The site decides whether a file may be handed out from that list, so a key
left off it would never be asked about.

The Release contract (0.7.0; 0.8.0 for `ml_use`) holds a Release to its datapackage in both validators: bulk
files only in a public-profile Release; every data file named by exactly one resource, and no
file the datapackage does not name; each file's size and SHA-256 as stated; the package this
Release's own; every Series listed one the Release publishes natively; a file for one licence
class listing only Series of that class; and, from 0.8.0, each resource saying `ml_use` and
`ml_use_reserved`, listing at least every Series of the file the Catalog does not allow for
model training and none the file does not hold, with `ml_use` true exactly when the list is
empty. The writer's check holds the same two fields to the `ml_use` column of the rows. A validator reads no Parquet, so what a table's rows
are is the writer's check and the tests'.

A content-only Release (`--reuse-data`) and a withdrawal write their bulk files again from the
files they hold, under the register as it reads then.

## On the site

```
/downloads                              the files of the Release being served
/downloads/{release_id}                 the files of that Release, while retention keeps it
/downloads/{release_id}/{file}          one file, as the bytes on disk
/downloads/latest/{file}                302 to the same file of the current Release
```

- The Release is the one the address names: 410 once retention no longer keeps it, 503 when
  it may not be served on this Surface. Another Release's file is never given in its place.
- **The gate is asked again when a file is requested**, for this Surface, about every Series
  the file lists (and, for a file of versions, everything their history came through). What
  a register allowed when the Release was written does not carry over. A refusal is 403 with
  the reason and no byte of the file. A file is never cut down to what is still allowed: its
  hash is in the datapackage. The datapackage holds no value and is always given.
- **And about model training** (ADR 0041). What a file says of it is fixed in its bytes. Every
  Series the file does not itself mark as not for that use is asked about today, under the
  Permission `ml_use`. If the register no longer allows it, or the file was written before
  files said anything and the register does not allow it, the file is refused whole with
  403: it would leave with rows that read as usable and are not. The next Release's files
  say it.
- A file is counted against the rate limits (`api.md`), like a twin, and so is a request
  through `latest`.
- A file is sent a chunk at a time, as the reader of the response takes it, from one open
  handle: a slow reader holds one chunk in memory, a Release pruned while it is being sent is
  still sent whole, and a file shorter than the size that was checked is an error. The answer
  states no length; the datapackage gives each file's size.
- The bytes at an address under a release id never change, but whether they may be given can.
  So production may keep a copy for five minutes (`Cache-Control: public, max-age=300`, the
  twins' rule), the `ETag` is the file's SHA-256, and the gate answers before a validator is
  compared. Other Surfaces store nothing.
- The reader checks each file's size and SHA-256 against the datapackage when it opens the
  Release, reading the file as a stream, and keeps the description, not the bytes.

## Every page as Markdown

Every page has a Markdown twin at its own address with `.md`; the Overview's is `/index.md`.
A twin takes the page's own question (`/data.md?q=price`, `/explore.md?s=…&pin=…`).

A twin is made from the function the page is drawn from. One thing differs: a twin is a file,
so every value in it is asked for under **redistribute**, row by row. A Series that may be
shown and not handed out is in the twin by name, with the reason and no value. The series
page's own twin and a Claim's are refused whole instead (`twins.md`, `claims.md`), and the
Explorer's is its export as a table, which is refused when nothing in the view may be handed
out. On the local Surface a twin that holds a value is stamped "not for publication".

Each page names its twin in `<link rel="alternate" type="text/markdown">`.

## llms.txt and JSON-LD

`/llms.txt` lists, as links to Markdown: every page that has a twin, every Topic, Series,
Claim, Event and method page of the Release being served, the read API and the datapackage.
It is generated from the Catalog and holds no value. Every link answers 200 on the Surface
that serves it: a Series whose values are not handed out there is listed by its metadata
twin, and a Claim whose record is not given is counted and not linked.

A series page carries a schema.org `Dataset` in `application/ld+json`: a fixed selection of
the Catalog entry, with no value. It says how far the Series runs only where the Series may
be shown, and lists a file as a distribution only where that file would be given.

## The method pages and the rights page

`/docs/method` lists the method pages. `/docs/method/claims` is written for a reader of a
claim page; the others are this directory's documents, drawn as they are
(`/docs/method/claim-records` is `claims.md`). Their text is carried into the site by
`npm run gen` (`site/src/lib/method-docs.generated.ts`); CI fails when it is stale. A page's
twin is the document's own text.

`/docs/rights` states the rights register: each Origin and each intermediary Channel with its
licence class, the terms read and when, the attribution, what was proposed and what is
decided. It is a fixed selection (`site/src/lib/rights-rows.generated.ts`): no quotation,
note or open question, which are in `docs/v2/rights-register.md`. The page grants nothing and
the gate does not read it.

## To see it

```
make v2-dev
open http://localhost:3000/macro-atlas/downloads
curl -s http://localhost:3000/macro-atlas/llms.txt
curl -s http://localhost:3000/macro-atlas/highlights.md
curl -sL -o observations.parquet http://localhost:3000/macro-atlas/downloads/latest/observations.parquet
python -c "import pandas as pd; print(pd.read_parquet('observations.parquet').head())"
.venv/bin/python -m pytest tests/v2 -q -k bulk
```

`make v2-dev` serves the fixture release, whose values are invented. `make v2` serves v1's
data as a local-profile Release, which has no bulk files; its `/downloads` says so.
