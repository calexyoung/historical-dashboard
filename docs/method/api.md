# The read API

How a program gets what Macro Atlas shows, without the pages (PLAN sections 4.6 and 7; M24; ADR
0038). This page is the contract. `site/src/lib/api` implements the routes,
`site/src/lib/rate-limit.ts` the limits and `site/src/lib/gate.ts` where they are applied; each
is tested from this text (`api/api.test.ts`, `rate-limit.test.ts`, `gate.test.ts`,
`site/tests/built/api.test.ts`, `site/e2e/api.spec.ts`). The page a reader sees is `/docs/api`.
Words in capitals are defined in `/CONTEXT.md`.

## Routes

```
/api/v1                          the routes, as JSON
/api/v1/catalog.json             every Series of the Release as the Catalog records it; no value
/api/v1/series/{key}             the values of one Series
/api/v1/series/{key}/vintages    every version held of each Period; with period=, of one Period
/api/v1/events.json              the Events
/api/v1/claims.json              the Claims as records; no figure
/api/v1/status                   the Release, its age, each source and Series, the last run
```

`GET` (and `HEAD`) only; anything else is 405. No key is needed. Every answer is JSON and comes
from the one Release the proxy fixed for the request. An address under `/api/v1` that is no
route is 404, as JSON, with the routes.

## What every body carries

| Field | |
|---|---|
| `release_id` | the Release the answer was made from |
| `semantics_version` | the engine's rules it was computed by |
| `provenance` | for a Series: Origin, Channel, representation, when it was retrieved, its Recipe. For a body with no value of one Series: the Release (id, created, profile) and `release_sources`, every source the Release was made from. That is the Release's record; an Event or a Claim cites its own sources in its own fields |
| `rights` | `permission` (the Permission asked: `redistribute`, or `none`), `permitted`, and for a Series its Rights status, owner, attribution, terms and the lineage the gate was asked about. For a body with no value, `permission` is `none` and `scope` says in words that this is not a statement about the Series it names: each carries its own |

An as-of answer (`series/{key}?as_of=`) also carries `basis`, `capture_gap` and
`same_day_release`, with `cutoff`, `metadata_in_force` and `left_out_periods`, as
`twins.md` defines them. An unavailable answer is an answer: 200, `basis: "unavailable"`, a
`reason`, no Observation.

A 308 carries the four fields beside `moved_to`. A refusal carries the same four fields beside `error {status, code, message}`, and where it
helps `error.allowed`. On a 403, `rights` is `{permission: "redistribute", permitted: false,
reason}`.

Not JSON, and without these fields, because there is then no Release to name: 503 when no
Release may be served, 421 when a local build is asked from another machine. Both are decided
before anything else, as for every path (`gate.ts`). A 304 and a 405 have no body.

On the local Surface a body that holds values (`series`, `vintages`) has a `notice`: not for
publication.

## series/{key}

The same document as the page's `.json` twin, from the same function, with `links` added. It
takes the twins' parameters (`transform`, `freq`, `agg`, `start`, `end`, `as_of`), which mean
what `twins.md` says. `pin=` is not taken.

## series/{key}/vintages

Every version the Release holds of each Period: value, Status, when Macro Atlas held it
(`held_from`, `held_to`) and when the Origin published it (`published`, `superseded`), in Period
order and, within a Period, oldest first. Beside them: the Captures taken and the days with
none, the Periods that were revised, and when the Series' unit or name changed.

| Parameter | |
|---|---|
| `period` | one Period label. The answer is that Period's history. A Period the Release holds nothing for is an empty list |
| `page` | 5,000 versions to a page. The answer gives `versions_total`, `pages` and the address of the `next` |

A Derived series, a legacy one, or one with no history answers 200 with `held: false` and why.
`rights.lineage` is every Origin, dataset and Channel the history came through, which is what
the gate was asked about; `provenance.current` is the Source today. A history longer than
250,000 versions is not read (422), whatever the page. Each page names its `release_id`: if it
changes between pages, start again.

## catalog.json, events.json, claims.json

- **catalog.json** takes no parameter. Each Series is the metadata twin's fixed selection
  (`twins.md`): name, definition, unit, frequency, Source, Rights, whether this build shows it
  (`state`, `reason`), whether its values are handed out (`downloads`), and, only where it may be
  shown, how far its values run. A Withheld Series is named with its reason.
- **events.json** takes `cat=` (one category). Each Event is a fixed selection: id, date, title,
  category, status, Topics, related Series, sources, description, and its page.
- **claims.json** takes `person=`, `party=` and `topic=`, with the values the index page uses
  (they are in the answer under `options`). Each Claim is its record, `evidence_state`
  (`held`, `none`, `absent`, `not_permitted`), and the addresses of its twins. The figures are in
  the twins, not here; where the evidence may not be handed out the record is still listed, says
  why, and names no file.

## Refusals

| Status | When |
|---|---|
| 400 | a parameter the route does not take; a value outside its list; a parameter given twice; a Transform the Series does not allow; a page that does not exist; **a Series key the Release does not hold**. `error.allowed` lists what may be asked: the parameters and their values, or for a key, `series` (every key in the Release) and the catalog's address |
| 403 | the gate does not permit redistribution: a Withheld Series, an unsigned Origin on a public Surface, a Series that may be displayed and not redistributed (its page still renders) |
| 404 | no such route |
| 308 | a key that was renamed: to the same route under its permanent key, question and all |
| 422 | more than 50,000 Observations, a history over 250,000 versions, or a body over 8 MiB |
| 429 | over a rate limit (below) |
| 503 | no Release may be served; or an answer took longer than 5 s and is not given |

A twin answers 404 for an unknown key; the API answers 400, because PLAN section 7 says so and
because the list of what may be asked comes with it.

## Rate limits

Two token buckets, in the memory of the process that serves the site.

| Bucket | Holds | Refills |
|---|---|---|
| each address | 120 | 2 a second |
| every address together | 600 | 20 a second |

Counted: every request to `/api/v1`, every twin (a Series' four, a Claim's four) and the
Explorer's export. Not counted: pages, the health check, the app's own files. A twin is counted
once, on the pass that recognises its address.

Over either bucket the answer is 429 with `Retry-After` in whole seconds, `no-store`, and for
`/api/v1` and a `.json` twin the JSON refusal above (`code: "rate_limited"`,
`retry_after_seconds`); for any other file, one line of text. A refused request is charged to
neither bucket. The order of refusals is 421, 503, 429, then everything else.

**Whose request it is.** The last address in `X-Forwarded-For`: the one the nearest proxy wrote.
That is the reader's address when exactly one proxy (Caddy, with its defaults, which discard a
forwarded header from an untrusted client) stands in front and the app listens on loopback only
(PLAN 4.8). An IPv6 address is counted with its /64. With no usable header every request shares
one bucket. If another proxy or a CDN is ever put in front of Caddy, this rule would count that
proxy as one reader and must be changed with it. A client that reaches the app without the
proxy can write any address it likes; the bucket for everybody still bounds it, and it is not
what keeps a build private (PLAN 6.1 is).

At most 10,000 addresses are remembered. When that many are, those whose buckets have refilled
are forgotten; if none has, further addresses share one bucket until there is room, so nobody's
count is reset. An address given a bucket of its own starts with what the shared one had left.

The buckets start full when the process starts and are not shared between processes: one web
container serves each Surface.

## Caching

The twins' rule (ADR 0031). A refusal is never stored; nothing is on the local Surface or on
staging. On production an answer the gate allowed carries `Cache-Control: public, max-age=300`
and an `ETag` made from its own bytes; the answer is always made, and so the gate always asked,
before a validator is compared. `/api/v1/status` is never stored anywhere.

No `Access-Control-Allow-Origin` is sent: a page of another site cannot read the API from a
browser. A local build may hold v1's data, and a wildcard there would hand it to any site the
reader has open.

## To see it

```
make v2-dev
open http://localhost:3000/macro-atlas/docs/api
curl -s  http://localhost:3000/macro-atlas/api/v1
curl -s 'http://localhost:3000/macro-atlas/api/v1/series/fx_price_index?as_of=2025-12-13'
curl -s 'http://localhost:3000/macro-atlas/api/v1/series/fx_price_index/vintages?period=2025-11'
curl -s 'http://localhost:3000/macro-atlas/api/v1/series/fx_price_index?transform=cube'   # 400 with the allowlist
```
