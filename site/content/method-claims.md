# How a claim record is built

A claim is a public statement by an official, a candidate or a named commentator that can be set beside data. Macro Atlas keeps the statement as a record and computes the figures needed to examine it. It gives no finding, rating or label: no file, page or download has a place for one. What the figures say about the statement is the reader's to decide.

## The record

Each claim is one file. It holds the statement and where it can be checked, and it says how the statement is measured.

| Part | What it holds |
|---|---|
| Quote | The words, verbatim. |
| Claimant | Who said it, with the role and the party held on that day. |
| Day and venue | The New York calendar day, the time when it is known, and where it was said. |
| Sources | Two or more records of the statement at different addresses. Each has an archived copy, a locator (a time in a recording, a paragraph or a page) and says what kind of record it is: a recording, a transcript, the claimant's own publication or a report. |
| Readings | Each way the words are measured. See below. |
| Readings not measured | Other ways the words could be read that this record does not measure, a line each. |
| Selection note | Why this statement was recorded. |
| Checked on | The day the record was made and its figures computed. |
| Correction log | Every change after the record was first kept, with its date and reason. It is always present, and empty when there is none. |

## Readings and measures

A reading turns the words into something that can be computed: one series, at one frequency, re-expressed one way (as it is, or for example as the percent change from a year earlier), with one measure. A statement may have several readings. A measure is one of five fixed computations. Each returns numbers, never true or false.

| Measure | What it returns |
|---|---|
| Value at a period | The value of the series in that period. |
| Change over a window | The values in the first and the last period that start inside the window, the change between them, and the percent change. |
| Extreme in a window | The highest or the lowest value in the window, the period it fell in, and how many periods had a value. |
| Rank in a window | Where one period stands among the periods of the window, counted from the highest or from the lowest, and out of how many. |
| Difference | The values in two named periods and the second less the first. |

The periods are fixed by the calendar before any value is looked at. If one of them has no value, the figure is empty and says why; no other period stands in. Nothing is rounded in the computation. A page rounds for reading and its files carry the numbers as computed.

## Then, now when checked, latest

Every reading is computed against three states of the data. They are shown side by side and never mixed.

| State | What it is |
|---|---|
| Then | What was public before the statement: before its time when the time is known, otherwise before 00:00 in New York on its day. A figure first published later that day does not count. |
| Now when checked | The same periods on the day the claim was recorded, in the release it was computed against. |
| Latest | The same periods in the release being served. It is computed afresh for each release and is not part of the lock. |

The then figures carry a [basis](/docs/glossary/basis): the kind of evidence that the values were public by then. It is shown as a mark and a word, for example [Atlas-observed](/docs/glossary/atlas-observed) or [Unavailable](/docs/glossary/unavailable). When nothing says what was known then, the answer is unavailable and the cell is empty. A later figure is never put in its place.

A figure that was preliminary, revised or an estimate when it was read carries that [data state](/docs/glossary) beside it.

## Window sensitivity

A change, an extreme or a rank depends on the window it is taken over. The record declares the reading's own window and may declare alternatives. The same measure is computed over each, in all three states, and the results are shown together so a reader can see how much the choice of window matters. Every declared window is shown.

## The lock

When a claim is recorded, its then and now-when-checked figures and their window sensitivity are frozen in a lock, with the release they were computed on, the version of the engine's rules, every origin and channel the numbers came through, and a hash of the record itself. A lock is never edited. If the record or the method changes, the claim is recorded afresh: a new version is added with the reason, and the earlier versions stay.

A page shows the figures of the newest lock only. If that lock's numbers may not be shown, because a permission was withdrawn or the release does not carry them, the page says so and shows no numbers; an earlier lock does not stand in.

Each release also recomputes the then row and compares it and the latest row with the lock. Differences are listed for the editor with no cause named. They change nothing on their own: only a person records a claim afresh.

## Files

A claim page's address is also the address of its data. Add `.json` or `.md` for the record and its figures, `/evidence.csv` for every figure a line each, and `/lock.json` for the lock exactly as it was written, so the hash the page lists can be checked. A file of figures is offered only where the rights of every series behind it allow redistribution.

## What is not here

Macro Atlas does not say whether a statement is accurate. A user may keep notes of their own on a claim. Those are that user's, are marked with their name where they are shown, and are not part of any release, file or download.
