---
status: accepted (Gate 1, 2026-11-11)
---

# Claims are records and locked evidence; the site gives no verdict

Macro Atlas is a neutral source of data. Alex decided on 2026-11-11 that the site puts no finding,
rating or label on a claim, including neutral-looking words that work as one. So a claim is a
record (verbatim quote, claimant, date, two archived sources, readings) plus the data needed to
examine it: the figures public before the claim (*then*), the same periods on the day it was
recorded (*now when checked*), the same periods today (*latest*), and window sensitivity. Measures
return numbers, never true or false. The engine has no rubric.

The *then* and *now when checked* rows and the window-sensitivity table are frozen in an
append-only lock, so a data revision or a code change cannot alter published evidence. The *latest*
row is recomputed at every release; a difference produces a drift report and only a person
re-locks.

Any judgment is a user's own. It lives in a separate layer of user notes, marked with the user's
name, kept outside the content directory and out of every data file. In v2.0 notes exist only on a
local build.

`atlas check` enforces the record rules: two independent archived sources per quote, a selection
note, a visible correction log, and schemas with no field that could hold a finding. The claims
index shows a count by party. `ClaimReview` markup is never emitted, because it requires a rating.

## Considered options

- **A derived finding from a published rubric** (both plan drafts). Accountable and consistent, but
  it makes the site a judge, and any fixed vocabulary ("missing context", "selective") reads as a
  verdict however it is computed.
- **Hand-typed verdicts.** Fast, unaccountable, and the same objection.
- **Recompute evidence on every page view.** Simple, and wrong: yesterday's evidence could change
  silently.

## Consequences

- The choice of readings and windows is still a judgment. It is made visible, not hidden: readings
  not measured are listed, and every declared window is shown.
- Claims stay out of PUBLIC entirely (not merely unlinked) until Alex marks them public.
- No causal statements. A causal claim is examined only on its factual premises.
