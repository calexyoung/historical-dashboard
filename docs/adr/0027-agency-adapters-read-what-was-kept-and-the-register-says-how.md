---
status: accepted (M13, 2026-11-11); commits no agency data (D2 is open, no row is signed)
---

# Agency adapters read what was kept, and the register says how

M7 built the fetch half of three adapters and the parse half of one. M13 adds parsing for
Treasury Fiscal Data and the Federal Reserve Board, the rest of v1's BLS series, and the
endpoints to match: 14 endpoints feed 32 stored Series. The plan names the sources and the
acceptance ("captured fixtures with provenance; each series passes the release gate; each
matches v1's value for the overlap within a stated tolerance or the difference is explained")
and leaves the rest open. The rules are in `docs/method/capture.md`; what the comparison with
v1 found is in `docs/v2/v1-overlap.md`.

## Decisions

1. **How a table or a package is read is a parameter of its endpoint, recorded in the
   Capture's scope.** A Treasury endpoint says `read` (`daily_rows` or `mts_summary`) and the
   value fields that are its `series`; a Board endpoint says `period` (`day`, `week`, `month`,
   `quarter`), the columns it expects and, for a package too large for one answer, the years
   its spans begin (`from_years`). Parsing uses the scope kept with the bytes, so a replay
   years later reads a Capture the way it was asked for. Two readers and one CSV shape cover
   everything M13 needs; a new table shape is a new reader with its own contract, not a
   configuration language.
2. **An adapter's identifier for a Series is the Origin's own name for what is read.** A BLS
   series id, the Board's series name as its file prints it (`RIFLGFCY10_N.B`,
   `STFBQDCC%STFBAILCC_XEOP_MA.Q`), a Fiscal Data field name (`tot_pub_debt_out_amt`,
   `current_month_gross_rcpt_amt`). Nothing is invented, and `atlas check` can hold a Catalog
   entry to what its endpoint asks for.
3. **A Period the source lists with no number is an Observation with no value; a Period it
   does not list is nothing.** The Board prints `ND`, `NA` or `NC`; Fiscal Data prints
   `null`; BLS prints `-`. Each becomes `missing` in the store with the source's mark kept
   beside it. An empty Board cell means the series had not begun or had ended; one between two
   filled cells is a fault and the capture is incomplete. So is an answer with nothing in
   it for something that is read: a span with labels and no rows, a statement with no month,
   a column or a field with no entry at all. Each would otherwise read as every Period
   withdrawn. Skipping the codes was considered and
   rejected: a day the Board lists without a figure would then look the same as a day
   withdrawn from the file.
4. **A value keeps the source's unit, and the Board's label rows are pinned.** Debt to the
   Penny is in dollars, Z.1 in millions, H.6 in billions, and the Catalog entry says so;
   nothing is rescaled at capture or in the store. For every Board series that is read, the
   endpoint records the unit, multiplier and currency of the label rows as they stood on
   2026-11-11, a capture whose labels differ is incomplete, and `atlas check` refuses a Series
   bound to a Board package without them. The pinned labels are also the list of columns
   read: a Capture whose scope pins none (one made by version 1 of the adapter) gives no
   Observations, so replay refuses the Series rather than trust today's Catalog about
   yesterday's file. The label is not always right about meaning (the
   broad dollar index is labelled "1997 Jan = 100" and is on January 2006 = 100); it is pinned
   so that a change is seen, and the Catalog states the unit.
5. **The Monthly Treasury Statement is read month by month from the latest statement that
   lists the month.** Each statement restates the months of two fiscal years and later
   statements revise earlier ones, so "latest" gives the Treasury's current figure for every
   month, and the vintage store records a revision when a later capture changes one. Reading
   each month from its own statement would freeze first prints and hide revisions the Treasury
   has published. The statement date orders statements and is never used as the time Macro
   Atlas knew a figure.
6. **A week is named for the ISO week of the day its figure is dated.** H.4.1 gives Wednesday
   levels; the store's weekly Period is `YYYY-Www`. The engine files a week under the month
   its last day falls in, so its monthly mean of `fedassets` differs from v1's, which filed
   weeks by their Wednesday (`docs/v2/v1-overlap.md`). The weekly values are identical. A
   reference-day rule for weekly Series belongs to the engine and is left for Alex to weigh;
   M13 changes nothing in `packages/core`.
7. **An empty 200 is asked for again, by the Session.** The Board's program answers a file it
   has not built yet with status 200 and no body, and the same request seconds later with the
   file. The adapter says which answers are not answers; the Session owns the waiting, the
   count and the record of why each try was repeated, as it does for a 5xx. A whole-history
   request for H.10's daily rates is always answered empty (about 2.6 MB), so that endpoint
   asks in three spans, each checked to hold only its own years; the last span ends on 31
   December of the current year because an open end is not answered.
8. **BLS is asked for thirty years, ten to a request, and one message is not a fault.** v1's
   series begin in 2000 and one keyless request spans ten years; with a ten-year window a
   local release built from the store would have lost sixteen years of every BLS series. Two
   endpoints make six requests a run. All eleven series began before 1997, so no year of the
   window predates a series. "No Data Available for Series X Year: Y" is accepted only for a
   series asked for, only when Y is the last year asked about and only when the answer lists
   no row of X for Y: verified against the API, and otherwise every capture each January
   would have been incomplete until the first figure of the year. Requests are counted back
   from the end of the window so that the newest never holds the new year alone.
9. **Thirty Series become active with no row signed.** ADR 0026 made "active" mean "an
   adapter fetches it", not "it may be shown". The rights gate still refuses every one at
   capture, at replay and at release, and a local release keeps v1's legacy Series for a key
   until the store holds it. Three Series are new (`receipts`, `outlays`, `net_worth`), because
   the plan names them for this milestone and v1 never had them. Five Derived drafts whose
   inputs are now all bound (`corecpi_yoy`, `rent_yoy`, `wages_yoy`, `m2_yoy`, `t10y2y`) become
   active with them.
10. **Four ranges were widened.** v1's ranges for the federal funds rate, the 2- and 10-year
    yields and the yen described the years since 2000. The Board's files begin in 1954, 1976,
    1962 and 1971, and the release writer rightly refused them. The ranges now cover the whole
    history.
11. **The comparison with v1 is a statement, a script and a dated result.** `checks/v1-overlap.json`
    says, per Series, how far it may be from v1 and why; `scripts/v1-overlap.mjs` compares two
    releases against it, using the engine's `aggregate()` to bring daily Series to v1's months
    (ADR 0003); `docs/v2/v1-overlap.md` records the run of 2026-11-11. The tolerance is half a
    unit of the last decimal v1 kept. A Period further off must be explained by name and is
    counted, never dropped; a Period v1 holds and the native Series lacks, inside the span the
    native Series covers, fails it; so does too short an overlap or a Series missing from
    either release. The script cannot run in CI on real figures, since none may be
    committed; its tests run it on invented releases.
12. **The fixtures stay invented, and say so.** The generator answers each request of the real
    adapters with bytes of the shape that request gets, including the things the live sources
    were seen to do: quarters and the revised mark at BLS, a restated month in the Treasury
    statement, empty leading cells and `ND` at the Board, a package in spans. Values of a
    Series with a declared range stay inside it, because the release gate checks that.

## Consequences

- The capture job, once Alex starts it, makes 20 requests a run and keeps about 2 MB a run
  compressed when everything changes.
- A release holding the daily Series whole is about 66 MB and takes about a minute to build on
  this machine; the Series files hold every business day since 1962 as JSON. That is within
  what the release writer does today and is a cost to watch in M17 and M18.
- The "captured fixture with provenance" of the acceptance is met in form (every endpoint has a
  recorded exchange with a provenance block) and not in substance (the bytes are invented)
  until a row allows `redistribute`. The live comparison stands in for it and is not
  reproducible from the repository.
- Deeper BLS history than thirty years, and Board or Treasury series beyond those the Catalog
  binds, need only a register entry and a Catalog file.

## Considered and not done

- **Reading the Board's SDMX or ZIP downloads.** One CSV per package is what M7 captures and is
  enough; a second format would be a second parser to keep right.
- **Custom Board packages holding only the columns needed.** A package made through the
  program's "build" pages is addressed by a hash whose lifetime is not documented. The
  preformatted packages are the program's own.
- **Accepting "No Data Available" for years before a series began,** which would allow any
  window. It would also excuse a series that had silently lost its early years. A window is
  chosen so that the question does not arise.
- **Rescaling to v1's units** (debt in millions). The Origin's figure is the record; the
  comparison applies the factor and says so.
