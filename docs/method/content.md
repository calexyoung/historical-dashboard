# Content: Events, the layers drawn behind Series, and notes

How Macro Atlas's own content is written, checked and put into a Release (PLAN 4.3, 5 and M19;
ADR 0011, ADR 0030, ADR 0033). The code is `atlas/content/`.

## What there is

```
content/events/{id}.md                 an Event
content/events/migration-review.json   the record of the review of v1's 83 (not edited)
catalog/manual/terms/{office}.json     a terms file: who held an office and when (ADR 0030)
catalog/manual/spans/{name}.json       a spans file: the dated stretches of a layer (recessions)
notes/{user}/{id}.md                   one user's own note; in no Release
content/claims/{id}.md                 a Claim, and content/claims/locks/ its locks: docs/method/claims.md
```

`catalog/manual` is empty today: a hand-entered file is a public copy of somebody's record, and
none is committed until its Origin's row of the rights register is signed.

## An Event

```
---
id: "2031-02-03-an-invented-act-is-signed"
date: "2031-02-03"
date_precision: day
title: "An invented Act is signed"
category: legislation
status: draft
topics: []
related_series:
  - "unrate"
sources:
  - url: "https://example.org/act"
    archive_url: "https://web.archive.org/web/2031/https://example.org/act"
---

The Act was signed on 3 February 2031.
```

| Field | Rule |
|---|---|
| `id` | The date as written, a hyphen, a slug. Permanent. The file is `{id}.md`, the page `/events/{id}`, the Annotation `event-{id}` |
| `date`, `date_precision` | A day (`YYYY-MM-DD`), a month (`YYYY-MM`) or a year (`YYYY`), and which. As precise as the record; no day is made up |
| `end` | Optional. The last day, month or year, inclusive, in the precision of `date`. Not for an Event still running |
| `title` | What happened, in a few plain words |
| `category` | `political`, `financial`, `geopolitical`, `health`, `policy` (v1's), `disaster`, `infrastructure`, `legislation` |
| `status` | `draft` or `public`. A draft is in local-profile Releases only |
| `topics` | Topic slugs. Not checked against anything until Topics are files (M23) |
| `related_series` | Keys of the Catalog to set beside the Event. Not a statement that it moved them |
| `sources` | At least one. Each has a `url` and either `archive_url` or `no_archive` (the reason there is no archived copy), and may have a `name` |
| `accepted_terms` | Words of the word list accepted in this Event's own text, because they belong to the thing's name. Alex's to add |
| the text below | The description: what happened and when, supported by the sources. May be empty |

There is no field for what an Event caused, and none for a judgment (ADR 0011). There is none
yet for a measured size either (the plan's `magnitude`): a figure typed in from a published
record is a hand-entered value, and those wait for their Origin's row of the rights register
(ADR 0030, ADR 0033). The same care is the editor's for a figure written into a title or a
description: the word list cannot see it.

## The word list

`atlas/content/wordlist.py`: a closed list of causal terms (*because*, *led to*, *triggered*,
…) and evaluative terms (*crisis*, *collapse*, *historic*, …), matched as whole words in any
case. No exemption for a proper name: a person decides.

- A **public** Event whose title or description has a listed word fails `atlas check` and stops
  a public-profile release.
- A **draft** that has one gets a NOTE from `atlas check`, and stays out of public Releases.
- To clear it: reword, or add the word to that Event's `accepted_terms`.

## Adding an Event

```
python -m atlas add event 2031-02-03 "An invented Act is signed" --category legislation \
    --source https://example.org/act --archive-url https://web.archive.org/web/2031/https://example.org/act \
    --series unrate --description "The Act was signed on 3 February 2031."
python -m atlas check
```

It writes one draft file, never overwrites and never commits. `--no-archive "REASON"` stands in
for `--archive-url` when there is no archived copy; one of the two is required. `--end` makes
it span time. `--series` takes keys of the Catalog and refuses any other. More than one
source, `status: public` and `accepted_terms` are edits to the file.

## The layers typed in from a record

A **terms file** is ADR 0030's. A **spans file** is its twin for a layer of dated stretches:

```
{ "format": 1, "kind": "spans", "origin": {"producer": "...", "dataset": "..."},
  "layer": "recession", "label": "US recession",
  "spans": [ {"start": "2007-12-01", "end": "2009-06-30", "citation": {...}} ] }
```

Spans are days, both ends inclusive, in order, not overlapping; only the last may be open
(`"end": null`). Each has a citation in the hand-entered form (publisher, title, url, accessed,
locator). `atlas check` holds both kinds to their format (references) and to the rights of
their Origin (rights). Fixtures with invented terms and spans are under `fixtures/manual`.

## What a Release gets

`atlas.content.compile.compile_content` writes two files.

| | `content/events.json` | `content/annotations.json` |
|---|---|---|
| public Profile | The `public` Events, whole, oldest first | Each of those Events; each hand-entered layer whose Origin the gate permits for display on production. A layer it refuses is left out and named in the check report |
| local Profile | Every Event, drafts too, each with its `status` | Every Event; every hand-entered layer; v1's bands and recessions for each set no hand-entered file provides, marked as v1's |

How an Event is anchored:

| The Event | Its Annotation's anchor |
|---|---|
| a day | `{type: date}` |
| a month or a year | `{type: period}`: that Period |
| any, with an `end` | `{type: span}`: the first day to the last, with `attributes.date_precision` when it was months or years |

An Annotation projected from a hand-entered file carries `provenance` (the file's Origin and
dataset, `via: hand_entered`), and the gate is asked about it twice over: by the rights check
of a Release every time the Release is checked, and by the site on every request
(`site/src/lib/annotations.ts`), so a layer whose permission is taken away stops being drawn
at once, whatever Release is being served. An Export asks for `redistribute`: a layer that may
be shown and not handed out is on the page and not in the file. A recession span is named for the day it starts. v1's carry `representation: legacy_monthly_rounded` and are in no
public-profile Release.

`python -m atlas release --profile P --reuse-data` writes the content afresh on the current
data: that is how an edited Event reaches the site without a new capture.

## Notes

```
python -m atlas add note --user alex --about series:unrate "Worth a second look after the benchmark revision."
```

One user's own remark on a Claim, a Series or a Topic, in `notes/{user}/`. It may hold a
judgment; that is why it is the user's. `atlas check` holds it to its format. Nothing compiles
it: it is in no Release (PLAN 5; reading them locally is M21's).

## The review of v1's Events

`docs/v2/events-review.md` (generated: `python -m atlas.content.report --write`) lists the 35
of v1's 83 Events that the word list or Codex listed, each with a proposed wording, and the 5
citations without an archived copy. To decide one: edit its file. `scripts/migrate_events.py`
is the record of the migration and is not run again over edited files.

## See it

```
make v2            # v1's data and all 83 Events: http://localhost:3000/macro-atlas/events
make v2-dev        # the synthetic fixture:      http://localhost:3000/macro-atlas/events
.venv/bin/python -m pytest tests/v2 -q -k content
```
