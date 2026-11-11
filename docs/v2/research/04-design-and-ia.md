# 04 · Design direction and information architecture

Research and proposal for Macro Atlas v2. Written 2026-11-11 against `docs/v2/BRIEF.md`, the v1 code
(`atlas/`, `web/`, `docs/v2/SPEC-v1.md` section 6) and the sibling design system in
`~/Developer/mission-dashboard/DESIGN.md` and `PRODUCT.md`. Motion and polish follow the Emil Kowalski
design-engineering skill. This is a proposal for planners; nothing here is decided until Gate 1.

---

## 0. The proposal in one page

**Organizing idea: the Report and the Ledger.**

- **The Report** is the annual-report half: one *Edition* per year (plus the current *Living edition*),
  read top to bottom like Bagby's book or the USAFacts 10-K. It has a letter, highlights, three
  separate statements, segment reports, risk factors and notes. It is written, dated and signed.
- **The Ledger** is the living half: topic pages, the multi-series Explorer from v1, the Claims file,
  the Events timeline and the Data hub (one page per series, with provenance, downloads and API).
- **Every number in the Report is a link into the Ledger.** Click a figure in the Highlights and you
  land on that series in the Explorer, scoped to the Edition's period and data vintage. Provenance is
  the navigation, not just a footnote.

**What makes it more than a dashboard** (from the brief: check claims, see interactions instead of
single causes):

1. **Claims** get a page each: the exact quote, who said it and when, the claim's own window and
   definition, the evidence chart pre-loaded, and a *finding* with written reasons, in the same way
   /missions shows a Status with its reasons and confidence.
2. **Window sensitivity**: any "X rose/fell N% since Y" can be re-run across every reasonable start
   and end month, so a cherry-picked window is something you can see.
3. **"What else moved"**: a stacked small-multiples view on one shared time axis (the /missions
   "summary plot" idea applied to macro series) that puts the series a single-cause story leaves out
   next to the one it picked.
4. **Honest data states**: preliminary, revised, estimated, interpolated, discontinued and missing
   are each drawn differently and named in words. Where the source publishes a range (sampling error,
   projection ranges), the range is drawn.

**Visual family**: /missions' "Summary Plot" system unchanged where it applies: white ground,
near-black ink, hairlines, 2px ink rule above each panel, uppercase panel labels, system sans with
tabular figures, Plot Navy as the only interactive hue, flat at rest. Macro Atlas adds a data-series
palette that avoids navy, a statement-table style, and possibly a serif reserved for signed prose
(open question).

**Motion**: almost none. Charts never animate their data. Drawers, sheets, tooltips and
press feedback get short custom-eased transitions; keyboard actions get none.

---

## 1. Research

### 1.1 Bagby's *Annual Report of the United States of America*

What could be verified online (Alex's own copy is the better source; see open question Q1):

- **The First Annual Report of the United States of America**, Meredith E. Bagby, HarperBusiness,
  ISBN 0-88730-775-2. Open Library dates it 1995 with 77 pages; one catalog lists a 1994 HarperCollins
  printing. Bagby started the project as a Harvard undergraduate. The brief's "1999" is probably a later
  edition; editions followed yearly (1996 HarperCollins, 83 pp; 1997, 123 pp; 1998 McGraw-Hill, 144 pp).
- Library subjects for the first edition: public finance, economic conditions, social conditions,
  and **a directory of legislators**. That last one matters: Bagby's "Officers and Directors" were
  Congress, as in a corporate report.
- The 1998 edition's contents, per Google Books, open with **"A Letter to the American
  Shareholders"**, then **"Who We Are"**, then **"Financial Highlights"**. Its blurb describes the
  book as treating the United States as if it were a corporation and giving taxpayers, as
  shareholders, the annual report they are owed but never get. Topics run from AIDS research to the
  deficit.
- No full table of contents was found online. The task framing ("income statement, balance sheet,
  segment reports, risk factors") describes standard corporate-report sections. *Risk factors* and
  *segments* are certainly in the USAFacts 10-K (below). Whether Bagby used each of those headings
  should be checked against Alex's copy before the site quotes her structure.

**What the framing gives a living site:**

| Annual-report device | What it does for the reader | Macro Atlas use |
|---|---|---|
| Letter to shareholders | A human voice that says what mattered this year | A signed, dated *Letter* per Edition, labeled as opinion |
| Who we are | Scale and composition before money | *Who We Are*: population, households, workforce, geography, the "denominators" |
| Financial highlights | 1-page scoreboard, year over year | *Highlights*: 1/5/10-year change table, every cell linked |
| Statements | Hard accounts with fixed definitions | Three separate statements (see 3.3), not one blended balance sheet |
| Segment reports | Parts of the enterprise judged separately | Six segment chapters (Economy, Markets, Infrastructure, Governance, Disasters & health, World) |
| Risk factors | Known threats stated in advance | *Risk factors*: dated, sourced, revisited the next year ("did it happen?") |
| Notes to the statements | Methods and caveats | *Notes*: definitions, breaks in series, revisions policy |
| Officers and directors | Who is accountable | *Governance*: who held which office when (v1 political bands, extended) |

**Where the framing misleads, and how to defuse it:**

- A country is not a firm. It has no profit, no single CEO and no shareholders who can sell.
  USAFacts says this outright in its "About this report". The site should too, once, on the Report
  landing page, and then not keep apologizing.
- A "letter from management" invites partisanship. Make the Letter **signed by Alex, dated, labeled
  "Opinion"**, and keep it the only place in an Edition where interpretation is unlabeled. Elsewhere,
  interpretation carries an "Interpretation" tag.
- A "net income" for the nation implies the deficit is the bottom line. Keep the federal
  operating statement strictly federal and put national output and wealth in their own statements.

### 1.2 Later works in the same vein

- **Mary Meeker, *USA Inc.* (2011)**: the federal government as a business, with an income statement,
  balance sheet and scenarios for returning to positive cash flow. Federal only, and it includes
  independent analysis and proposals.
- **Wharton, "USA 10-K: Why America needs an annual report" (2012)**: argued for a letter to voters,
  history, recent performance, MD&A, risks, related-party transactions, internal controls, auditor's
  report and officers' certifications, with a 7-page sample.
- **USAFacts Government 10-K** (since 2017, still published; a 2026 edition is listed). Founded by
  Steve Ballmer. The 2023 edition's structure (read from the PDF):
  - Opening **letter from Ballmer** addressing taxpayers as "shareholders in this democracy". He gives
    his own view on deficits, marks it as his own, then says "use the numbers here and decide for yourself".
  - **10-K data snapshot**: key metrics with 1-year, 5-year and 10-year change.
  - **Part I**: Item 1 (purpose and function of government), Item 1A **Risk Factors** (grouped as
    social, data and cybersecurity, strategic and operational; partly drawn from GAO's High-Risk
    list), Item 2 Properties, Item 3 Legal proceedings, Item 6 Selected financial data,
    Item 7 **MD&A** with key metrics by segment.
  - **Part II**: Item 7A market risk (including sovereign credit), Item 8 **financial statements**,
    Item 9A controls and procedures.
  - **Part III**: officers, compensation, related parties; exhibits.
  - **Four segments taken from the Constitution's preamble**: Justice and Domestic Tranquility,
    Common Defense, General Welfare, Blessings of Liberty. Expenditures and key metrics are reported
    by segment; revenues are not.
  - Federal, state and local combined. It says plainly that state and local data lag about three
    years. Exhibit 99.09 compares itself with Treasury's *Financial Report*, *USA Inc.* and the Wharton
    proposal.
  - Companion products: **State of the Union in Numbers** (data organized around the topics a
    President will address) and **America in Facts**.
- **Treasury, *Financial Report of the United States Government*** (annual, GAO-audited, accrual
  basis, federal only), with a short *Citizen's Guide*. This is the real federal balance sheet and
  the right primary source for that statement.

**Lessons for Macro Atlas:**

1. The **1/5/10-year change table** is the most reusable device in the genre. It is compact, neutral
   and comparable across topics. It becomes the Highlights page and the header of every topic page.
2. **Name the lag.** USAFacts is upfront that some data is three years old. Macro Atlas should show
   each figure's reference period and release date next to it, not in a footnote.
3. **Segments organize; they don't judge.** USAFacts chose the preamble so the taxonomy can't be
   called partisan. Macro Atlas's segments are economic and physical rather than constitutional, but
   the principle stands: the taxonomy should be dull and defensible.
4. **Risk factors should be revisited.** Neither USAFacts nor Bagby looks back at last year's risks.
   A living site can: each risk carries the year it was raised and a short "what happened" note in
   later Editions.
5. **The opinion stays in the letter.** Ballmer's letter shows how: opinion stated as opinion, then
   handed back to the reader.

---

## 2. Who it is for and what each page is for

From the brief: primarily Alex, for research and for checking claims against the data. Secondarily
anyone, and machines (LLM and ML use through bulk downloads and the API).

| Job | Where it happens |
|---|---|
| "What state is the country in?" | Home → Living edition → Highlights |
| "Is what this politician said true?" | Claims (search by quote, person, topic) |
| "What was going on around that time?" | Explorer with event and claim layers; Compare ranges |
| "Why did X happen?" (and resisting the easy answer) | Topic page → "What else moved" and "Competing explanations" |
| "Where does this number come from?" | Series page in the Data hub |
| "Give me the data" | Data hub downloads, API, possibly MCP |

The home page's job is to answer the first row in under ten seconds and route to the others.

---

## 3. Information architecture

### 3.1 Site map and URLs

All under `mydashboards.co/macro-atlas` (staging `/macro-atlas-staging`; Next.js `basePath`).

```
/                                   Home: Living edition cover + search
/report                             Living edition (current year to date)
/report/2025                        A frozen Edition
/report/2025/letter
/report/2025/highlights
/report/2025/statements/federal     Federal operating statement and balance sheet
/report/2025/statements/national    National accounts: output, income, household wealth
/report/2025/statements/external    External position: trade, current account, IIP
/report/2025/segments/<segment>     Segment chapter
/report/2025/risks
/report/2025/notes
/topics/<topic>                     Living topic page (e.g. /topics/inflation, /topics/freight)
/explore?s=cpi_yoy,unrate&from=2019-06&to=2022-06&mode=z&layers=events,claims
/compare?s=spx,unrate&a=2008-09&b=2020-03&anchor=event&span=36
/claims                             Claims file (search, filter by person, topic, finding)
/claims/<slug>
/events                             Events timeline
/events/<slug>
/data                               Data hub: catalog, search, bulk downloads, API docs
/data/<series-key>                  Series page: chart, metadata, provenance, vintages, download
/api/v1/...                         Read API (separate research doc)
/about                              Method, sources, what this is not
```

- **Edition context travels.** A link from `/report/2025/...` into the Explorer carries
  `&edition=2025-v1.0` (Edition and immutable version, so a later correction never changes what an
  old link shows), which pins the data to that version's snapshot and shows a thin banner:
  "Viewing data as in the 2025 Edition. [Show today's figures]".
- **Short, stable URLs.** Series keys (v1's `cpi_yoy`, `unrate`) are the public identifiers. They
  never change. Renames get a redirect entry in the catalog.
- **v1 links**: v1 state lives in the URL hash (`#sel=spx,unrate&mode=z&from=…`). A small client
  shim on `/explore` reads a v1-style hash and rewrites it to v2 query parameters, so old shared links
  keep working once GitHub Pages redirects to v2.

### 3.2 Navigation

- **Top bar** (same height, type, sticky-from-768px behaviour and blur as /missions; contents are
  Macro Atlas's own, since /missions' bar holds Status filters, a UTC clock and source dots): page
  name left with the Edition or topic as a breadcrumb, search from 1024px, Data-freshness dots and the
  Dark toggle right.
- **Primary tabs** (set like /missions' tab bar: 14px, navy 2px underline on the selected tab):
  **Report · Topics · Explore · Claims · Events · Data**. Six, grouped by job; the six segments are
  chapters inside Report and groupings inside Topics, not a second navigation system.
- **Search** (`/` focuses it; /missions uses `/` for its Fleet search, so the key means "search"
  in both) covers series, topics, events, claims and people in
  one list, grouped by kind, keyboard-first. It opens without animation (it is used dozens of times a
  session).
- **Within a Report Edition**: a left table of contents from 1024px (sticky; current section
  highlighted), a "Contents" sheet on phones. Previous/next at the foot of each section.

### 3.3 The Report

Each Edition has:

| Section | Content | Notes |
|---|---|---|
| Cover | Year, cutoff date, one-line summary, links to every section | The Living edition's cover is the home page |
| Letter | Alex's signed, dated letter | Marked "Opinion". The only unlabeled interpretation in an Edition |
| Who We Are | Population, age structure, households, labor force, regions | The denominators every other page divides by |
| Highlights | 1/5/10-year change table, about 30 rows across segments | Every cell links to the Explorer at that window |
| Federal statement | Receipts, outlays, deficit (fiscal year, cash basis, Monthly Treasury Statement); debt held by the public; accrual balance sheet from Treasury's *Financial Report* | Label FY vs CY, cash vs accrual, stock vs flow on every table |
| National statement | GDP and components, income, household net worth (Fed Z.1) | Real and nominal side by side; per capita on a toggle |
| External statement | Trade balance, current account, net international investment position (BEA) | Kept separate from federal debt on purpose |
| Segment reports | Economy & jobs · Markets & money · Infrastructure · Governance & politics · Disasters & health · The US in the world (G20) | Each: key metrics strip, 2–4 charts, MD&A-style text, notable events |
| Risk factors | Dated risks with sources (GAO High-Risk list, CBO long-term outlook, FEMA, etc.) | Each later Edition adds "What happened" to earlier risks |
| Notes | Definitions, series breaks, revisions policy, sources | Generated from the catalog plus hand-written notes |

**Why three statements, not one balance sheet.** Federal accounts, the national economy and the
country's position against the rest of the world describe different entities. Putting federal debt,
household wealth and the IIP on one "balance sheet" invites a reconciliation that doesn't exist. Three
statements, each with its own entity, basis and period in its header, keep the annual-report feel
without the false accounting.

**What "frozen" means.** An Edition is reproducible:

- a **reporting period** (calendar year, or fiscal year for federal tables, each labeled);
- a **cutoff date** after which no data enters;
- a **pinned data snapshot** (the build commit and data-file hash, shown in Notes);
- **immutable versions**: a correction publishes Edition 2025 v1.1 with a dated note; v1.0 stays
  reachable at its own URL, so "as published" remains reproducible. Never a silent change.

**Vintages are limited by what exists.** A cutoff and a hash pin what Macro Atlas *had*; they cannot
reconstruct what a source *said* on a date unless that source keeps vintages (ALFRED does for FRED
series; most others do not). So:

- Editions built going forward (cutoff after the site goes live) are true "as published" records,
  because the site's own daily snapshots are the archive.
- Editions built retroactively (the first one, 2025, and any back-filled years) are labelled
  "compiled 2026 from data as revised to that date". Their "as first reported" view exists only for
  series with archived vintages; everywhere else the toggle shows a **"vintage unavailable"** state
  rather than quietly showing revised data.

A chart in an Edition has up to three views: **"As in this Edition"** (the pinned snapshot, the
default), **"As first reported"** (each month's first release, where vintages exist; this can differ
from the Edition if a revision landed before the cutoff), and **"Today's estimate"**. When they
differ, the difference is drawn (see 4.5).

**Living edition**: same structure, updated daily, with "Year to date" periods and an "as of" date
on every figure. It becomes the frozen Edition once its cutoff passes and Alex signs the Letter.

### 3.4 Topic pages (the living layer)

A topic page is the Ledger's main unit: `/topics/inflation`, `/topics/housing`, `/topics/grid`,
`/topics/freight`, `/topics/g20-growth`. Layout, top to bottom:

1. **Header**: title, one-sentence definition, the 1/5/10-year change strip for the topic's 3–6 key
   series (same component as Highlights).
2. **Main chart**: an Explorer view pre-configured for the topic, with an "Open in Explorer" link that
   carries the state.
3. **What else moved**: the stacked small-multiples view (4.4) with the topic's usual companions
   (e.g. inflation: energy, shelter, wages, money supply, import prices, inflation expectations).
4. **Competing explanations**: a curated, sourced list of the explanations people give, each with
   the evidence for and against and links to charts. No winner is declared unless the evidence is
   lopsided; then the reasons are given.
5. **Claims about this topic**: the latest claims with their findings.
6. **Events**: the topic's events, on the shared axis.
7. **Series in this topic**: the catalog rows, each linking to its Data hub page.

Topics come from the catalog (`topic:` tags) and short Markdown files with front matter for the
written parts, matching the brief's "data in" rule.

### 3.5 Explorer

v1's Explorer, kept and hardened (4.1). It is the workbench: every other page deep-links into it.

### 3.6 Claims

The Claims file is the brief's "check what politicians and pundits claim". Each claim is a YAML or
Markdown file:

- **Quote** exactly as said, **speaker**, **date**, **venue**, **link to the primary source**
  (transcript, video timestamp, post).
- **What it would mean in data**: the series, definition, window and comparison the claim implies,
  written by the editor. When the claim is ambiguous ("prices", "jobs"), list each reasonable reading.
- **Evidence chart**: an Explorer state, pinned to the data vintage available on the claim date and
  to today's data, with the claim's window highlighted.
- **Window sensitivity** (4.6), when the claim states a change.
- **Finding**, from a small fixed vocabulary, always with written reasons and a confidence:

  | Finding | Meaning |
  |---|---|
  | Consistent with the data | Holds under the stated reading and reasonable alternatives |
  | Depends on the reading | True under some reasonable definitions or windows, false under others |
  | Selective | True as stated but only in a chosen window, measure or subset; the broader picture differs |
  | Contradicted by the data | The data contradicts it under every reasonable reading |
  | Not enough evidence | The data exists but is too noisy, too short or too revised to say |
  | Can't be checked with free data | Says what data would be needed |

  This mirrors /missions' Status vocabulary: a small set of verdicts, each with reasons,
  the threshold applied and a confidence. It avoids the truth-o-meter feel: no gauge, no
  "Pants on Fire", no colour scale from green to red. Findings are shown as a word with a silhouette
  icon (three channels, as on /missions), in neutral ink, never in party colours.
- **Contrary evidence** and **what would change the finding**.
- **Accountability fields** (required in the file schema; `atlas check` fails without them):
  assessor (named), assessment date, data snapshot used, and a review note. A "Report an error" link
  on every claim page opens a prefilled GitHub issue (no runtime service needed).
- **History**: dated edits to the finding, visible to readers.
- **Selection note** on the Claims index: how claims are chosen ("claims Alex encountered and wanted
  to check"), so the file is not read as a balanced sample of either party.

### 3.7 Events

v1's 83 cited events, extended with `end` dates (wars, shutdowns, pandemics are spans), `topics`,
`magnitude` where measurable (disaster cost, deaths) and the existing citation. Each has a page that
shows it on the topic charts it touches. Events are context, not causes: an event page never says
"caused", it lists what moved around it (4.4) and cites analyses that make causal claims.

### 3.8 Data hub

The provenance page for every series, and the home for downloads and the API:

- Chart (full history), latest value with reference period and release date.
- **Provenance block**: source agency, dataset, series ID, URL, licence, units, seasonal adjustment,
  frequency, transform applied (v1's `agg`, `yoy`), fetch time, staleness rule, and the
  `atlas check` result.
- **Breaks and notes**: methodology changes, rebasings, discontinuities (drawn on every chart as a
  break marker).
- **Vintages** where available (ALFRED for FRED series): a list of releases and how much each
  revised.
- **Download** (CSV, Parquet, JSON) and an API example, with a citation string.
- Catalog page: search, filter by topic, source, frequency, country; bulk download.

---

## 4. Key interactions

### 4.1 The multi-series Explorer (kept from v1, hardened)

**Kept:** series picker (grouped, searchable), up to 8 series, scale modes (rebase, z-score, raw,
log, y/y), range selects, presets, recession and term bands, event markers, correlation matrix,
pairwise scatter with lag slider, lag-correlation bars, rolling correlation, snapshot table, CSV/PNG
export, shareable URL state.

**Changed:**

| v1 | v2 | Why |
|---|---|---|
| State in URL hash | Query parameters (server-rendered, shareable, crawlable); v1 hashes rewritten | Server app; link previews work |
| Any series can take y/y | Valid transforms declared per series in the catalog (no y/y of a rate already in %; no log of series that cross zero) | Stops meaningless views |
| `spanGaps: true` | Gaps drawn as gaps; forward-filled quarterly/annual values drawn as steps with dots at observations | Shows what was actually measured |
| Raw mode puts mixed units on a right axis | Mixed units default to small multiples, or to the per-series alignment rule of 4.3 (rebase only positive levels; pp difference for rates; unit difference for series that cross zero); dual axis is opt-in with a warning chip | Dual axes make any two lines look related |
| p < 0.05 hint on correlations | Show *n* and the effective sample after autocorrelation; on the lag chart, note that the best of 49 lags will look significant by chance | Lag-hunting is a multiple-comparisons trap |
| Chart.js canvas | SVG (custom, like /missions, or a thin library) with an accessible data table | Accessibility, crisp print, consistent with the family |
| Correlation basis "monthly % changes" for every series | Rates and shares in % use first differences (pp), not % changes; levels basis carries a "trending series correlate by default" note | % change of a rate is meaningless near zero; trends inflate r |
| Mixed frequencies aligned by forward-fill | Correlations and scatter use the coarsest common frequency (aggregate monthly to quarterly), never forward-filled months | Repeated filled values fake agreement |
| Correlation colours blue/red | Diverging scale that avoids navy and party red/blue | One interactive hue; no partisan reading |

**Readout, not tooltip.** The crosshair value readout is pinned in a strip above the plot (values for
every series at the cursor month, tabular), not a floating tooltip. It never covers the lines, works
the same on touch (scrub), and has a fixed layout so numbers don't jump.

### 4.2 Annotation layers

One "Layers" control on every chart, with the same list everywhere:

| Layer | Mark | Default |
|---|---|---|
| Recessions (NBER) | Grey band | On |
| Events | Vertical tick on the baseline; full-height dashed line when the span is ≤ 11 years (v1 rule) | On |
| Claims | Small speech-mark tick above the plot at the claim date; its window as a bracket | On in Claims and topics, off in Explorer |
| Governance | Bands: President, House and Senate control, Fed chair (v1 `politics.yaml`) | Off |
| Policy | Spans for laws and programmes in force (IIJA, CHIPS, ARRA, CARES…) | Off |
| Data notes | Break markers, revisions, preliminary periods | Always on (cannot be turned off) |

Density rules: labels appear only for the hovered/focused or pinned annotation; others are ticks.
Hovering a tick shows its title in the readout strip, not a popover. Clicking pins it (v1's
highlight behaviour) and links to the event or claim page. Layers are in the URL.

### 4.3 Compare ranges

v1 has a two-range comparison with a "2008 vs 2020" preset. v2 generalizes it:

- Pick 2–4 episodes. Each needs an **anchor**: an event date, a recession start, a series peak or
  trough, or a month typed in.
- Plot months relative to the anchor (t = 0) on a shared x-axis ("months from anchor"), one colour
  per episode. Each series is aligned by the rule its catalog entry declares: positive levels
  (prices, indices, output) rebased to 100 at t = 0; rates and shares (unemployment, yields,
  inflation) as the percentage-point difference from t = 0; series that can be zero or negative
  (balances, net flows) as the raw difference in their unit. The y-axis title states which.
- **Disclose the calendar**: the readout shows the real month for each episode at the cursor
  ("t+6: Mar 2009 · Sep 2020"), and a strip under the plot shows each episode's own Events layer, so
  the reader sees that the episodes did not happen in the same world (rates, policy, demographics).
- Presets: recessions since 2000; oil shocks; Fed hiking cycles; pandemics/disasters.
- Phone: episodes stacked as small multiples instead of overlaid (4.8).

### 4.4 Views that resist one-cause stories

The brief asks to see complex interactions rather than overly simple cause and effect. The site
should **make the second and third factor visible**, and **never draw a causal arrow it can't source**.

1. **What else moved** (signature view). Pick a focus series and window; under it, a stack of
   small multiples on one shared time axis: the usual companions for that topic, plus anything whose
   change in the window was unusually large for that series (computed as a z-score of the window's
   change against its own history). This is /missions' summary-plot idea (instrument panels stacked
   under one time axis) applied to macro data. Each row carries its value text beside the plot.
   The page names its rule ("rows sorted by how unusual their move was in this window"). It does not
   claim the rows caused anything.
2. **Accounting decompositions, labelled as accounting.** Where the source publishes a decomposition
   (BEA contributions to GDP growth, BLS CPI relative-importance contributions, Treasury
   receipts by source), show it as stacked contributions. Label it "accounting identity: shows
   composition, not causes".
3. **Competing explanations** (topic pages, 3.4). A curated list of hypotheses with the evidence for
   and against each, citing studies. A claim that a single factor caused an outcome links here.
4. **Lead and lag, with guard rails.** The scatter-with-lag view stays, with the multiple-comparisons
   note, the effective *n*, and a "same chart, other window" link so a reader can see whether a
   relationship survives outside the chosen period.
5. **Global context.** Most US moves have a G20 counterpart. A "US vs peers" toggle on any
   comparable series (inflation, unemployment, policy rate, GDP growth) draws the G20 range as a
   band with the US line on it. "Inflation rose because of policy X" looks different when every peer
   saw the same rise. Harmonized definitions matter here: use OECD/IMF harmonized series for the band,
   and say when a country's definition differs.

Deferred (needs a stated model before it can ship): **counterfactual baselines** (pre-event trend
extrapolation, CBO baseline vs actual). A projection band without its model and assumptions on the
page would be the kind of spin the site exists to check. When added, the baseline must name its
source (e.g. "CBO January 2020 baseline") rather than be computed by the site.

### 4.5 Uncertainty and revisions, shown honestly

Data states, each with a distinct mark **and** a word in the readout (three channels, per /missions):

| State | Mark on a line chart | Word |
|---|---|---|
| Final / latest | Solid line | (none) |
| Preliminary / advance estimate | Last segment dashed, end point open circle with a small "p" | "preliminary" |
| Revised since first print | Small tick under the point; readout shows first print and change | "revised +0.3" |
| Estimated / nowcast | Dotted, in ink-3 | "estimate" |
| Interpolated / forward-filled | Step line, dots only at real observations | "carried forward from Q2" |
| Stale (source stopped updating) | Line ends; "to 2021-06" label (v1 rule) | "series ends 2021-06" |
| Missing | Gap | "no data" |
| Break in series | Vertical hairline break marker with a note | "method change" |

Preliminary (a new estimate that will be revised) and stale (a source that stopped) are different
states and must not share a mark. /missions uses a hollow point for stale; here hollow-with-"p"
means preliminary, and stale gets a line end and a label. This is a deliberate local rule, written
into Macro Atlas's DESIGN.md so nobody "fixes" it to match /missions.

**Ranges where the source gives them**: BLS payroll sampling error (the 90% interval BLS publishes for the monthly change), CPS
unemployment confidence intervals, CBO projection ranges, Census survey margins of error. Drawn as a
pale band (the /missions Expected-Lag band colour) with its definition in the readout.

**Revision views** (FRED series via ALFRED first):

- **Revision strip** under a chart: one tick per release month, height = size of revision.
- **"As first reported" toggle**: draws the first-print line beside today's line.
- **Claim-date vintage**: a claim's evidence chart can show what the data said on the day the claim
  was made, which is fair to the speaker, alongside today's data.

Phasing: v2.0 ships the state marks, breaks, and the "as first reported" toggle for a short list
of headline series (payrolls, GDP, CPI, unemployment). Full vintage browsing is later.

### 4.6 Window sensitivity (claims and Highlights)

For any statement of the form "X changed N% between A and B": a small heat-strip of the same
statistic for every start month (rows) and end month (columns) within a reasonable radius
(±24 months by default), with the claim's own cell outlined. Windows shorter than a minimum
(12 months, or 4 observations for quarterly data) are blank, and cells whose endpoints have missing
data are hatched, not computed. The view shows **how much the number depends on the endpoints**, not
whether the speaker chose them on purpose: the caption says "The stated direction holds in N of M valid
nearby windows; the stated size (within ±25% of the claimed figure, or the claim's own rounding if
wider) holds in K of M", where M counts only valid windows, and nothing about intent. A claim whose number holds only in a narrow band may earn
the "Selective" finding, but that is the assessor's written judgment, not the chart's. Highlights get a simpler form: each 1/5/10
change shows a tiny sparkline of the rolling change, so a reader sees whether "+5-year" is typical.

### 4.7 Every figure is a door

Any number on any page (Highlights cell, statement row, topic header) opens a small panel on click
with: value, unit, reference period, release date, source, data state, and three links: "Open in
Explorer", "Series page", "Copy citation". On desktop it is a popover anchored to the number; on
phones a bottom sheet.

### 4.8 Search and keyboard

- `/` search; `Esc` closes any overlay and returns focus to its trigger.
- Explorer: `←`/`→` move the crosshair a month, `Shift` a year, `Home`/`End` to range ends; `[` `]`
  step through events; `l` opens Layers. No animation on any keyboard action.
- Tables (statements, Highlights) use roving focus (`useRovingFocus` exists in /missions).

---

## 5. Visual design and the relation to /missions

### 5.1 Shared with /missions (take the tokens as-is)

From `mission-dashboard/DESIGN.md` and `src/app/globals.css`:

- **Colours**: void/panel `#ffffff`, raised `#f2f5f8`, line `#dde3ea`, line-strong `#b4bfcc`,
  ink `#111418`, ink-2 `#434d5b`, ink-3 `#5b6676`, accent (Plot Navy) `#2f5e95`, band `#d3e2f2`, and
  the dark theme set unchanged.
- **One interactive hue**: Plot Navy marks links, focus, selected tabs and active filters only.
- **Panels**: no cards, no boxes; a 2px ink rule on top, uppercase 13px/700 panel label with 0.06em
  tracking, a 12px ink-3 provenance line under it ("Source: BEA NIPA Table 1.1.5 · Q3 2026 advance").
- **Type**: system UI sans, tabular figures on, 14px body, 12px minimum, monospace only for raw
  source IDs and API examples.
- **Flat at rest**; shadows only on drawers, popovers and sheets.
- **4px corners** on controls, none on panels.
- **Theme**: light default, `?theme=dark` and a Dark toggle in the top bar (/missions' rule, which
  ignores the OS setting; see Q5, because v1 follows the OS).
- **Shared shell**: same top-bar height, same tab-bar style, same skip-link box, same focus outline
  (2px navy at 2px offset). A reader moving between `/missions` and `/macro-atlas` should feel they are
  on the same site. A small "mydashboards" home link in the corner of both would make it explicit.

The cleanest way to keep these in step is a shared tokens file (CSS variables) that both apps copy
from one source. Copying is fine for now; a shared package is premature with two apps.

### 5.2 Added for Macro Atlas

- **Series palette**: Okabe–Ito based, 8 colours, none close to Plot Navy, checked for colour-vision
  deficiency and for ≥3:1 against white and the dark panel. /missions already uses Okabe–Ito blue
  (`#0072b2`) for a publication category, so the family is consistent. Line style (solid, dashed,
  dotted) is a second channel, and each line is labelled at its right end, so colour is never the only
  key.
- **No party colours for data.** Red/blue only appear in Governance bands, and there as muted tints
  with the party name written in the band. Findings, correlations and change tables never use
  red/blue.
- **Change colours**: none by default. "Up" is not good and "down" is not bad (unemployment, debt,
  prices). Change is shown with a sign and an arrow glyph in ink. A series can declare a direction
  ("higher is better") in the catalog to enable a muted tint, used sparingly.
- **Statement tables**: financial-report setting. Right-aligned tabular figures, units in the column
  header ("$ billions, FY"), hairline rules every row, a 2px ink rule above totals, negatives with a
  true minus sign (not parentheses, which general readers misread), and a "Note n" link column.
- **Signed prose** (Letter, segment MD&A): 65–70ch measure, 16–17px. Whether it is set in the system
  sans or a serif (v1 used Newsreader for its title) is Q4. A serif for signed prose only would mark
  "this is a person writing" against "this is data", which suits the annual-report frame. It would be
  a deliberate departure from /missions' Typography section, which requires one sans and no display
  face; if chosen, record it as a named local rule in Macro Atlas's DESIGN.md.

### 5.3 Charts

- SVG, drawn by the app (as /missions draws its strips and maps), each chart with a hidden data
  table and a one-sentence generated summary for screen readers.
- Axis labels in ink-3 12px; gridlines line at 70% alpha; zero line in ink when meaningful.
- Line width 1.75px; the hovered or pinned series goes to 2.5px. Other lines dim only as far as they
  keep 3:1 against the ground (in practice about 60% opacity for the palette; checked per colour),
  so de-emphasis never makes a line unreadable.
- End labels for each line instead of a legend box where space allows; legend row with × to remove
  (v1) on narrow widths.
- Print stylesheet for the Report: one Edition prints as a clean PDF (annual reports get printed).

---

## 6. Motion and polish (Emil Kowalski's rules applied)

The product is a reading and research tool used many times a day by its main user. Per the skill's
frequency table, that means **almost no motion**, crisp and fast where there is any, and every
animation must have a purpose.

| Element | Frequency | Decision | Values |
|---|---|---|---|
| Chart data (add series, change range, change mode) | Constant | **No animation.** Functional graph; redraw instantly | — |
| Crosshair / readout | Constant | No animation; numbers in tabular figures so nothing shifts | — |
| Keyboard actions (search open, arrow scrub, `[` `]`, Esc) | Constant | **Never animate** | — |
| Search palette open | Dozens per session | None (Raycast rule) | — |
| Hover on rows, ticks, links | Constant | Colour only, gated by `(hover: hover) and (pointer: fine)` | `ease`, 120ms, colour/opacity only |
| Button / chip press | Often | Press feedback | `transform: scale(0.97)` on `:active`, 120ms `ease-out` |
| Figure popover (4.7) | Occasional | Scale from the number, not the centre | 150ms, `cubic-bezier(0.23, 1, 0.32, 1)`, from `scale(0.97)` + `opacity: 0`, `transform-origin` at trigger |
| Tooltips (help icons) | Occasional | Delay on first, instant on subsequent | 125ms in; `data-instant` skips |
| Drawers and bottom sheets (series picker on phone, Contents, figure sheet) | Occasional | Slide from their edge; exit faster than enter | Enter 240ms `cubic-bezier(0.32, 0.72, 0, 1)`; exit 180ms; `translateY(100%)` not px |
| Highlighted series (others dim) | Often | Opacity crossfade so the change reads as one state | 150ms `ease` |
| Pinned event flag | Occasional | Fade only | 120ms |
| Layer toggle | Occasional | Fade the layer in/out (prevents a jarring pop of 80 ticks) | 150ms opacity |
| Copy link / download | Occasional | Button label morphs to "Copied" with a 2px blur crossfade | 200ms |
| Route change | Often | None, or the View Transitions API crossfade at ≤150ms on Report section changes only | — |
| Report cover on first visit | Rare | The one place for a little delight: Highlights rows fade up with 40ms stagger, never blocking input | 250ms `ease-out`, 8px |

Rules:

- **Movement uses only transform and opacity.** Never animate width, height, layout or SVG path
  data. Colour fades on hover and the small blur on the "Copied" label are the only other animated
  properties, and only on small elements.
- **CSS transitions, not keyframes**, for anything that can be retriggered (layers, highlight), so
  they retarget mid-flight.
- **No motion library** needed. /missions ships none; CSS transitions plus `@starting-style` for
  entries cover everything above. Add Motion only if drag-to-dismiss sheets need springs and
  velocity, and then only for that.
- **Reduced motion means less, not none.** /missions sets every transition to 0.01ms under
  `prefers-reduced-motion`. Macro Atlas should keep opacity and colour fades (they aid comprehension)
  and remove only movement: sheets fade instead of slide, the cover stagger is removed.
- **Unseen details** worth the effort: the readout strip never changes height; tabular figures
  everywhere; skeletons are the chart's own frame and axis, not grey boxes; a focus ring drawn inside
  SVG plots; an error state that names the source that failed ("FRED did not answer at 06:00 UTC;
  showing data fetched 2026-11-10"), never a blank panel; the scroll position restored on Back; the
  selected series kept when switching from Explorer to Compare.
- Review motion the next day and in slow motion before shipping (skill's debugging rules).

---

## 7. Accessibility

Working bar: **WCAG 2.2 AA** (one step above /missions' working bar of 2.0 AA, since this is public
and new). Specifics:

- **Every chart has a text equivalent**: a generated summary sentence ("CPI inflation, y/y, Jan 2019
  to Oct 2026: low 0.1% May 2020, high 9.1% Jun 2022, latest 2.9% Oct 2026, preliminary") and a
  "Show as table" toggle that renders the visible data as a real `<table>`.
- **Keyboard parity**: everything a pointer can do (scrub, pin events, choose series, set ranges,
  compare anchors) works from the keyboard (4.8). Range selection has two month inputs, not only a
  brush.
- **Three channels for states**: data states, findings and change direction are shape/mark + word +
  (where used) colour.
- **Contrast**: text ≥4.5:1 (tokens already meet this); series lines and meaningful marks ≥3:1;
  bands that fall below 3:1 carry no meaning on their own (as on /missions).
- **Focus**: visible 2px navy outline. Modal overlays (drawers, bottom sheets with a scrim) trap
  focus; non-modal popovers (figure panel, Layers) do not, close on Esc or outside click, and both
  kinds return focus to their trigger.
- **Targets**: at least 24×24px (2.2 minimum), 44px on touch layouts for primary controls.
- **Text**: 12px minimum, zoom to 200% without loss, reflow at 320px without horizontal page scroll.
- **Motion**: as in section 6.
- **Language**: plain-language definitions on every series and topic; jargon expanded on first use
  (`<abbr>` for CPI, IIP, NIPA).

---

## 8. Mobile

Alex studies on a laptop, but claims get checked on a phone (a link someone sent). Design each page
for phones from the start rather than shrinking the desktop.

- **Report**: single column; Contents as a sheet; statements scroll horizontally inside their own
  container with the label column sticky; Highlights collapse to label + latest + 1/5/10 changes,
  with sparklines hidden below 400px.
- **Claims**: the most phone-critical page. Quote, finding with reasons, then one evidence chart at
  full width, then window sensitivity. Everything else below.
- **Explorer**: chart full width, 300–340px tall; series picker as a bottom sheet (v1); a soft cap of
  4 series on phones with a note; range by presets plus two month inputs; readout strip above the
  chart; touch scrub with a long-press to pin. Correlation matrix and scatter stack under it.
- **Compare ranges**: small multiples (one episode per panel, shared y-axis) instead of overlays.
- **What else moved**: already a vertical stack; rows become full width with the value text above
  each strip, as /missions does for its age strips on phones.
- No hover-dependent information anywhere; hover is a shortcut for something a tap also does.
- Safe-area padding and `viewport-fit=cover` (v1 already does this).

---

## 9. Phasing (what v2.0 can promise)

Constrained by the brief: daily refresh, files not a database, no runtime AI.

| v2.0 | Later |
|---|---|
| Report shell with Living edition; first Edition (2025, compiled retroactively and labelled so) with Letter, Highlights, three statements, segments, risks, notes | Every year back to 2000 as Editions |
| Topic pages for a first set (inflation, jobs, housing, energy & grid, freight, federal budget, G20 growth) | Full topic coverage |
| Explorer at v1 parity plus the hardening in 4.1 | |
| Layers: recessions, events, governance, policy, data notes, claims | |
| Compare ranges with anchors | |
| What else moved (curated companions + unusual-move rows) | |
| Data states and breaks; "as first reported" for 4 headline series | Full vintage browsing (ALFRED and others) |
| Source-published uncertainty bands where available | |
| Claims file with findings, window sensitivity, claim-date vintage for the same 4 headline series | Claim-date vintage wherever archived vintages exist; claim submission form (behind login, with the in-browser editor) |
| Data hub series pages, downloads | MCP connector |
| US vs G20 peer band for harmonized series | Counterfactual baselines from named sources (CBO) |

Two of these rows are research work, not just UI, and should each get a spike with a go/no-go
before the milestone that builds them:

- **Vintages** (as first reported, claim-date vintage): confirm ALFRED coverage and rate limits for
  the 4 headline series; if coverage fails, ship the "vintage unavailable" state and keep the UI.
- **What else moved, unusual-move rows**: confirm the z-score rule gives sensible rows on 3 known
  episodes (2008, 2020, 2022) before exposing it; otherwise ship curated companions only.

Acceptance for each v2.0 page: works at 320px, keyboard-only, with a table equivalent for every
chart, with loading, error (named source) and empty states, and with every figure linking to its
series page.

---

## 10. Open questions for Alex

1. **Bagby's structure.** Online sources confirm "A Letter to the American Shareholders", "Who We
   Are" and "Financial Highlights", and a directory of legislators in the first edition. Could you
   check your copy's contents page (and its year: the first edition looks like HarperBusiness 1995,
   not 1999) so the site's Report mirrors her sections where they fit?
2. **The Letter.** Do you want to write and sign a Letter per Edition (opinion, labelled), or keep the
   site voice-free like USAFacts' body text?
3. **Claim findings.** Is the six-finding vocabulary right, or do you want evidence panels
   with no finding at all?
4. **Serif for signed prose?** System sans everywhere (strict family match with /missions), or a
   serif for the Letter and MD&A only?
5. **Theme rule.** /missions defaults to light and ignores the OS; v1 follows the OS. Match /missions?
6. **Segments.** Economy & jobs · Markets & money · Infrastructure · Governance & politics ·
   Disasters & health · The US in the world. Would you prefer USAFacts' constitutional segments, or
   another split?
7. **Shared shell.** Add a small "mydashboards" home link in both apps' top bars so the two read as
   one site?

---

## Sources

- Open Library, *The First Annual Report of the United States of America* (HarperBusiness, ISBN
  0887307752): https://openlibrary.org/isbn/0887307752
- Google Books, *Annual Report of the United States of America, 1998 Edition* (contents and blurb):
  https://books.google.com/books/about/Annual_Report_of_the_United_States_of_Am.html?id=hYZDqmMHKbUC
- Google Books, 1996 edition: https://books.google.com/books/about/Annual_Report_of_the_United_States_of_Am.html?id=MPfHPQAACAAJ
- Goodreads, 1997 edition: https://www.goodreads.com/book/show/1839485.Annual_Report_of_the_United_States_of_America
- USAFacts, 2023 Government 10-K (PDF; structure, segments, risk factors, Exhibit 99.09):
  https://media.usafacts.org/m/7e1413aafb7fc073/original/2023_10k.pdf
- USAFacts annual publications: https://usafacts.org/annual-publications/
- USAFacts 2022 10-K release: https://prnewswire.com/news-releases/usafacts-releases-2022-government-10-k-providing-americans-with-an-in-depth-look-at-the-nations-finances-301528051.html
- State of the Union in Numbers (2021): https://www.businesswire.com/news/home/20210217005915/en/USAFacts-Launches-its-Second-Annual-State-of-the-Union-in-Numbers
- Wharton, "USA 10-K: Why America needs an annual report" (2012): https://knowledge.wharton.upenn.edu/article/usa-10-k-why-america-needs-an-annual-report/
- Treasury, *Financial Report of the United States Government*: https://www.fiscal.treasury.gov/reports-statements/financial-report/
- ALFRED (FRED vintages): https://alfred.stlouisfed.org/
- Sibling design system: `~/Developer/mission-dashboard/DESIGN.md`, `PRODUCT.md`, `src/app/globals.css`
