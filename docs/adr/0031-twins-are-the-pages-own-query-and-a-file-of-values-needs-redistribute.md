---
status: accepted (M17, 2026-11-12); serves no agency data on a public surface (D2 is open, no row is signed)
---

# Twins are the page's own Query, a file of values needs the Permission to redistribute, and history is asked about as values

PLAN section 3 says the page address is the API: add a suffix, get the data behind the page.
M17 builds that for series pages, with the vintage table, the as-of view, a citation and
`/api/v1/status`. This records the choices the plan left open. The contract is
`docs/method/twins.md`.

## Decisions

1. **One request shape, one parser, one Query.** `as_of`, `freq` and `agg` join Query's request.
   The page and its twins read the address with the same parser and ask the same Query, so the
   HTML table, the JSON and the CSV cannot disagree; a test compares them for every fixture
   Series. Order: resolve, aggregate, transform (PLAN 4.5).
2. **A file of values asks for `redistribute`; the page asks for `display`.** `.csv`, `.json`
   and `.md` are files that leave the site. A display-only Series renders, and its three files
   answer 403 with the gate's reason. The Markdown twin could have been served with the values
   cut out; it is refused whole instead, because section 7 says a download is refused and a
   half-file is a second thing to keep right.
3. **`.metadata.json` needs no Permission and holds no value.** It is a fixed selection of the
   Catalog entry, for the reason the catalog page may name a Withheld Series. Where the Series
   may not be shown it does not say how far its values run either. A Channel's endpoint and
   how it signs in are not in it.
4. **Asking about the past asks the gate about the past.** An as-of answer and the revisions
   table hand `permits()` every Origin, dataset and Channel in the vintage file's metadata
   history and rows, as the writer does (ADR 0024, point 3). A refusal there does not take
   today's values down.
5. **An answer claims the Basis of what it used.** ADR 0024 warned against copying a whole
   Series' Basis onto a narrower view. Query takes the weakest among the Periods in the answer
   and those its Transform set them beside (the Period before, or the same Periods a year
   earlier), and never better than the last Capture before the Cutoff allows. A Derived answer
   is narrowed input by input, through its Recipe's own look-back; a Recipe over Recipes, or
   one whose input is at another frequency than the Series, keeps the weakest Basis of its
   whole inputs, which claims no more than is true.
6. **Periods held under other metadata are shown, but not computed across.** With no Transform
   and no slower frequency they are in the answer and named. Otherwise they are left out of the
   arithmetic and listed, as a Recipe does (ADR 0025). Where the versions known then were under
   more than one metadata and none was in force, nothing is computed.
7. **Unavailable is an answer, and the page holds no value.** 200 with `basis: unavailable`
   and no Observation; the page draws no figure, gives no latest value and leaves the revisions
   table off, since that lists later versions.
8. **The revisions table is today's history and is left off an as-of view.** A table cut at the
   Cutoff would need the two-clock rule applied per row a second time; the view links to the
   plain page instead. Each row shows the Origin's clock and Macro Atlas's in separate columns.
   The page lists the latest 48 versions, cut between Periods, and all of them on request
   (`?revisions=all`, newest first, 5,000 to a page), so no version is out of reach.
9. **Routing: the proxy sends a twin's address to one handler, and marks the request.** A page
   route cannot carry a suffix. Next runs the proxy again on the path a request was sent to,
   so the first pass sets a token only this process knows, and the handler's own path is let
   through only with it; asked for directly it is not found. Refusals (421, 503) are decided
   before any of this, so a twin fails closed exactly as its page does. The Host the reader
   named is carried the same way, because the second pass sees the server's own name.
10. **Caps live in Query; rate limits wait for the read API.** Rows, versions read, and time
    are checked in Query, and time is checked after each stage and at the end, so an answer
    that took too long is not given. Bytes are checked on every twin body. Per-address and
    global token buckets (PLAN section 7) are M24's, which has the 429 criterion.
11. **Only production may cache, briefly, and never a refusal.** `max-age=300` and an `ETag`
    of the body's own bytes. The gate answers before a validator is compared. A withdrawn
    Series can live in a cache for five minutes; that is the price of the plan's "short
    max-age" and is written down here so it is a choice.
12. **The gate is an argument, and only tests pass one.** Query, the page and the twins take
    an optional `RightsGate`. Left out, it is the committed register. Nothing in the app, its
    configuration or its environment can supply another. The display-only criterion is tested
    with a register made in the test (the fixture Origin, signed, display only), since the
    committed register has no signed row and the builder signs none.
13. **`/api/v1/status` reads the root's `STATUS.json` as a fixed selection.** Started,
    finished, outcome, release id and a count of failed checks; a check's own words stay with
    the writer. A Series' last Period is given only where it may be shown.
14. **`semantics_version` stays 0.6.0.** No Transform, aggregation or resolution rule changed.

## Not in M17

- `pin=` (M18, with the Explorer's pinned links). A twin answers 400 for it.
- Rate limiting and the other `/api/v1` routes (M24). `vintageTable()` already answers one
  Period's history for `series/{key}/vintages`.
- A citation beside each hand-entered value (ADR 0030, point 11). A Release has no field for a
  footnote, no hand-entered value exists until its Origin's row is signed, and adding the field
  is a change to the Release contract; it goes with the first milestone that publishes one.
- `<link rel="alternate">` and JSON-LD on the page (M25, discovery).
- Reading vintage files on demand (ADR 0024's note): the cap on versions read bounds one
  answer; the reader still holds each open Release's files in memory.

## Considered options

- **Serve the twin from the proxy itself.** No second pass and no token, but the engine would
  live in the proxy and every request would load it.
- **`/data/{key}/csv` as the address.** A plain route, and not what section 3 promises.
- **A redacted Markdown twin for a display-only Series.** See point 2.
- **An environment variable naming a test register**, to show a display-only Series on a real
  build. It would be a switch that turns the gate into something else.

## Consequences

- When Alex signs a row, pages, twins and the status route follow with no change of code; a
  row that allows display and not redistribute gives exactly the display-only case tested here.
- The Explorer (M18) takes `as_of` from the same Query and the same wording.
