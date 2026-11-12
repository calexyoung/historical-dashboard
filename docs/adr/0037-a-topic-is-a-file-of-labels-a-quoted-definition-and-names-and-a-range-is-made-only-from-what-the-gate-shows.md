---
status: accepted (M23, 2026-11-12); which Events and Companions a Topic lists is an editor's choice and is Alex's to change; D11 (published accounts) stays open and no field exists for it
---

# A Topic is a file of labels, a quoted definition and names, and a range is made only from what the gate shows

M23 builds the topic template and two Topics, Inflation and Jobs: a definition quoted from the
agency, a change strip, the main figure, "what else moved" as small multiples on one time
axis, the United States against the G20 range, and the Claims, Events and Series of the Topic.
The acceptance: every sentence on a Topic page is a label, a template sentence or a quoted and
cited definition, tested against a content schema with no free-prose field; each Companion
states a factual relation; the band matches a minimum, median and maximum worked out by hand
for a fixture month; compile fails on a dangling reference with file and line; search returns
the two Topics. This records the choices the plan left open. The contract for a person who
writes a Topic is `docs/method/topics.md`.

## Decisions

1. **A Topic is `content/topics/{slug}.md`, and the front matter is the whole file.**
   `schema/topic.schema.json` (unknown fields refused): `slug`, `title`, `segment`, `status`,
   `definition {quote, source}`, `main`, `series`, `companions[] {series, relation}`, an
   optional `range {series, coverage, indicator, label}` and `events`. Text under the front
   matter is refused, with its line. The only field that holds a sentence is the quote, and it
   cannot stand without its citation (publisher and page, address, an archived copy or the
   reason there is none). A `title` and a range's `label` are labels: at most sixty
   characters, with no full stop, question mark or exclamation mark, so a sentence does not
   fit. The reason a citation has no archived copy is one of a closed list (`no_copy_found`,
   `archiving_refused`, `page_removed`) with fixed words on the page, not a text as an
   Event's is; the source's `name` is one line of at most 120 characters. A public Topic's
   title, label and source name are held to the word list, as an Event's title is. A citation
   can still be given a false name: that is a false citation, and reading it against the page
   is the editor's. There is no field for an explanation, a finding, a cause or a published account (D11
   is open; its field arrives with Alex's decision, not before).
2. **A relation is one of a closed list, and each has fixed words.** `component`,
   `excludes_components`, `input`, `same_survey`, `same_release`. Each says where a Series
   comes from or what it is made of; none says one moved another. The page prints the fixed
   words for the relation (`site/src/lib/topics.ts`, `RELATION_WORDS`), so an editor chooses a
   relation and writes nothing. `atlas check` and the compiler hold a relation to what the
   Catalog can know: `input` must be among the main Series' Recipe inputs, however many
   Recipes away; `component`, `excludes_components` and `same_survey` need both Series to rest
   on one dataset of one agency; `same_release` needs two Series the one agency itself
   publishes, so not a Series computed here by a Recipe (Jobs names `wages`, the Bureau's
   average hourly earnings, not the change Macro Atlas computes from it). That a Series measures a
   part of another, or that two are in one release, is the editor's statement of fact within
   those bounds.
3. **A dangling reference fails `atlas check` and every writer, with file and line.** A Series
   that is not in the Catalog or is retired, an Event with no file, a coverage matrix or an
   indicator that is not there, a relation the Catalog contradicts: each is reported as
   `content/topics/x.md:LINE: …`, the line of the value in the file. It refuses a release of
   either Profile: a reference that points at nothing is wrong on every Surface. Topics are
   held to the repository's Catalog, not to what one Release holds.
4. **An Event's or a Claim's `topics` are now held to Topic files.** A `public` one that names
   a Topic with no file is a problem; a draft that does gets a note. Naming a Topic that is a
   draft is a note: a public Release then carries the name and has no page for it.
   **Which Events a Topic's page lists is the Topic's own `events`**, an editor's list; an
   Event's `topics` is a tag on the Event and adds nothing to a Topic's page. A Claim is
   listed on a Topic's page when the Claim's own `topics` names it: a Claim file is the record
   of a statement and says what it is about, and no second list could disagree with it.
5. **Release contract 0.6.0: `content/topics.json`, and the Topics' entries of
   `search.json`.** The Topics by slug; a public-profile Release holds the `public` ones, and
   of each one's Events those it holds itself (the id of a draft Event is in no file of a
   public Release; what was left off is counted in the check report). A range's members are
   resolved when the Release is written. Both validators: `duplicate_topic`; `topic` (the main
   Series is not a member Series, a Companion is the main Series or is listed twice, a member
   of a range is listed twice, an Event that is not an Event of the Release);
   `draft_in_public`. `search.json` gains one entry per Topic after the Claims: its slug, its
   title, the definition it quotes and two keywords (the source's name and the main Series'
   key). Both validators recompute it. A Release written before 0.6.0 opens with no Topic.
6. **Series are carried by key whether or not the Release holds them**, as an Event's related
   Series are (ADR 0033, decision 10) and unlike the headline Series (ADR 0036, decision 2),
   which are a projection of what the Release can show. A Topic names what an editor set
   beside its main Series; leaving a name out because a row of the register is unsigned would
   hide a fact of the record. The page names a Series the Release does not hold by its key,
   with no link and "Not in this release", and reads nothing from the repository.
7. **The members of a range come from a coverage matrix, one Series per country.** The Topic
   names the matrix and one of its columns (`g20`, `inflation`); the compiler takes each row
   whose code is a country's three letters and that has a Series in that column. The euro
   area's row is left out: Germany, France and Italy have rows of their own and would be
   counted twice. Nineteen members for the G20, the United States among them. The matrix file
   is recorded among the compiler's inputs.
8. **The range is the engine's, and is made only from what the gate shows.** `rangeAcross`
   (`packages/core/src/range.ts`, `docs/method/topics.md`): for each Period, the members that
   count, and the lowest, median and highest of their values. A value counts when its origin
   published it as an observation (final, preliminary, revised); an estimate, a projection
   and a partial Period do not. The median is unweighted. The page asks Query for every
   member, one by one, for display on the Surface in hand, and hands the engine only the
   Series that were shown: a refused member is never an argument, so no figure, count, axis
   or label can come from it. A test changes a refused member's values and holds the whole
   rendered page to the same text.
9. **A Period has a range when more than half of the declared members count in it**, and the
   figure is drawn only when the page can show at least that many. The denominator is always
   the number declared (19), never the number shown. This is a display policy, not a claim
   that the members shown represent the group: the coverage matrix records late starts and
   gaps, so requiring all nineteen would leave the figure empty for most of its span, and
   stating a "G20 range" of three or four economies would misname it. Membership changes from
   Period to Period, so the band can move when no member's value has; the page says so, and a
   table gives the number counted in each Period. Members whose frequency or unit is not the
   compared Series' own are not counted and are named as such.
10. **The Series set beside the range is the range's own, never the Topic's main Series.**
    Inflation's main Series is the Bureau of Labor Statistics' `cpi_yoy`; the range compares
    `us_infl`, which is computed from the International Monetary Fund's index as every other
    member is. If `us_infl` cannot be shown, no range is drawn and the page says why. A figure
    from one agency is never set against a range made from another's.
11. **`semantics_version` stays 0.8.0.** `rangeAcross` is new and changes no Transform,
    aggregation, Measure or statistic, so no answer a Claim lock froze can differ. M22 raised
    the version for an addition; doing so again would mark every lock as computed under an
    older contract for no change in what it holds.
12. **One window for every figure of a page: the ten years to the main Series' latest
    value.** The main figure, the small multiples and (to its own Series' latest value) the
    range. "What else moved" is one explained figure with each Series in a plot of its own
    (`separate`), lower than a figure on its own (`compact`: 150, 170 and 190 units), stacked
    on one time axis and one left edge; the scales at the left differ and the page says so.
    The band is a filled shape between the lowest and highest value, with a gap where there is
    no range; the median is a line; the two edges are in the table and the legend and are not
    drawn as lines. Nothing animates.
13. **Topics is the first tab, shown when the Release holds a Topic**, and the first group of
    search. The Overview lists the Topics by name under its rows.
14. **The two Topics are `public`.** M23 needs nothing from Alex, and a Topic has no
    publication gate of its own as a Claim has. Both definitions were checked word for word on
    2026-11-12 against the Internet Archive's copies of the Bureau of Labor Statistics' pages
    (the Bureau's own server refuses automated requests): `https://www.bls.gov/cpi/` as
    archived on 2026-11-08, and `https://www.bls.gov/cps/definitions.htm` as archived on
    2026-11-05. The archived copies were looked up, not made (ADR 0033, decision 5). Being
    public grants no right to any value: every Series on the page is still asked of the gate.
    `atlas add topic` writes a draft and cannot write `status: public`.
15. **Inflation lists one Event and Jobs none.** Listing an Event on a Topic's page is an
    editor's judgment that a reader would want it there. The builder listed the one whose own
    title names the Topic ("US inflation peaks at 9.1%") and left the rest for Alex.

## Considered and not done

- **A free-text relation, or a note beside a Companion.** It would be a door for prose of the
  site's own on a page that has none.
- **Deriving a Topic's Events from the Events' own `topics`.** Every one of v1's 83 has none,
  and a second list that can disagree with the first needs a rule for which wins.
- **Filtering a Topic's Series to those the Release holds**, as Highlights does. See 6.
- **Requiring every member for a range, or stating one for any number.** See 9.
- **Cutting the range's axis so that one member's very high values do not flatten the rest.**
  A cut axis misstates distance unless it is marked, and choosing where to cut is a judgment
  about which economies matter. The highest value is drawn where it is. An interquartile band
  would be a different figure from the one the plan names; it is listed for Alex.
- **Twins of a Topic page** (`.json`, `.md`). M25 lists Markdown twins for every page and M24
  the read API; a range's file needs the redistribute gate asked member by member.

## Consequences

- While the International Monetary Fund's row of the register is unsigned, the range on
  Inflation is named and not drawn on a public Surface, and on `make v2` (v1's data, which
  holds four of the nineteen members and no `us_infl`) the page says how many it can show.
  It is drawn on a local Release written from captured agency data.
- Signing a row changes what a Topic page shows with no change of code or content.
- Adding a Topic is a file; adding a relation is a change to both schemas, the fixed words
  and this record.

## Tests

`tests/v2/test_content_topics.py` (the file, the references and their lines, the compiler in
both Profiles, `atlas check`, `atlas add topic`, the repository's two Topics),
`tests/v2/test_reading_files.py` (the legacy converter's search index names both),
`checks/release-cases.json` through `test_release.py` and
`packages/core/src/release/release.test.ts` (the 0.6.0 rules, in both languages),
`packages/core/src/range.test.ts` (the range, by hand), `site/src/lib/topics.test.ts` (the
views, the fixture month, the gate, search), `site/tests/built/served.test.ts` (the pages over
HTTP on the local and production Surfaces), `site/e2e/topics.spec.ts` (both base paths, 320px,
both themes, JavaScript off, no motion).
