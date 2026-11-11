# Macro Atlas

Macro Atlas is a neutral source of data and facts about the past and current state of the United
States in a global context. It lets a reader set what politicians and pundits claim beside the
figures that were public at the time, and leaves the judgment to the reader. It is inspired by the
idea of a nation's annual report but is not one.
_Avoid_ for the site as a whole: annual report, fact-checker, dashboard

This file is the glossary for v2. It defines words only. Decisions live in `docs/adr/`, and the
build plan in `docs/v2/PLAN.md`.

## Language

### Data

**Series**:
One measured quantity followed over time, with a fixed definition, unit and native frequency, and a
permanent public key.
_Avoid_: Indicator, metric, variable, ticker

**Observation**:
One value of one Series for one Period, held unrounded with its Status. (Values carried over from
v1 are monthly and already rounded; they are marked as the legacy representation and never mixed
with unrounded values in one Series.)
_Avoid_: Data point, reading, row

**Period**:
The span of time an Observation describes (a day, month, quarter or year). It is not the date the
value was published or fetched.
_Avoid_: Date, timestamp

**Status**:
What kind of value an Observation is: final, preliminary, revised, estimate, projected, partial
period or suppressed. A projected value is never presented as observed.
_Avoid_: Flag, quality

**Measure kind**:
Whether a Series is a stock, a flow, a rate, an index or an annualized figure. It decides how
values may be combined across Periods.
_Avoid_: Aggregation type

**Derived series**:
A Series computed from other Series by a Recipe, such as a year-over-year change or a ratio.
_Avoid_: Calculated field, synthetic series

**Recipe**:
The declared rule that produces a Derived series: its inputs, the operation, and the order of
aggregation and arithmetic.
_Avoid_: Formula, derivation, transform (a Transform is something else)

**Transform**:
A named, reader-chosen re-expression of a Series for viewing or testing, such as percent change
from a year earlier or an index rebased to a period. It does not create a new Series.
_Avoid_: Mode, calculation

**Catalog**:
The list of every Series Macro Atlas knows about, with each one's definition, Source and Rights.
_Avoid_: Registry, config

**Data state**:
A condition of a value that a reader must be told about: preliminary, revised, estimate, projected,
partial period, stale, missing, break, withheld.
_Avoid_: Warning, caveat

### Provenance and rights

**Source**:
Where a Series comes from. It always has two parts that are never merged: an Origin and a Channel.
_Avoid_: Provider, feed

**Origin**:
The organisation that produces a Series and the dataset and identifier it publishes it under (for
example the Bureau of Labor Statistics, CPI-U, `CUSR0000SA0`).
_Avoid_: Owner, publisher, author

**Channel**:
The route by which Macro Atlas actually obtained a value: directly from the Origin, or through an
intermediary such as FRED. A Channel has terms of its own, separate from the Origin's.
_Avoid_: Via, mirror, API

**Provenance**:
The full answer to "where did this number come from": Origin, Channel, address, time fetched,
Release, licence and any processing applied.
_Avoid_: Attribution, citation (a citation is one rendering of Provenance)

**Rights**:
What the Origin's and the Channel's terms allow Macro Atlas to do with a Series. Recorded as a
status with the terms that were read and the date they were read.
_Avoid_: Licence (the licence is one input to Rights)

**Permission**:
One of three things Rights may allow: display (show on a public page), redistribute (offer as a
download or through the API) and ML use (describe as usable for model training). A Permission
follows from Rights and the Channel used.
_Avoid_: Access level

**Withheld**:
A Series that exists in the Catalog but is kept off every public Surface because its Rights do not
allow display or are not yet known. It is listed by name with the reason.
_Avoid_: Hidden, private, disabled

**Rights register**:
The single list of Origins and Channels with the terms read for each and Alex's decision on what
is allowed.
_Avoid_: Licence audit

### Time and revisions

**Vintage**:
The state of knowledge about a whole Series at one moment: which value was current for each Period
then. One Observation as it stood at one time is a version of that Observation, not a Vintage.
_Avoid_: Version, revision (a Revision is the change between two Vintages)

**Revision**:
A change to the value, Status or definition of an already-published Period.
_Avoid_: Update, correction (a Correction is to Macro Atlas's own content)

**Four clocks**:
The four different times attached to a value, never collapsed into one: the Period it describes,
when the Origin published it, when Macro Atlas fetched it, and the Release it appeared in.

**Provider vintage**:
A Vintage dated by the Origin or an archive of its releases. It can establish what was first
reported.
_Avoid_: Real-time data, ALFRED data

**Atlas-observed vintage**:
A Vintage known only because Macro Atlas fetched it on a given day. It shows a value was public no
later than that day; it cannot establish when the value was first reported.
_Avoid_: First print, snapshot

**Capture**:
One successful fetch of a Source's exact bytes, kept as evidence whether or not anything changed.
_Avoid_: Scrape, download, cache

**Endpoint**:
One thing the capture job fetches from an Origin: a request, or a paged run of requests, whose
answer is kept whole. The list of Endpoints lives on the Origin's row of the Rights register.
_Avoid_: URL, feed, source (a Source is where a Series comes from)

**Completeness evidence**:
What a Capture records to show the answer was whole: what was asked for (the scope), what came
back, and every reason it falls short. An answer that falls short is kept and flagged incomplete.
_Avoid_: Validation, health check

**Fetch log**:
The append-only record of every Capture attempted, with its request, response headers, time and
Completeness evidence. The Vintage store is rebuilt by replaying it.

**Capture gap**:
A stretch of days with no Capture of a Series. An answer that depends on a gap is marked uncertain.

**As-of**:
A question asked of a Series: "what did the data say before this date?" The answer is a Vintage
plus its Basis.
_Avoid_: Historical, point-in-time

**Basis**:
The kind of evidence behind an As-of answer: provider, Atlas-observed, legacy, uncertain or
unavailable. An unavailable answer is never replaced by today's figure.
_Avoid_: Confidence, quality

**Cutoff**:
The instant before which a value must have been public to count as known when a Claim was made.

**Release**:
One complete, checked, unchangeable publication of Macro Atlas's data and content. The site always
serves exactly one Release, and every page is drawn from a single Release.
_Avoid_: Build, snapshot, deploy

**Profile**:
Which kind of Release a directory is. A public Release is built only from what the Rights register
allows and is the only kind production may serve. A local Release may also hold v1's legacy data,
draft Claims and User notes, and is never served on a public Surface.
_Avoid_: Mode, environment

**Surface**:
Where a build of the site is reachable: local (one machine), staging or production. A Surface is
public unless it is local or behind a password.
_Avoid_: Environment, tier

**Pin**:
A reference from a link, a Claim lock or an Edition to one specific Release, so the reader sees the
data as it was then.
_Avoid_: Permalink, freeze

### Context

**Event**:
A dated or spanning occurrence (a law, a shock, a disaster, an election) recorded with citations
and shown as context beside Series. An Event is never said to have caused a movement.
_Avoid_: Milestone, marker, news

**Annotation**:
Anything drawn on a time axis that is not a Series: an Event, a Claim, a recession, a term of
government, a policy period or a Data note.
_Avoid_: Overlay, marker, band

**Data note**:
An Annotation that records a break, rebasing or change of method in a Series. It is always shown.
_Avoid_: Footnote

**Topic**:
A subject a reader wants to understand (inflation, jobs, the grid), presented as its key Series,
its Companions, its Events and its Claims.
_Avoid_: Category, theme, tag

**Companion**:
A Series chosen by an editor to be shown beside a Topic's main Series on one time axis, to show
what else moved.
_Avoid_: Related series, correlate

**Published account**:
An explanation of why something moved that a named third party has published, listed with its
citation beside others and without ranking. Macro Atlas writes no explanations of its own.
_Avoid_: Competing explanation, cause, driver, narrative

### Claims

**Claim**:
A public statement by a politician or pundit that can be set beside Series, recorded with the
verbatim quote, who said it, when and where, archived copies of the source, and the data needed to
examine it. A Claim carries no judgment.
_Avoid_: Fact-check, verdict, statement, assertion

**Claimant**:
The person who made a Claim, with the role and party they held when they made it.
_Avoid_: Speaker, source (Source means data)

**Reading**:
One way to turn a Claim's words into something measurable: which Series, which Periods, which
Transform, which Measure. A Claim may have several Readings; those not measured are listed.
_Avoid_: Interpretation, test

**Measure**:
The fixed computation a Reading applies to the data, such as the value at a Period, the change over
a window, or the extreme in a window and its date. A Measure returns numbers, never true or false.
_Avoid_: Test, check, rule

**Window sensitivity**:
The results of one Measure over a declared set of alternative windows, shown together so the reader
sees how much the chosen window matters.

**Evidence row**:
The result of one Reading against one state of the data. There are three kinds, never mixed:
*then* (what was public before the Cutoff), *now when checked* (the same Periods on the day the
Claim was recorded) and *latest* (the same Periods today).

**Claim lock**:
The frozen record of a Claim's *then* and *now when checked* Evidence rows and its Window
sensitivity: the exact numbers and the Release they came from. A lock is never edited; recording
the Claim afresh adds a new one with a reason.
_Avoid_: Snapshot, cache

**Finding**:
A judgment on a Claim (accurate, misleading, and so on). Macro Atlas does not produce Findings. A
user may hold one, and it lives only in that user's User notes.
_Avoid_ as site content: verdict, rating, label, score, any neutral-looking word that works as one

**User note**:
A remark or judgment that one user attaches to a Claim, Series or Topic, marked as that user's and
kept apart from Macro Atlas's own data and content.
_Avoid_: Annotation (an Annotation is drawn on a time axis), comment, assessment

**Correction**:
A dated, public change to a Claim, Event or Edition after publication, with the reason. Old
versions stay readable.
_Avoid_: Edit, fix

### Presentation

**Overview**:
The opening view: the state of the nation in one row per Segment.
_Avoid_: Cover, dashboard, homepage, report

**Highlights**:
The table of headline Series with their change over one, five and ten years.
_Avoid_: KPIs, scorecard

**Segment**:
One of six parts of national life the data is grouped into: Economy & jobs, Markets & money,
Infrastructure, Governance & politics, Disasters & health, The US in the world.
_Avoid_: Section, category (a Topic is not a Segment)

**Statement**:
A table of related Series laid out like a financial statement (federal, national, external), with
the entity, basis and period stated.
_Avoid_: Report, balance sheet (unless it is one)

**Edition**:
The Overview, Highlights and Statements for one year, frozen at a Cutoff and Pinned to a Release. A
change after publication is a Correction and a new version. An Edition has no Letter and no prose
of opinion.
_Avoid_: Annual report, issue, archive

**Explained figure**:
A chart that carries its own Takeaway, its unit and adjustment in words, its Source line, a "how to
read this" note, the same data as a table, and a link into the Explorer.
_Avoid_: Chart, widget, card

**Takeaway**:
The one sentence above an Explained figure, written from a fixed template, that states the latest
figure and its change. It describes and never evaluates. Some Data states leave a figure with no
Takeaway.
_Avoid_: Insight, summary, caption

**Explorer**:
The workbench where a reader picks Series, a window and a Transform and studies them together,
with Annotations and As-of views. Its address fully describes what is shown.
_Avoid_: Dashboard, chart builder

**Readout**:
What every selected Series says at one date in the Explorer: for each, the Observation whose
Period contains that date. A reader may hold the Readout at a date; the address then carries it
(`at=`). Holding a date is not a Pin, which is a reference to a Release.
_Avoid_: Tooltip, crosshair values

**Layer**:
A set of Annotations a reader can switch on or off in the Explorer: recessions, one category of
Events, one set of terms of government.
_Avoid_: Overlay

**Relationship**:
How two Series moved together over a window: Pearson's r, at a lag or over a rolling window,
taken at the slower of the two Series' frequencies. Descriptive only: shown with n, the window,
the frequency and the missing Periods, and never called significant.
_Avoid_: Correlation analysis, significance, finding

**Second range**:
In the Explorer, the same Series over the same number of months from another start, drawn over
the window's own axis so the two can be compared (`cmp=`).
_Avoid_: Overlay, comparison period

**Export**:
A view of the Explorer as a file a reader asks for (CSV, or the chart as a picture), made by one
function that asks the rights gate first. Not a Twin: it is of a view, not of an address's answer.
_Avoid_: Download (the act, not the thing), dump

**Twin**:
The same answer a page shows, in a machine-readable form at the same address with a file suffix.
_Avoid_: Export, endpoint

**Saved query**:
An Explorer view kept with a Pin and a note.
_Avoid_: Bookmark, notebook
