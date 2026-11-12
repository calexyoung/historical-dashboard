# Topics: the file, what it may name, and the range across a group

How a Topic is written, checked and shown (PLAN section 3, 5 and M23; ADR 0037). The code is
`atlas/content/topics.py`, `packages/core/src/range.ts` and `site/src/lib/topics.ts`.

A Topic page states figures and names sources. It gives no account of why anything moved, and
nothing set beside a Series on it is said to have moved that Series.

## A Topic

```
content/topics/{slug}.md
```

```
---
slug: "inflation"
title: "Inflation"
segment: economy_jobs
status: draft
definition:
  quote: "The words of the agency, exactly as they stand at the address below."
  source:
    name: "The publisher, and the page"
    url: "https://example.org/page"
    archive_url: "https://web.archive.org/web/2031/https://example.org/page"
main: "cpi_yoy"
series:
  - "cpi_yoy"
  - "cpi_nsa"
companions:
  - series: "cpi_nsa"
    relation: input
range:
  series: "us_infl"
  coverage: "g20"
  indicator: "inflation"
  label: "G20"
events:
  - "2022-06-us-inflation-peaks-at-9-1"
---
```

The front matter is the whole file. Text under it is refused.

| Field | Rule |
|---|---|
| `slug` | Lower-case words joined by hyphens. Permanent: the file is `{slug}.md` and the page `/topics/{slug}` |
| `title` | A label: at most 60 characters and not a sentence (no full stop, question mark or exclamation mark) |
| `segment` | One of the six Segments |
| `status` | `draft` or `public`. A draft is in local-profile Releases only |
| `definition.quote` | The origin agency's own words, verbatim, one line, 20 to 600 characters. Never a paraphrase |
| `definition.source` | `name` (the publisher and the page's own name, one line), `url`, and `archive_url` or `no_archive`: one of the two, never both. `no_archive` is one of `no_copy_found`, `archiving_refused`, `page_removed`; the page prints fixed words for each |
| `main` | The Series the page opens with. One of `series` |
| `series` | The member Series, in the order the page lists them |
| `companions` | What else moved: at most six, each a `series` and a `relation`. Not the main Series; none twice |
| `range` | Optional. `series` is set against the range of the Series that the coverage matrix `catalog/coverage/{coverage}.json` gives for `indicator`, one per country; `label` is what the group is called ("G20") |
| `events` | Ids of Events to list on the page, in the order given. An editor's list |

There is no field for an explanation, a finding, a cause or a published account.

## Relations

A Companion says how it is related to the main Series by one of five words. The page prints
fixed words for each; an editor writes none.

| `relation` | The page says | `atlas check` holds it to |
|---|---|---|
| `component` | Measures a part of what the main series measures | both rest on one dataset of one agency |
| `excludes_components` | Measures what the main series measures, with some parts left out | the same |
| `input` | The main series is computed from it | it is among the main Series' Recipe inputs, however many Recipes away |
| `same_survey` | From the same survey as the main series | both rest on one dataset of one agency |
| `same_release` | Published by the same agency in the same release as the main series | both are Series the agency itself publishes (neither is computed by a Recipe), of one agency |

What the Catalog cannot know (that a Series measures a part of another; that two are in one
release) is the editor's statement of fact, to be checked against the agency's own pages.

## What is checked, and where

`python -m atlas check` (the content layer) and every release writer refuse:

- a file under `content/topics` that is not a Topic;
- a Series that is not in the Catalog, or is retired;
- an Event with no file under `content/events`;
- a coverage matrix that does not exist, a column it does not have, fewer than three
  countries with a Series in that column;
- a relation the Catalog contradicts;
- a member of a range that is retired;
- in a `public` Topic, a word of the word list (`atlas/content/wordlist.py`) in its title, its
  range's label or its source's name. The quote is the agency's and is not held to the list.
  A draft that has one gets a note.

Each problem is `content/topics/{slug}.md:LINE: …`, the line of the value in the file. A
release of either Profile is refused: a reference that points at nothing is wrong everywhere.

An Event's or a Claim's own `topics` must be Topic files once it is `public`; a draft that
names one that is not gets a note.

## Adding a Topic

```
python -m atlas add topic housing --title "Housing" --segment economy_jobs --main houst \
    --quote "The agency's own words." --source-name "The publisher, the page" \
    --source https://example.org/page --archive-url https://web.archive.org/web/2031/https://example.org/page
python -m atlas check
```

It writes one draft, never overwrites and never commits. Companions, a range, Events and
`status: public` are edits to the file. Before making a Topic public, read the quote against
the page it cites, word for word, and check each relation against the agency's own account.

## What a Release gets

`content/topics.json` (contract 0.6.0): the Topics by slug, with the range's members resolved
(`{key, country}`, one per country; a row of the matrix that stands for a group of countries,
such as the euro area, is left out). A public-profile Release holds the `public` Topics and,
of each one's Events, those it holds itself. Series are carried by key whether or not the
Release holds them. `search.json` gains an entry per Topic: its title and the definition it
quotes.

## The range across a group

`rangeAcross(members, { of })` in `@macro-atlas/core`. For each Period:

- **Who counts.** A member counts when it has a value its origin published as an observation:
  `final`, `preliminary` or `revised`. An `estimate`, a `projected` value, a `partial` Period
  and a missing or suppressed value do not count.
- **The three figures.** The lowest and the highest of the values that count, and their
  median. The median is unweighted: each member is one value, whatever the size of its
  economy. With an even count it is the mean of the two middle values.
- **When a range is stated.** When at least `least` members count; by default more than half
  of `of`, the number of members the group was declared with. `of` is the denominator a page
  states, and is not reduced when a member cannot be shown. Below `least` the three figures
  are absent, and the count and the members are still given.
- **Membership moves.** Which members count changes from Period to Period (a late start, a
  gap, an estimate), so the range can move when no member's value has. Every Period carries
  the members counted.

A worked month, from the fixture release (`fixtures/make_fixture.py`), November 2025, five
members declared:

| Member | Value |
|---|---|
| the price index's change from a year earlier, (109.3 / 104.1 − 1) × 100 | 4.9952 |
| economy B | 2.0 |
| economy C | 7.5 |
| economy D | 3.1 |
| economy E | not in the Release |

Four of five count. Lowest 2.0, highest 7.5; in order 2.0, 3.1, 4.9952, 7.5, so the median is
(3.1 + 4.9952) / 2 = 4.0476. In March 2025 two members count (the index has a gap and C has
not begun): not more than half of five, so that month has no range.

The function is handed only Series that may be used and that can be compared. The page does
both before it calls: each member is asked through Query for display on the Surface in hand,
and a member whose frequency or unit is not that of the Series being compared is left out and
named. A refused member is never an argument, so nothing computed from it can be shown.

`semantics_version` is unchanged (0.8.0): the range changes no Transform, aggregation, Measure
or statistic.

## The page

`/topics` lists the Release's Topics. `/topics/{slug}`, in order:

1. the definition as a quotation, with its source and archived copy, and the main Series'
   change strip (a row of Highlights: `docs/method/highlights.md`);
2. the main Series' explained figure over the ten years to its latest value;
3. **What else moved**: each Companion with its relation, then the main Series and every
   Companion that can be shown, each in a plot of its own, on one time axis;
4. **Against the {label} range**, where the Topic names one: a sentence that states the latest
   figures, the Series, the median as a line and the lowest-to-highest band, what the band is,
   a table of how many members were counted in each Period, and every declared member by
   country with the reason for any that is not shown;
5. the Claims whose own `topics` name the Topic, the Events the Topic lists, and the member
   Series.

Every figure is a door to the Explorer at its window; every name is a door to its own page. A
Series the gate holds back, or the Release does not hold, is a name and a reason. The page
needs no script and nothing on it moves.

## See it

```
make v2-dev        # the synthetic fixture: http://localhost:3000/macro-atlas/topics/inflation
make v2            # v1's data:             http://localhost:3000/macro-atlas/topics/jobs
.venv/bin/python -m pytest tests/v2 -q -k topics
npx vitest run packages/core/src/range.test.ts site/src/lib/topics.test.ts
```
