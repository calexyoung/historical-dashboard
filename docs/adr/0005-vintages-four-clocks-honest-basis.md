---
status: proposed (awaiting Gate 1)
---

# Vintages: four clocks, an honest basis, and no reproduce mode

Checking a claim needs "what did the data say before this date", so v2 keeps history. Each stored
value carries four separate times: the period it describes, when the provider published it (if
known), when Macro Atlas held it, and the release it appeared in. Every as-of answer states its
basis: provider, Atlas-observed, legacy, uncertain or unavailable. An unavailable answer is never
filled with today's figure. A change of unit, definition or source counts as a revision even when
the numbers match; a period that disappears is recorded only if the fetch was complete; unchanged
fetches are logged, because they are what proves "still this value on that day".

We do not build a mode that recomputes any old answer exactly. Claim locks store the numbers, the
resolved periods and windows, the basis and cutoff and the recipe identity, so they are exact for
good without recomputation. A `pin=` link pins the data (a retained release),
not the computation: today's engine draws it, and the page says so.

## Considered options

- **Full reproduce mode** (rows tagged with the snapshot that opened and closed them, every engine
  version kept executable). Intellectually right, but a large invariant to carry through dozens of
  autonomous PRs, and locks already give claims what they need.
- **No vintages until the VPS runs.** Every day without a capture is Atlas-observed evidence lost
  for good; provider archives can fill in only a few headline series.

## Consequences

- "First observed by Atlas" and "first reported" are different words in the UI and the API.
- Coverage starts thin and grows daily. Provider vintages (for example the Philadelphia Fed
  real-time data set) are a later import and depend on their terms.
