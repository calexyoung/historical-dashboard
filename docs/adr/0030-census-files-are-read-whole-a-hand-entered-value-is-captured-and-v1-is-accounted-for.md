---
status: accepted (M16, 2026-11-12); commits no Census data and no hand-entered value (D2 is open, no row is signed)
---

# Census files are read whole, a hand-entered value is captured like any other, and every series of v1's is accounted for

M16 closes the question M12 opened ("what happens to each of v1's 126 series"): Census files
for the headline construction, retail and housing series, a `manual` adapter for figures that
are entered by hand with a citation each, no adapter for an intermediary Channel because none
is cleared, and a report that accounts for every one of v1's series. The plan's acceptance:
"every one of v1's 126 series is accounted for as live from origin, live via a cleared channel,
or withheld (reason); the comparison table is attached with every difference explained; the
public release holds only allowlisted series". The rules are in `docs/method/capture.md` and
`docs/method/catalog.md`; the account is `docs/v2/v1-coverage.md`; the comparison is
`docs/v2/v1-overlap.md`.

## Decisions

1. **Census figures are read from two kinds of published file, with no key.** The Bureau's
   data API has wanted a key since 2026 (research 02) and its terms add an API notice; the
   register's proposal for the `census` row was written for published files. Three flat files
   of the Economic Indicators (`census_eits`: retail and food services sales, housing starts,
   the monthly balance on goods and services) and one workbook of the construction release
   (`census_c30`: total, private and public construction at a seasonally adjusted annual
   rate). The flat file for construction holds only unadjusted monthly totals (verified
   2026-11-11), which is why the headline rate needs the workbook. One reader per shape, as
   ADR 0027 decided for tables and packages; a third shape is a third reader.
2. **A series of a flat file is named by the Bureau's own codes, joined.** `44X72:SM:US:SA`
   is category, data type, geography and whether it is seasonally adjusted. The joining is
   Macro Atlas's; every part is the Bureau's. The file points from its data rows into tables
   of codes by index, and an index is a position that may change with the next file, so a
   series is found by code each time. The endpoint pins the words the file gives each code
   (the category, the data type and its unit, the geography): a code that comes to mean
   something else, or a unit that changes, stops the capture, as a Board label or an IMF
   reference period does. Only an estimate is read; a row of sampling error for the same
   month is passed over by its own column, not by luck.
3. **A series of the workbook is the heading of its column as printed, footnote number and
   all** (`Total Private Construction2`). Nothing in the workbook is a code. The title and
   the line on units are pinned, so the unadjusted workbook, or dollars in another multiple,
   cannot be read as this one.
4. **The century of a two-digit year comes from the day of the fetch, which is kept.** The
   workbook names its months `Sep-26p`. The newest row is the latest month of that name and
   year that had begun on the day asked (New York) and lies in the last fifty years; every
   row under it must be exactly one month earlier. The day asked is in the Capture's scope,
   so a replay in 2126 reads the file as it was read in 2026. A row for a month that had not
   begun makes the capture incomplete; a file whose newest month is old does not (that is
   staleness, which is not judged at capture).
5. **The Bureau's marks are the Status.** `p` is preliminary and `r` is revised in the
   workbook. The flat files mark nothing, so their values are `observed` and the advance
   retail estimate becomes a revision when the next file replaces it, as with the BEA.
6. **A zip is read in memory, one named member, under a size limit.** Both kinds of file are
   zips (an .xlsx is one). A member that says it is larger than the limit, or turns out to
   be, is not read; nothing is extracted to disk; a member name is never used as a path.
   The XML of the workbook is read by cell reference with the standard library.
7. **The monthly trade balance is the Census Bureau's Series.** The FT-900 release is
   compiled by the Census Bureau with the BEA; the file is the Census Bureau's and the
   `census` row is the one whose terms cover it. `trade` names the Census Bureau as its
   Origin. `trade_q` (M15) stays the BEA's quarterly balance.
8. **A hand-entered file goes through the capture kit.** The alternative was to read the
   files straight into a Release. Then a hand-entered value would have no retrieval time, a
   correction would overwrite what was shown, and the rights gate would have to be asked in a
   second place. Instead an endpoint on the Origin's row names the file; a live run reads it
   from the working tree (a request whose method is `READ`, which asks no one); the bytes are
   kept, logged and replayed like any answer; and the vintage store records a correction as a
   revision. Reading is behind the transport, so a replay answers from its recording and never
   looks at today's files. Only a file directly under `catalog/manual`, with a name of one
   shape, is ever read, and never through a link that leads out of that directory.
9. **The Channel is `hand_entered` and the Origin is whose record was read.** The gate
   already treats `hand_entered` as Macro Atlas's own route with no terms of its own (ADR
   0020), so what must be signed is the row of the record the figures were typed from: the
   Federal Election Commission for votes, and so on. The `manual` adapter and the
   `hand_entered` Channel go together in the register and neither goes with anything else.
   A captured hand-entered file is `real_bytes`: exporting it as a fixture needs
   `redistribute`, like any source's bytes.
10. **Every entry carries a citation, and a computed entry shows its working.** A citation
    says who published the record, what it is called, its address, the day it was read and
    where in it the figure is. The day read is not a retrieval time. An election margin is
    not printed by the record; the votes are. So an entry may give its `working` (the
    two-party margin of the two totals cited), and the value entered is held to it, at the
    decimals it is written with, a half away from zero. The working checks the value; it
    never replaces it.
11. **Per-value citations live in the file and in every Capture of it.** The parsed state
    carries each as a footnote. The vintage store keeps period, value and status and not
    footnotes (ADR 0022), so a Release does not yet show a citation beside a value; the
    series page's citation block (M17) is where that is drawn, from the kept bytes.
12. **No value is typed in ahead of a decision, and `atlas check` holds that.** The
    repository is public, so a committed hand-entered file is a public copy of what its
    Origin published. `atlas check` refuses a file under `catalog/manual` unless its Origin's
    row is signed for `store` and for `redistribute`, and refuses a file no endpoint reads.
    Today `catalog/manual` is empty, the register lists no `manual` endpoint, and `approval`,
    `pres_margin` and `house_margin` are drafts. The adapter is proved on invented files
    (`fixtures/manual`). This is stricter than the plan's wording needs: a signature on a row
    is still required, on top of the standing rule that nothing from an unsigned row is
    committed.
13. **A row is proposed for the Federal Election Commission.** ADR 0026 named it as the
    record for the two margins and the register had no row. The row `fec` quotes the page
    read, proposes all four grants on the basis the other federal rows use, and has no
    decision. Gallup's row still proposes nothing, so `approval` has no route; that is for
    Alex (another source, or permission).
14. **Terms of government are a file kind, not Series, and M16 stops at the file.** A term
    is an Annotation (CONTEXT.md). `catalog/manual/terms/{office}.json` lists holders with
    start, end, party where it is a fact of the record, and a citation each; terms are in
    order and do not overlap. `atlas.manual.load_terms` is what M19's annotation projection
    will read. Projecting them into a Release's annotations here would have been M19's work.
15. **No legacy-channel adapter was built.** The plan allows one only for a Channel Alex
    cleared in D2 "by a signed register row and an amendment to ADR 0006". None is. A test
    holds the absence: no cleared intermediary, no adapter named for one, no Series in the
    pipeline through one.
16. **The account of v1's series is worked out, not typed.** `docs/v2/v1-coverage.md` is
    generated from the Catalog and the register. A stored Series is *live from origin* when
    it is in the pipeline over the direct or hand-entered Channel, *live via a cleared
    channel* when it is in the pipeline through an intermediary the register lists as
    cleared, and *withheld* otherwise, with the reason read from what is true of it: no route
    (the entry's own reason), an intermediary that is not cleared, no register row, a row
    that proposes no display, a hand-entered file that waits for a decision, or no reader
    yet. A Derived series is the least direct of what it rests on. Today: 51, 0 and 75.
17. **"Live" is a statement about the pipeline.** It says the Series is read from its Origin
    by an adapter and released under the gate. It does not say a public Surface shows it:
    that needs a signed row, and the page prints the gate's answer for today (none).
18. **The comparison with v1 covers every live series, from one run on real captures.** The
    statement (`checks/v1-overlap.json`) gains the IMF's, the BEA's, the EIA's and the Census
    Bureau's Series, which M14 and M15 left for this milestone. The run fetched all thirty
    endpoints into a temporary directory under a scratch register marked as test data,
    released with the public profile, compared with `atlas legacy-release`, and deleted
    everything. What is committed is counts, differences and explanations.

## Consequences

- Four more requests a run, to `www.census.gov`, about 0.8 MB. The flat files are whole
  programs: most of each file is series nobody reads yet, and adding one is an edit to the
  register and a Catalog file.
- A Census code relabelled, a heading reworded or a footnote renumbered stops that endpoint
  until someone has looked and moved the pin. That is the intent.
- Entering a hand-entered Series later is four steps, none of them code: Alex signs the row;
  the file is written under `catalog/manual` with a citation per value; an endpoint for it is
  added to that row; the Series file names the endpoint and becomes active.
- The capture host needs the repository's `catalog/manual` in its checkout to capture
  hand-entered files. It has one (the kit checks out the repository at a named commit).

## Not done here

- `medhome` and `income`: the quarterly median price and the annual median income are in
  Census workbooks of other shapes. Both stay drafts with that reason (v2.1).
- Values for `approval`, `pres_margin`, `house_margin` and any term of government: they wait
  for decisions on the `gallup` (or a replacement), `fec` and `public-record` rows.
- Terms of government in a Release's annotations (M19), and a citation beside a hand-entered
  value on its series page (M17).
- Construction spending by type and the other series of the flat files (v2.1).
