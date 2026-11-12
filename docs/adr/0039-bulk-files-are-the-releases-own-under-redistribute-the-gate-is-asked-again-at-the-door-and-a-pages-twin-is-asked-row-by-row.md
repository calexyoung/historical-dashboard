---
status: accepted (M25, 2026-11-12); the files by licence, the five-minute cache and publishing the repository's method documents are the builder's choices and Alex's to change; serves no agency value on a public surface except through a signed register row
---

# Bulk files are the Release's own under redistribute, the gate is asked again at the door, and a page's twin is asked row by row

M25 builds the bulk files (Parquet, CSV.gz, JSON Lines, `vintages.parquet`, `datapackage.json`
by licence), `/downloads`, Markdown twins for every page, `llms.txt`, JSON-LD, `/docs/method`
and `/docs/rights` (PLAN sections 3, 4.4 and 7). The acceptance: the files load in pandas,
polars and DuckDB in CI; the three formats hold the same rows; checksums match; nothing
withheld, non-redistributable or legacy is in any bulk file; bulk files are written only for a
public-profile release; every link in `llms.txt` resolves. This records the choices the plan
left open. The contract is `docs/method/bulk-files.md`.

## Decisions

1. **A bulk file needs `redistribute`, decided by leaving out.** A Series is in the tables
   only when the gate permits redistribution, on production, of its own Origin, dataset and
   Channel and of every Series it is computed from. A Series that may be shown and not handed
   out is published and is in no file; the datapackage names it with the reason. Legacy is
   refused in the bulk writer itself, whatever a gate says.
2. **Built from the Release's own files, on every path.** `bulk.build` reads the staged
   `series/`, `derived/`, `vintages/` and `catalog.json` and no store. A full release, a
   `--reuse-data` release and a withdrawal all write their bulk files the same way, under the
   register as it reads then, so a content-only release after a permission is withdrawn does
   not carry the old files forward.
3. **The whole tables and the same rows by licence.** PLAN names five files and also asks for
   a datapackage "split into resources by licence". A resource is a file, so both are written:
   `observations.parquet` and the rest hold everything, each row with its licence class, and
   `observations.{licence}.…` hold one class each. Codex agreed this is the stronger reading.
   The cost is each row stored twice. A grouping inside one resource was the alternative; it
   would not let a reader take only public-domain data without filtering.
4. **A version carries its own day's unit, Origin and licence.** Codex's point: stamping
   today's Catalog unit and licence on a historical row misstates it. The versions table takes
   them from the metadata recorded with the version, and `vintages.{licence}.parquet` is split
   by that. Whether a version is in any file is still today's register's decision. The two
   clocks stay in separate columns, as text, because an Origin may date a version to the day.
5. **Contract 0.7.0.** `downloads/` is optional and a public-profile Release's alone. Both
   validators hold a Release to its datapackage: every data file named once, none unnamed,
   size and SHA-256 as stated, the package this Release's, every Series listed published
   natively, a file for one class listing only that class. One new code, `bulk_files`. A
   validator reads no Parquet; what the rows are is the writer's failing check (every format
   read back and compared with the rows the Release's own files give under the gate) and the
   tests'. Releases of 0.1.0 to 0.6.0 stay readable and may hold no bulk file.
6. **The release id covers the bulk files.** It is made over every staged file and over the
   datapackage with its own `release_id` empty, then the datapackage is given the id. Codex's
   point: leaving the descriptor out would leave its licence and membership statements outside
   the identity.
7. **The gate is asked again at the door.** A register changes after a Release is written.
   `/downloads/{release_id}/{file}` asks the gate, for the Surface, about every Series the file
   lists (history too, for versions) and answers 403 with the reason and no byte. A file is
   never trimmed, because its hash is published. This is why a Release whose bulk files today's
   register would refuse is not made a failure of `atlas doctor`: a display-only Series is a
   legal state for a public root, exactly as its twins are (ADR 0031), and the file is closed
   at the request. A withdrawal still retires every Release that holds the Series, files and
   all.
8. **Five minutes, not a year.** PLAN section 7 says bulk files under a release id are
   immutable. The bytes are; the permission is not. Codex's point: a copy kept for a year would
   outlive a withdrawn permission by a year, where ADR 0031 accepted five minutes. Production
   sends `public, max-age=300` and the SHA-256 as the `ETag`; the gate answers before a
   validator is compared. This departs from the plan's wording and is Alex's to change.
9. **The address names the Release, and the proxy fixes it.** As for a pin (ADR 0032): 410
   once retention no longer keeps it, 503 when it may not be served, never another Release's
   file. `/downloads/latest/{file}` is a 302 to the current id. A file is counted against the
   rate limits like a twin.
10. **The reader hashes bulk files as streams when it opens a Release** and keeps the
    datapackage, not the bytes (Codex's point about a cold open holding every file in memory).
    A file is sent from one open handle, so a Release pruned mid-download is still sent whole.
    Only a name the datapackage lists is ever looked for.
11. **A page's twin is the page's own view, asked for `redistribute` row by row.** The view is
    given a gate that asks the same register "may this be redistributed?" wherever the view
    asks "may this be displayed?". It can only refuse more. A Series that may be shown and not
    handed out is in the twin by name with the reason. This amends ADR 0031 point 12 in one
    way: the app now passes a gate, and it is the committed gate made stricter, never another
    register. A series page's twin and a Claim's stay refused whole. The Explorer's twin is its
    export as a table and keeps `pin=`. Codex asked for an audit of what reaches a twin without
    passing the gate: Events and the Claims index hold no value; the tests look for every value
    of a fixture Series across each value-bearing twin under a display-only register.
12. **`llms.txt` lists only what answers.** A Series not handed out on the Surface is listed by
    its metadata twin; a Claim whose record is not given is counted, not linked. So "every
    link resolves" holds on production as it does locally, and a test follows each link on both.
13. **JSON-LD is the metadata twin's record.** A fixed selection, no value; coverage only where
    the Series may be shown; a file listed only where it would be given.
14. **`/docs/method` publishes the repository's method documents as they are**, with the page
    written for readers (M21) first. The repository is public and the code is tested from these
    texts, so the site shows the contract instead of a second account of it. Their text is
    generated into the site (`npm run gen`); the twin is the text. The M21 page became a
    Markdown document so that it has one source. A small reader draws the Markdown as elements
    and makes no HTML.
15. **`/docs/rights` is a fixed selection of the register**: no quotation, note, open question
    or signer's name. It grants nothing and the gate does not read it.
16. **The build-output check names different needles.** The method documents are now in the
    build and their examples name `fx_price_index`. The test that no file of a Release is in
    the build output looks for the fixture's release id, a Series name, a key no document
    names and a sentence of the fixture's Catalog. It still fails on a Release in the output.
17. **The datapackage is held to the rows, by the writer.** Codex's review of the code found
    that the request-time gate trusts each resource's list of Series, and nothing compared
    that list with the keys in the file: a key left off it would never be asked about. The
    writer's failing check now requires the list, the row count and the licence classes of
    every resource to be exactly those of its file. The validators still cannot (no Parquet).
18. **A file of versions is described by what was recorded with its rows.** Also from that
    review: the licence, attribution and source lines of `vintages.*` were today's Catalog's.
    They are now the classes, attributions and Origins the versions themselves carry.
19. **A file is read as the response is taken.** The first version of the stream read the file
    as fast as the disk gave it, whatever the reader did (Codex). It now reads one 64 KiB chunk
    for each the response asks for and closes its handle when the reader goes away.
20. **`semantics_version` stays 0.7.0.** No Transform, aggregation or resolution rule changed.

## Not in M25

- `/docs/changelog` (PLAN section 3 lists it; M25's entry does not).
- CSV and JSON twins of the Overview, Highlights and Topic pages. The Markdown twins exist;
  the values are reachable through each Series' own twins and the bulk files.
- Range requests on a bulk file, and a stated `Content-Length` (the file is streamed).
- A Python client, recipes, a mirror (PLAN section 13).
- A check in `atlas doctor` for bulk files today's register would refuse. See 7.

## Considered options

- **Only the five files, with licence groups inside the datapackage.** See 3.
- **`immutable, max-age=31536000`.** See 8.
- **Refusing a page's twin whole when any Series on it may not be handed out.** The Overview
  would then have no twin as soon as one display-only Series was a headline.
- **Rendering the page's HTML to Markdown.** One source, but the gate would be display's.
- **Hand-written method pages.** A second account to keep true.

## Consequences

- With the BLS, Treasury Fiscal Data and Federal Reserve Board rows signed, a public-profile
  release from a store that holds their captures writes bulk files of those Series with no
  change of code. Every other Origin's Series is left out until its row allows redistribution.
- The deploy kit (M26) must let `downloads/` through with the rest of a Release and needs
  nothing else for this.
- A Release directory is now larger by its tables, twice (3).
