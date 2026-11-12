---
status: accepted (M24, 2026-11-12); the limits' numbers and the absence of CORS are the builder's defaults and Alex's to change; serves no agency value on a public surface except through a signed register row
---

# The read API is the twins' Query, the gate counts requests, and every body says where it came from

M24 builds `/api/v1` (PLAN section 7): `catalog.json`, `series/{key}`, `series/{key}/vintages`,
`events.json`, `claims.json` and `status`, with validation, caps, rate limiting and `/docs/api`.
The acceptance: a contract test per route; over-limit requests get 429; invalid input gets 400
with the allowlist; every response carries the fields in section 7. This records the choices
the plan left open. The contract is `docs/method/api.md`.

## Decisions

1. **The API is a delivery adapter and decides nothing about values.** `series/{key}` gives the
   document the `.json` twin gives, from one function (`seriesDocument`), and `catalog.json`
   gives the metadata twin's record (`seriesRecord`), so the API, the files and the page cannot
   disagree. Values ask Query for `redistribute`. Each route is a pure function of the Release
   the proxy fixed for the request; a handler copies the answer out.
2. **Every body carries `release_id`, `semantics_version`, `provenance` and `rights`, refusals
   included.** For a body that holds no value of one Series (the catalog, the Events, the
   Claims, the status, a refusal), `provenance` is the Release and the sources it was made
   from, named `release_sources` so it is not read as what one Event rests on, and `rights` is
   `permission: "none"` with a sentence saying this is not a statement about the Series named.
   Codex raised that `permitted: true` on a list could be read as "all of this may be
   redistributed"; the `scope` sentence and the per-Series `downloads` field are the answer.
3. **503 and 421 stay plain text and carry none of it.** They are decided before a Release is
   accepted, for every path alike. Opening or describing a refused Release to fill in an error
   body would be the leak section 6.1 exists to prevent. This is the one place "every response"
   is not met to the letter.
4. **An unknown Series key is 400, with the keys the Release holds.** Section 7 says so. A twin
   answers 404 for the same key (ADR 0031); the difference is deliberate and written in both
   contracts. The allowlist is the list of keys, which the catalog page already publishes.
5. **Rate limits are decided in the gate.** One place sees every request before any route
   runs, after the 421 and 503 checks and before a pinned Release is looked for. Counted: the
   API, every twin and the Explorer's export, which are the three ways data leaves as a file
   (ADR 0031, point 10 left this for M24). Pages, the health check and static files are not. A
   twin is rewritten and passes the proxy twice; it is counted on the first pass only.
6. **Two token buckets, in memory: each address 120 and 2 a second, everybody 600 and 20 a
   second.** A request either refuses is charged to neither. The numbers are a starting point
   for one small VPS and a daily-updated dataset; a script that walks the catalog once fits in
   the burst. They are constants, not configuration, so a deploy cannot switch them off.
7. **The address is the last entry of `X-Forwarded-For`.** With Caddy's defaults in front and
   the app on loopback (PLAN 4.8) that is the reader. IPv6 is counted by /64. This is a
   statement about that topology, not a general way to find a client: a CDN in front of Caddy
   would need it changed. The bucket for everybody bounds a client that forges the header by
   reaching the app directly; privacy of a build never rests on it.
8. **The memory is bounded without resetting anyone.** 10,000 addresses; refilled buckets are
   forgotten first; if none has refilled, new addresses share one overflow bucket (Codex's
   point: evicting a bucket in use would hand that address a fresh burst).
9. **Caching is the twins' rule, and the status is never stored.** Production only, five
   minutes, an `ETag` of the body, the gate asked before a validator is compared.
10. **No CORS header.** A local build may hold v1's data; `Access-Control-Allow-Origin: *`
    there would let any open web page read it. Whether the public site should allow other
    sites' scripts is left to Alex with the public launch.
11. **Collections are capped by time and bytes.** Query's caps do not cover the catalog, the
    Events or the Claims; they get the same 5 s and 8 MiB. A history is paged at 5,000 versions
    as the series page is, and one over 250,000 versions is not read at all.
12. **`claims.json` lists records, never figures.** A Claim's twins refuse the record with the
    evidence (ADR 0035); the list is the index page as data, so it gives the record, the state
    of the evidence under `redistribute`, and names a file only where that file would be given.
13. **`/docs/api` is written from the tables the routes answer from** (`API_ROUTES`, `LIMITS`,
    Query's caps), and its examples use a Series of the Release being served.
14. **`semantics_version` stays 0.6.0.** No Transform, aggregation or resolution rule changed.

## Not in M24

- Bulk files, `llms.txt`, JSON-LD, Markdown twins for every page (M25).
- MCP (v2.1, ADR 0007).
- Limits shared between processes or kept across a restart. One container serves a Surface.
- A limit on concurrent work. The buckets are admission control; Query's time cap bounds one
  answer.
- `pin=` on the API. A pinned view is the Explorer's (ADR 0032).

## Considered options

- **Limit in each route handler.** Twins and the export would each need it, and a route added
  later could forget.
- **Per-address limit by the socket's address.** Behind Caddy every reader is 127.0.0.1.
- **404 for an unknown key**, as twins do. Tidier; not what section 7 says.
- **Filling the four fields on a 503.** See point 3.

## Consequences

- When Alex signs a row, `series/{key}` and its history follow with no change of code, exactly
  as the twins do. With only the BLS row signed, a production build hands out BLS Series and
  answers 403 for every other.
- The Caddy snippet (M26) must not add a second proxy hop without revisiting point 7.
