---
status: accepted (M15, 2026-11-11); commits no BEA or EIA data (D2 is open, no row is signed)
---

# An API key is sent and never kept, and a source without its key is stale

M15 adds the fifth and sixth adapters, for the Bureau of Economic Analysis's data API and the
Energy Information Administration's API v2: ten endpoints, fourteen stored Series, one more
Derived series. They are the first sources that want a key. The plan's acceptance is about
that and little else: "suites pass with no keys present; each keyed source degrades to
'stale, last fetched …' when its key is missing; keys never appear in the repo, logs or
fixtures (test)". The rules are in `docs/method/capture.md` ("API keys" and the two sources'
sections); the host's side is in `deploy/capture/README.md`.

## Decisions

1. **A request says which key it wants and never holds it.** An adapter builds its URLs
   without the key and marks the request with a query parameter and a key's name (`UserID`
   and `BEA_API_KEY`; `api_key` and `EIA_API_KEY`). The Session adds the key to the URL it
   hands the transport. The request it records is the one without it, so the fetch log, a
   store, an exported fixture and a replay all hold a URL that never had a key in it. Both
   agencies document the key as a query parameter, so a header was not tried. Putting the key
   in the URL and scrubbing every place a URL is written was rejected: it holds only as long
   as nobody adds a place.
2. **A key the source repeats is replaced before anything is kept, and the kept bytes are
   those.** The BEA puts the `UserID` it was asked with into every answer. The Session
   replaces every copy of every key of the run, in the body, the headers and the text of a
   network error, with the word `REDACTED`, before the answer is hashed, stored or examined.
   This is the one exception to ADR 0021's "exact bytes": for such an answer the blob, its
   hash and its length describe the answer with that replacement and no other change. It is
   a literal replacement in the bytes; nothing is parsed and written out again. The log part
   counts the copies (`key_removed`), and an exported fixture carries the count. Sanitized
   bytes are still a source's bytes: `real_bytes` stays true and the redistribution check on
   export applies as before. Not keeping BEA's answers at all was the alternative; it would
   have meant no vintage history for GDP.
3. **A key is letters, digits and hyphens, 16 to 128 of them, or it is not sent.** Text of
   that shape reads the same in a URL, in a header and inside JSON, so one literal search
   finds every copy. A value with a character that a URL or JSON would escape could come back
   in a spelling the search does not match, so it is refused before it is sent and its
   endpoint is treated as having no key. Both agencies' keys fit. Keys are replaced the
   longest first, so one key inside another leaves nothing behind.
4. **Keys come from the environment of a live run and from nowhere else.** The register names
   no key; it could not, being public. The command reads `BEA_API_KEY` and `EIA_API_KEY` only
   when it is about to ask the network, hands them to the run, and prints at most whether
   each is set. Whether keys are used is decided by the transport, not by the caller: a
   transport that answers from recordings is sent none even when keys are in the environment,
   and its recorded bytes are left alone.
5. **Without its key a source is not asked, and that is `stale`, not `failed`.** The endpoint
   gets a fetch-log line with the outcome `no_key` and no request is made: a request without
   a key would be answered 403 by one agency and with an error under HTTP 200 by the other,
   and thirty errors a minute locks a BEA key out for an hour. The run prints "STALE id:
   stale, last fetched TIME (KEY is not set; nothing was asked)", goes on to every other
   endpoint and ends with exit status 1, as any run does that did not capture everything it
   selected. Exit 0 with a warning was considered: a host without the keys would then look
   healthy for ever while two sources aged. The host can leave the rows out
   (`ATLAS_CAPTURE_ONLY`) and be green honestly.
6. **The rights gate still comes first.** A missing key never gets a run past an unsigned
   row: the gate is asked about every selected endpoint before the first request, keys or no
   keys, and refuses the whole run as before.
7. **A Release says "stale, last fetched …" in its manifest.** The release writer already
   called a source `ok`, `failed` or `stale`. A newest attempt of `no_key` makes it `stale`,
   and the detail names the endpoint and the time of that Series' own last recorded Capture,
   not the source's newest. The Release publishes the last state recorded, whole. A reused
   Release carries the note. The site shows no per-source status yet (M17's status page);
   until then this is read in `manifest.json`, in `atlas capture --status` and in the run's
   own lines. A source never captured publishes nothing and so has no line in a manifest; the
   capture commands say "never fetched".
8. **A BEA table is asked for whole, every year, and read by code and line.** The NIPA
   endpoints take a table name and a frequency; there is no way to ask for one line. Table
   2.6 monthly is 8.6 MB, 0.26 MB compressed. A window of recent years, as BLS has, was
   rejected: comprehensive revisions reach back to 1929, and whole-history scope keeps
   "a Period that is not listed is gone" true. One series code can sit on two lines of a
   table, so the endpoint pins the line, and with it what the rows say of themselves (unit,
   multiplier, metric), as ADR 0027 pins the Board's labels.
9. **The API's millions are kept, and the reference year is pinned as a text.** The API gives
   dollar levels with `UNIT_MULT` 6 where the table's note says billions. The Catalog says
   millions (`gdp`, `profits` and the new Series); v1 showed billions, and the migration notes
   say so. No field of a row says which year's dollars a chained series is in. The table's
   note does, and for real disposable income the line's description. The endpoint pins that
   text (`basis`: "chained (2017) dollars"); a capture whose note and line both lack it is
   incomplete, so a rebase stops the capture until the pin and the Series' dated metadata
   are changed (ADR 0028, decision 5).
10. **Two changes are made to a printed figure, and no others.** The BEA's thousands commas
    are taken out (`23,650,213`), and a zero is put before an EIA figure printed without one
    (`.995`, the price of gasoline under a dollar): the vintage store holds decimal text and
    neither is that. Anything else that is not a number makes the capture incomplete, for a
    line or series that is read. A mark such as `(D)` on a line nobody reads stops nothing.
11. **Every BEA value is `observed`.** The Bureau's advance, second and third estimates are
    not marked in the data. Calling the newest quarter `preliminary` by rule would be working
    out what the source does not say. A later estimate is a revision the vintage store sees.
    The answer's own production time changes on every request, so no two answers are the same
    bytes; the store compares Observations and records a confirmation (a test holds this).
12. **The monthly trade balance is not in the BEA's API, so `trade` stays a draft.** The
    international accounts there are quarterly and annual. v1's monthly figure is the FT-900
    release, compiled with the Census Bureau, and belongs with the Census files (M16). The
    plan names the trade balance for this milestone; what the API has is captured under a new
    key, `trade_q`: a quarterly rate, not annualized. A key's definition does not change
    (ADR 0026).
13. **An EIA series is named by one facet, and the adapter is told which.** Petroleum and gas
    rows carry a series id (`RWTC`). Electricity rows have none: a row is a fuel type, a
    location and a sector. The endpoint says which facet names its series (`fueltypeid`) and
    holds the others to one value, so the Origin's identifier for total generation is its
    own code, `ALL`, at that endpoint. The old API's series ids (`ELEC.GEN.ALL-US-99.M`)
    are still answered on a compatibility route; one request per series, on a route kept for
    old clients, was not built on.
14. **Monthly prices are the Administration's own monthly series.** v1's `wti`, `brent` and
    `natgas` were monthly averages. The API publishes a monthly frequency of each; that is
    what is read, not a daily series averaged here.
15. **Paging is checked for what it can show.** Pages must agree on the total, add up to it,
    be full but for the last, and hold rows in order with none repeated; at most forty are
    read. That shows data that grew or shrank while it was read. A figure revised between
    two pages would pass, and the next capture records it. Every series asked for must have
    at least one number: with whole-history scope, an answer of nothing would otherwise read
    as every Period withdrawn.
16. **Fourteen more Series are active with no row signed, and six are new.** `gdp`,
    `gdp_qoq`, `profits`, `saving`, `wti`, `brent`, `natgas` and `gas` are bound; `gdp_yoy`
    becomes active with `gdp`. New, because the plan names GDP, PCE, income and generation:
    `gdp_nominal`, `pce`, `personal_income`, `real_dpi`, `trade_q`, `elec_gen`. As before,
    active means an adapter fetches it (ADR 0027, decision 9); the gate refuses every one at
    capture, replay and release.
17. **The fixtures stay invented, were made without a key, and say so.** The generator
    answers the two adapters' requests, asked as a replay asks them, with bytes of the real
    shapes: the BEA's echo of its request (with `REDACTED` where the key would be), commas, a
    code on two lines, a line with `(D)` that is not read, profits ending a quarter early;
    the EIA's totals and values as text, a week with `null`, a price printed `.995`.
18. **The host template names two secrets and the job keeps none.** `deploy/capture/capture.yml`
    passes `secrets.BEA_API_KEY` and `secrets.EIA_API_KEY` to the Capture step only. Creating
    them is Alex's step, in the private capture repository, which this builder does not make.

## What was checked against the live APIs

On 2026-11-11 both adapters were run once against the two APIs with Alex's keys, in memory.
Nothing was stored: storing what a source served needs a signed row even on one machine
(ADR 0020, decision 7; ADR 0028, decision 13). All ten endpoints came back whole. The run
found the EIA's `.995` (decision 10), which no documentation mentions. Counts only:

| Endpoint | Rows read into Series | History | Bytes (compressed) |
|---|---|---|---|
| `bea-nipa-t10101` | 318 | 1947-Q2 to 2026-Q3 | 2.0 MB (47 KB) |
| `bea-nipa-t10105` | 319 | 1947-Q1 to 2026-Q3 | 1.9 MB (69 KB) |
| `bea-nipa-t10106` | 319 | 1947-Q1 to 2026-Q3 | 1.1 MB (42 KB) |
| `bea-nipa-t11200` | 318 | 1947-Q1 to 2026-Q2 | 3.7 MB (123 KB) |
| `bea-nipa-t20600` | 4 × 813 | 1959-01 to 2026-09 | 8.6 MB (264 KB) |
| `bea-ita-balance` | 266 | 1960-Q1 to 2026-Q2 | 0.1 MB (3 KB) |
| `eia-petroleum-spot` | 490 and 474 | 1986-01 and 1987-05 to 2026-10 | 0.3 MB (7 KB) |
| `eia-natgas-spot` | 358 | 1997-01 to 2026-10 | 0.1 MB (3 KB) |
| `eia-gasoline-retail` | 1,891, six with no number | 1990-W34 to 2026-W46 | 0.6 MB (14 KB) |
| `eia-generation-us` | 308 | 2001-01 to 2026-08 | 0.1 MB (4 KB) |

The BEA repeated the key once in each of its six answers and each copy was replaced; the EIA
repeated it in none. Against v1's values, for the months and quarters both hold: `gdp` (107
quarters), `gdp_qoq` (107), `profits` (106) and `saving` (321 months) agree exactly once
millions are read as billions; `natgas` (322 months) agrees exactly; `wti` and `brent` (322
each) agree within 0.5 percent, the largest difference 0.03 and 0.14 dollars. Every value of
every Series read is inside the range its Catalog entry states. The comparison is not
reproducible from the repository, for the reason M13's is not: no figure may be committed.

## Consequences

- With both rows signed and both keys present, a run makes ten more requests and keeps about
  0.6 MB more, compressed. Every BEA answer is new bytes, so that is kept on every run: about
  1.1 MB a day at two runs, some 400 MB a year in the capture repository. If that proves too
  much, the cure is to ask the BEA once a day, not to drop the production time from the bytes.
- `atlas capture` with no `--only` now needs six rows signed and two keys. Without the keys it
  fetches the other four sources and ends red.
- A changed line number, multiplier or reference year in a BEA table stops that endpoint
  until someone has looked. The 2017 reference year will change at the next comprehensive
  revision.
- The capture store on a host is a git repository. No key is in it by construction, and a
  test reads every byte a run writes for a seeded key to hold that.
- A key that leaks some other way (a shell history, a screenshot) is outside what this can
  prevent. Both keys are free and can be replaced.

## Not done here

- The comparison with v1 through the engine and a Release (M13's `v1-overlap` statement)
  for these Series: it needs real captures, which need the rows signed. It belongs with M16's
  comparison table.
- The monthly trade balance (M16, Census files); `debtgdp` as a Recipe over `debt` and
  `gdp_nominal`, which needs a ratio in percent the engine does not have yet.
- EIA depth: generation and capacity by source and the retail electricity price (M33). The
  adapter reads them as it is; they need register entries and Catalog files.
- The BEA's API terms of service and the EIA's rate limits were not read or found; both are
  open questions on the register rows, for Alex before he signs.
