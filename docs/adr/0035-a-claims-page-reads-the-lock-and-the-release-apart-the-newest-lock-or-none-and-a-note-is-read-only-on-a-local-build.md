---
status: accepted (M21, 2026-11-12); D7 is open with Alex (its defaults are applied: Claims are drafts, User notes are local only); the worked real Claim has no lock until a register row is signed (D2)
---

# A Claim's page reads the lock and the Release apart, the newest lock or none, and a note is read only on a local build

M21 builds the claim page, the Claims index, the correction log, `/docs/method/claims`, the
evidence downloads and twins, and a reader of `notes/` for the local Profile. ADR 0011 settled
what a Claim is and ADR 0034 how its evidence is computed and frozen. This records the choices
the plan left open about showing it.

## Decisions

1. **Where each number comes from is fixed in one function** (`claimEvidence`,
   `site/src/lib/claims.ts`), which the page and every twin ask. *Then*, *now when checked* and
   their Window sensitivity are read only from the lock; *latest* only from the Release's
   `evidence/latest.json`, for that lock version, and it is marked as the Release's and as not
   part of the lock. The site computes no Evidence row: it has no code path that could put a
   recomputed figure where a locked one belongs.
2. **The newest lock or none.** The candidate is the highest version the Claim lists. If its
   file is not in the Release (`withdrawn`, `not_carried`) the page keeps the record and says
   why there is no number. An older lock whose file the Release still holds never stands in:
   it is superseded evidence. Earlier versions are listed with their reasons and no figures.
3. **The rights gate is asked about the lineage the files record**, not about the Catalog as
   it is now: the lock's `rights_used` and, separately, the latest rows' `rights_used`, with
   `display` for the page and `redistribute` for a file, on this Surface. A denial leaves the
   record (a quote and its sources are not data values) and shows no figure. The release-level
   refusal is untouched: a production build pointed at a local-profile or unsigned Release
   still answers 503 on every route, the new ones included.
4. **The page is figures down, states across.** Each Reading is a table whose rows are the
   Measure's figures and whose columns are Then, Now when checked, Latest; three narrow columns
   fit a phone, and the quote, the sources and the first Reading's then and now figures are
   above the fold at 360×740 on the fixture (the test asks for the figures themselves, with
   48px to spare, because fonts differ between machines). A very long quote would push them down; the quote
   is never cut. Under the table each state says where it comes from, the then row with its
   Basis as a mark and a word. A figure carries its Period and its Data state; an empty figure
   says why; a row that cannot be answered holds no figure and says that none from a later
   time is shown in its place. How many decimals a locked figure is written with is decided
   from the two locked figures alone, so nothing in a Release changes how a locked cell reads.
5. **"One figure showing both" is drawn from the lock.** A small drawing per Reading of the
   locked then and now-when-checked values on one axis: hollow and dashed for then, filled and
   solid for now when checked, both in ink. Only figures that are values of the Series are
   drawn. A chart of the Series over time is not on the page: drawn from the Release it could
   disagree with the locked columns beside it. The Explorer is the door for that, as it is
   today and as known before the statement (`as_of=` the statement's time, or its day), under its own rights checks.
6. **Every declared window is shown** in the Window sensitivity table, the Reading's own first,
   with all three states.
7. **Neutral words.** The page's own text is labels and template sentences that name a
   computation ("The change from January 2025 to November 2025"). No word, mark or colour says
   what the figures show about the statement, and nothing compares a figure with the quote. A
   test asks a list of words that work as a finding, a rating or a label of the text a reader
   sees, in every state the page can be in, with the claimant's own words and the names in the
   record taken out. A party is a word; there is no party colour.
8. **The index** filters by person, party and topic with a GET form, shows a count by party over
   every Claim of the Release whatever is filtered, and gathers every Correction newest first.
   The Claims tab is shown when the Release being served holds a Claim. On a public Surface a
   Release with no Claim has no `/claims` (404): with D7's default that is every public-profile
   Release until Alex publishes the first one.
9. **Twins** (PLAN section 7): `/claims/{id}.json`, `.md`, `/claims/{id}/evidence.csv`, and
   `/claims/{id}/lock.json`. All four need `redistribute` and are 403 with the reason when it is
   refused, as a Series' twins are; the latest rows are values too, so when only they may not
   be handed out all four are still refused, the lock included, and the page offers none. An
   address in the Markdown is percent-encoded so that it cannot open a tag or a link. A Claim
   with no figures to hand out (no lock, or a lock
   named without its numbers) still has `.json` and `.md`, holding the record only.
   `lock.json` is the lock's own bytes so the SHA-256 the Release lists can be checked; nothing
   is added to it, a local build's stamp included (that is in the file's name).
10. **User notes are read from files, by a local build, for a local-profile Release.**
    `notes/{user}/{id}.md` is in no Release (ADR 0033). The site reads the directory named by
    `ATLAS_NOTES_DIR` when a request arrives, and only when the build's Surface is local and
    the Release's Profile is local; otherwise it does not touch the filesystem. A note is
    matched by what it says it is about, must be in its author's folder, is opened without
    following a link and judged by what was opened, and is shown in its own panel marked "Note by
    {user} · {user}'s own, not Macro Atlas's". The twin module is never given a note. Showing
    notes on a public Surface is M44's, if Alex wants it.
11. **`/docs/method/claims`** is a reading page written for a reader of a claim page. Its
    Markdown twin arrives with the other method pages (M25).
12. **The worked real Claim is a draft record with no lock.**
    `content/claims/2023-02-07-biden-on-the-unemployment-rate.md`: the quote from the Daily
    Compilation of Presidential Documents, a second record in the Congressional Record, both
    archived, two Readings of `unrate` with alternative windows. Its figures cannot be computed
    yet: a lock needs a Release of agency values, `atlas capture` fetches nothing while no
    register row is signed, and a Claim cannot be locked on v1's legacy representation
    (ADR 0034, 13). The builder does not work around that (PLAN 6.1, point 6). When the BLS row
    is signed, the commands are in `docs/method/claims.md`; its *then* row will be unavailable
    (nothing was captured before 2023) and the page will say so.

13. **`atlas check` holds content to the Catalog it sits beside.** With the repository's own
    Catalog nothing changes. For a catalog directory elsewhere (`X/catalog/series`, as tests
    and experiments use) the default content is `X/content` and `X/notes`, as the coverage
    matrices and hand-entered files already are, and no longer the repository's: a real Claim
    reads real Series, which a partial Catalog does not have. `--content` still says otherwise.

## Considered and not done

- **A live chart of the Series, then against now, on the page.** See 5.
- **The newest lock that is in the Release.** It would revive superseded numbers. See 2.
- **Record-only `.json` and `.md` when the values may not be handed out.** One address would
  then mean two things; a Series' twins refuse whole. See 9.
- **The drift list on the page.** The drift report is for the editor (M44, the status page).
- **Notes inside a local-profile Release.** ADR 0033 keeps them out of every Release.

## Consequences

- A Release written before 0.4.0 opens with no Claims, no locks and no latest rows.
- A Claim page of a local-profile Release written by `make v2` (the legacy converter) shows
  the record and "This release does not carry its numbers" for any lock.
- When a second user keeps notes, each note is already marked with its author.

## Tests

`site/src/lib/claims.test.tsx` (the reader; the two "comes from" criteria, by changing the lock
and then the latest rows in memory; never an older lock; the gate; the word list; the index;
notes; the twins), `site/src/lib/gate.test.ts` (twin addresses),
`site/tests/built/served.test.ts` (three builds: notes on local and local-profile only,
production shows the record and no figure, 503 on a refused Release), `site/e2e/claims.spec.ts`
(above the fold at 360×740, axe in both themes, 320px, JavaScript off).
