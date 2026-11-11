---
status: accepted (M7, 2026-11-11); the job has not started (D2 and D6 are open)
---

# The capture kit: raw bytes, evidence, and an endpoint list that lives in the register

ADR 0012 says the first thing to run daily is a small job that fetches rights-cleared agency
endpoints and keeps the exact bytes with the retrieval time, request, headers and paging
evidence. M7 builds that job and the adapter contract it stands on. This records the shape.

## Decisions

1. **The endpoint list is part of the rights register.** An origin row of
   `schema/rights-register.json` may carry `capture`: the endpoints fetched under that row's
   terms, each naming its adapter, its datasets and its parameters. There is no second list.
   Listing an endpoint permits nothing.
2. **A run fails closed on rights, before the first request.** `atlas capture` asks
   `RightsGate.may_store` for every dataset of every selected endpoint. One refusal fails the
   whole run and nothing is fetched. An uncleared endpoint is never skipped quietly: that would
   hide a mistake in the table. `--only` narrows the selection first, so one signed row can run
   while others wait, and that choice is visible in the command.
3. **After that a run fails soft per endpoint.** A source that fails, or answers in part, does
   not stop the others. The run ends non-zero, having kept everything it did receive.
4. **The adapter contract.** `fetch` makes the requests and returns *completeness evidence*:
   the scope (what was asked for), the checks (what came back) and the problems (every reason
   the answer is not whole). `examine` is the same judgement from kept bytes alone. A failure
   raises `CaptureError`. `parse` (BLS only in M7) turns a capture into observations whose
   values are the provider's own text, and reports `complete: false` rather than guess.
5. **Complete is complete for a scope.** The BLS endpoint asks for the ten years ending this
   year, the most the API gives without a key. Each January a year leaves that window. The
   scope is recorded with every capture so that M8 can tell "not asked about" from "gone": a
   Period outside the scope is never a tombstone. An unpublished month that BLS prints as `-`
   is an Observation with status `unavailable`, not a deletion and not a number.
6. **Complete is about structure, not freshness.** Whether the newest value is recent is not
   judged at capture; staleness is a property of a Series in a Release.
7. **What is kept.** `raw/{source}/{utc day}/{sha256}.gz` holds one response body: the bytes
   after HTTP content decoding, named by their SHA-256, gzipped without a timestamp so the same
   bytes make the same file. `fetchlog.ndjson` has one line per Capture attempted, with a
   capture id, the run id, the register version and hash, each request and response (status,
   headers, time received, hash, blob), the tries that were repeated, the evidence, and an
   outcome: `captured`, `incomplete` or `failed`. A Capture's retrieval time is when its last
   part arrived. Identical bytes fetched twice are two lines and one blob: the second line is
   what a capture confirmation is made from. Blobs are written before the line that names
   them. Cookie values are not kept, and any configured secret is replaced before writing.
8. **Times.** Retrieval times and blob paths are UTC, whole seconds, rounded up: a value was
   public no later than the time recorded. *Expected capture days* are New York days, where the
   releases happen (PLAN 4.7). An endpoint is due every day from the first run that selected
   it, whether or not that run got anything; a finished day with no whole capture is reported
   as missed, in the run's output and in `runs.ndjson`. Missing a day does not fail today's run.
9. **Fixtures are recorded exchanges, and committing one is redistribution.** A fixture is a
   directory of readable files: the requests, statuses, headers and times, and each body byte
   for byte. `--replay` runs the real adapters against them with the recorded clock, and a
   request with no recorded answer fails rather than reach the network. `--export-fixtures`
   writes a store's captures in the same form, and for bytes that came from the network it
   requires the register to allow `redistribute` on production. A store written by replay and
   a store written from the network are never mixed.
10. **The committed fixtures hold invented values for now.** The repository is public and no
    row is signed, so the three fixtures copy the *shape* of each source's answer of
    2026-11-11 and none of its numbers, and say so in their provenance. A test allows a
    fixture to be real only when its row is signed for redistribution.
11. **The job's home is not this repository.** `deploy/capture/capture.yml` is a file to copy
    into a separate private repository (D6). It pins the Macro Atlas commit it runs, so the
    register the job obeys changes only when Alex moves the pin, and it commits what was
    captured even when the run fails.

## Not met yet: real captured fixtures

M7's acceptance asks for "a captured fixture for one endpoint of each of the three sources".
The kit captures all three live (checked on 2026-11-11: each answer passed its completeness
checks; nothing was stored). Committing those bytes to a public repository waits for D2. When
the rows are signed for redistribution: run `atlas capture`, then
`atlas capture --export-fixtures fixtures/capture`, and commit the result.

## Considered options

- **A separate endpoint file beside the register.** Two places to keep in step, and a way to
  list an endpoint with no row. Rejected: ADR 0020 already said the list goes on the rows.
- **Skip uncleared endpoints and capture the rest.** Friendlier on day one, but a row unsigned
  by mistake would then lose days without a red run. `--only` gives the same freedom openly.
- **Commit real agency bytes now, since the proposals say public domain.** A proposal is not a
  decision; only Alex signs.
- **Fixtures in the store's own format.** Gzipped blobs cannot be read in review.
- **UTC days for missed-day counting.** A 17:30 ET run and the next morning's would share one
  UTC day in summer and not in winter.

## Consequences

- With today's register `atlas capture` exits 1 and names the three unsigned rows.
- M8 replays `fetchlog.ndjson` through `load_capture`, which checks every blob against its
  hash and returns the original retrieval time and the recorded scope.
- M13 adds `parse` for Treasury and the Fed Board and replays the captures made since the job
  began; adding an endpoint is an edit to a register row plus, where needed, an adapter.
- A BLS key (none exists) would lift the ten-year window; the adapter does not use one yet.
