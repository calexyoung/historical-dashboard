---
status: accepted (M18, 2026-11-12); shows no agency data on a public surface (D2 is open, no row is signed)
---

# The Explorer on agency data: a pin is the gate's to read, a saved query is its own Pin, and export asks series by series

M18 brings the Explorer from v1's months to what a Release of agency Series holds: daily,
weekly, quarterly and annual Series at their own frequency, an as-of control, `pin=`, saved
queries, and an export that honours rights per Series. The acceptance: on a public-profile
Release each v1 preset and recorded hash link opens the same view or names the withheld series;
a pinned link to a retained Release shows the same data after a newer one is promoted and
answers 410 once pruned; export of a display-only Series is refused with the reason; no Explorer
test from track A is deleted. This records the choices the plan left open. The contract for a
reader of the page is `docs/method/explorer.md`.

## Decisions

1. **Three more fields of the one address**: `freq`, `as_of`, `pin`, written in a fixed place
   (`…&to=…&freq=…&as_of=…&layers=…&…&pin=…`). `as_of` and `freq` go to Query unchanged, so the
   Explorer, the series page and the twins ask the same question in the same words (ADR 0031).
   The engine's other Transforms (`chg`, `ch1`, `pch`, `pca`) are modes after v1's six.
2. **Each Series is drawn at its own frequency. A common frequency is asked for, never
   assumed.** `freq=` brings every *finer* Series to it by the Series' own declared rule
   (Measure kind and `agg`), in Query. A Series at or slower than it is drawn as it is and the
   page says so: nothing is spread over finer Periods. A Series that does not say how its
   Periods combine is not drawn at another frequency, with the reason.
3. **Relationships take a daily or weekly Series at the pair's frequency, combined once.** The
   pair frame compares at the slower of two frequencies and knows months, quarters and years.
   A finer Series is asked of Query at the frequency the pair is compared at (monthly at the
   finest), so a quarter of a daily rate is the mean of its days, not a mean of monthly means.
   No engine rule changed; `semantics_version` stays 0.6.0.
4. **An as-of view claims what it used, and says nothing of today.** Each Series shows its own
   Basis (over both runs when two ranges are compared); the view claims the weakest among what
   is drawn. An `unavailable` answer leaves the Series named and not drawn, with the reason: it
   is never filled with today's figure, in the chart, the readout, the snapshot, the
   relationships or a file. Series are named by the unit in force then; Periods still held
   under earlier metadata are listed. "Stale" and "latest value" are statements about today and
   are left off.
5. **A Series the Catalog knows and the Release does not hold is named, not dropped.** A public
   Release holds only what was captured and permitted, so `spx` is simply absent from it. The
   site carries a generated table of the Catalog's names and no-Channel reasons
   (`catalog-names.generated.ts`, no values; `gen:check` keeps it current). Such a Series is
   listed under the chart with the reason, stays in every address of the view (the copied link
   and v1's presets included) and counts toward the eight, as v1 counted. A Release that holds
   none of v1's preset Series (the synthetic fixture) is offered no presets.
6. **`pin=` is read in the gate, and nowhere else.** A page cannot choose its Release (ADR
   0015), so the proxy's gate fixes a pinned request to the Release the address names, by the
   header it already uses. CURRENT must still be servable first. Then: not a release id, 400;
   not a real directory under `releases/`, 410 Gone with a link to the same view on the current
   Release (the trash does not count, nor a copy in memory: "once pruned" means for new
   requests); cannot be read, breaks the contract, or may not be served on this Surface, 503.
   Nothing is ever served in a pinned Release's place. Only `/explore` and `/explore/export`
   take a pin; a twin still answers 400 for it.
7. **A pinned page is one Release, frame included, and says so.** The note names the Release,
   when it was made, that today's engine draws it (with `semantics_version`), whether a newer
   Release is current, and links to the same view unpinned. Every other address on the page
   keeps the pin. Pinned responses are not cached as immutable: they are rendered per request
   like every Explorer view.
8. **A saved query is its own Pin.** `atlas save ADDRESS --note … --profile local` appends to
   `{root}/saved.json`: an id, the note, the view with `pin=`, the release id and the time.
   Retention keeps every Release that file names (`root.kept_by_name`), so there is one file
   and one write: no second record in `pins.json` to disagree with it, to be owned, or to be
   left behind by a crash between two writes. `atlas save --remove ID` removes the entry;
   the Release is then kept only if something else names it. The Release is checked as a pin
   is before anything is written.
9. **Only the link "Copy link" gives can be saved, read strictly.** Everything said outright,
   in the Explorer's order, so a saved view does not change when a default does. Python
   (`atlas/publish/saved.py`) and the site (`lib/explorer/saved.ts`) run the same file of
   accepted and rejected addresses (`checks/explorer-addresses.json`). The site's own parser
   stays lenient for links that arrive damaged; a record kept for good is not.
10. **A note never enters a public root.** PLAN 4.3 keeps a user's own text out of what is
    published, so `atlas save --profile public` is refused and names `atlas pin`. The site
    lists saved views on the local Surface only, from a fixed selection of the file, and shows
    the command to save the view in hand there. Saved queries for a public Surface wait for
    Alex (where the notes live, and who may see them).
11. **Export asks the gate Series by Series.** Each selected Series is asked about on its own,
    for `redistribute`, with its full lineage, and for an as-of view with its history's too. A
    file holds the Series that may be redistributed, on the view's own window, and names each
    one left out with the gate's reason, in the CSV and in the picture. Where none may be, the
    answer is 403 with the reason and the page does not offer the links. ADR 0031 refused a
    display-only Series' Markdown twin whole; that is the one-Series case of the same rule.
    "Every series as one file" is today's Release and is refused with an as-of date.
12. **The gate is an argument, and only tests pass one** (ADR 0031, point 12), now for the
    Explorer's view and export too. The parity suite runs on a public-profile Release made by
    the real capture kit and release writer from `fixtures/capture` (invented values) under a
    test register in which every capturing row carries a decision
    (`fixtures/release/agency.py`), with that table as the gate. On the app's own gate the same
    Release shows nothing on a public Surface, and a test holds it to that.

## Considered options

- **Aggregate a daily Series to months once, then let the pair frame take it to quarters.** One
  Query call per Series, and wrong: a mean of monthly means weights short months more.
- **Read `pin=` in the page and open that Release there.** The layout, the footer and the
  freshness mark would be CURRENT's and the chart another Release's; and a page cannot answer 410.
- **Keep serving a pruned Release from memory or the trash for a pinned link.** It would answer
  differently on each process and after each restart.
- **Write a saved query's Pin into `pins.json`.** Two files to keep in step, and `unpin`
  replaces the one record a Release has there: a saved query, a claim lock and a hand-made pin
  on the same Release would overwrite one another.
- **Let Python accept any address the site can read.** The site reads leniently; a saved view
  that depends on a default is a view that changes.
- **Refuse the whole file when one Series may not be redistributed.** Simpler, but ADR 0019
  promised per-Series export, and a reader with seven permitted Series would get nothing.
- **Bundle the whole Catalog in the site** to name absent Series. Names and one reason are
  enough; the Catalog's working fields are the pipeline's.

## Consequences

- When Alex signs a row, the Explorer shows its Series on a public Surface, v1's presets name
  what is still missing, and export follows each row's `redistribute`, with no change of code.
- A Release evicted from the reader's small cache and pruned between the gate and the render of
  one request fails that request with a 500, never with other data (the same window ADR 0015
  accepts for CURRENT).
- The frame of a pinned page (the freshness mark) describes the pinned Release.
- `saved.json` belongs in the nightly backup beside `pins.json` (PLAN 4.3).
- Pinned twins and API answers (`pin=` outside the Explorer) are M24's.

## Tests

`site/src/lib/explorer/state.test.ts`, `view.test.ts` (fixture: as-of, a common frequency,
absent Series, a gate handed in); `agency.test.ts` (a public-profile Release: v1's eleven
presets and ten recorded links, native frequency, relationships, export per Series);
`pin.test.ts` and `lib/gate.test.ts` (the pinned-link criterion and every refusal);
`saved.test.ts`, `tests/v2/test_saved_queries.py` (the shared addresses, `atlas save`,
retention); `lib/export/export.test.ts` (display-only refused, as-of files);
`site/tests/built/served.test.ts` (over HTTP: 200, 410, 400, 503, saved views local only);
`site/e2e/explorer3.spec.ts` (a real browser, JavaScript on and off, 360 px, both themes).
