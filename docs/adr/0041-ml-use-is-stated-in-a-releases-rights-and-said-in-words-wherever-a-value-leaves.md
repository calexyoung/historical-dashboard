---
status: accepted (2026-11-12); Alex chose "IMF option 1" that day: make "not for ML use" real, then sign the IMF row with ML use refused. The wording of the sentence is his; where it is said, the two fall-back wordings and the shape of the fields are the builder's choices and his to change
---

# ML use is stated in a Release's Rights, and said in words wherever a value leaves the site

The rights register has always had a fourth grant, ML use: "describe as usable for model
training" (CONTEXT.md, Permission; ADR 0020). Until now nothing read it. Every signed row said
yes, so a file that said nothing was true by accident. The International Monetary Fund's terms,
as summarised, reserve the use of its data to train large language models. Alex decided on
2026-11-12 to sign the row with ML use refused and everything else allowed. A refusal that no
file states is not a refusal a downloader can honour, so this change makes it something every
file says, and then signs the row.

## Decisions

1. **Contract 0.8.0: a Catalog entry's Rights state `ml_use`.** A boolean, required of every
   entry of a 0.8.0 Release. It is the gate's answer for the Permission `ml_use` on the
   production Surface when the Release was written (`RightsGate.ml_use`, Python): the Origin
   and dataset's row signed and saying yes, and for an intermediary Channel its own row and its
   clearance. An unsigned row, an Origin the register does not list, the legacy representation
   and a register that cannot be trusted are all false. The writer looks it up; no Catalog
   file (`catalog/series/*.json`) states it.
2. **`ml_use_reserved_by` says whose terms.** When the answer is no because a *signed* row
   says no, the Rights name each such row (its `name`), once. When it is no only because a row
   is not signed, not listed or not cleared, nobody is named: rights that are not settled are
   not a reservation, and the sentence must not say they are.
3. **A Derived series is as restricted as what it is computed from.** `ml_use` is true only
   when it is true of every stored Series the Recipe reaches, to any depth, and everybody any
   of them names is named. Both validators hold a Release to this (issue code `ml_use`): a
   Derived series may be stricter than its inputs, never looser.
4. **An older Release says nothing, and silence is no permission.** Releases of 0.1.0 to 0.7.0
   stay readable and need not carry the field. Every reader takes its absence as false.
   A reuse (a content-only Release, a withdrawal) carries the Catalog over and states `ml_use`
   afresh from the register as it reads that day (`export.refresh_ml_use`), so a Release
   written from an older one is a valid 0.8.0 Release.
5. **One sentence, in both languages.** `ml_use_note` (Python) and `mlUseNote` (TypeScript)
   make it from a Rights block, and `checks/ml-use-cases.json` holds them to the same words:
   - *Not for use in training machine-learning models: {name}'s terms reserve it* (two names:
     "A's and B's terms"; more: "A's, B's and C's terms");
   - *…: its rights are not settled*, when nobody is named;
   - *…: this release does not record whether its terms allow it*, when the field is absent.
   Where `ml_use` is true nothing is said: no file carries a line that says "this may be used
   to train a model".
6. **The site asks twice and takes the stricter.** `mlUse(release, surface, entry)`
   (`site/src/lib/ml-use.ts`) reads the Release's statement, then asks the gate today for the
   Permission `ml_use` over the Series' whole lineage, and for past versions over everything
   the history came through. A signature that changed after the Release was written is
   therefore not passed over, and neither is a history fetched under other terms; the sentence
   is then *…: the rights register does not allow it today ({the gate's reason})*. On the
   local Surface the gate permits everything, so only the Release's statement speaks.
7. **Where it is said.** Wherever a value of the Series leaves the site:
   - the series page: a fact, "Machine learning", among the Rights of the provenance block;
   - its twins: a `# ` note line in `.csv`; `rights.ml_use` and `rights.ml_use_note` in
     `.json` and `.metadata.json`; a quotation under the title and the provenance fact in `.md`;
   - the read API: `rights.ml_use` and `rights.ml_use_note` in `series/{key}`, in
     `series/{key}/vintages` and on every row of `catalog.json`;
   - the Explorer's exports: a note line in the view's CSV and in "every series as one file",
     naming the Series; a line in the SVG, so the PNG a browser makes from it carries it;
   - page twins: under the row of a headline Series (`/index.md`, `/highlights.md`, a
     Topic), on a counted member of a range, in the Rights cell of `/data.md`, through the
     export's notes in `/explore.md`, and per file in `/downloads.md`;
   - `/llms.txt`: on the Series' line, with a paragraph that says what the flag is called;
   - JSON-LD: `conditionsOfAccess` on the Dataset;
   - a Claim's files (`.json`, `.md`, `evidence.csv`): for the Series its Readings are
     computed from, and for the lineage its lock and its latest rows recorded, asked of the
     gate today.
8. **Bulk files carry it in every row.** `observations.*` and `vintages.*` have a boolean
   column `ml_use`. For a version it is one answer for the whole history, the stricter of the
   Series' own and the gate's for everything the history came through. Each resource of
   `datapackage.json` has `ml_use` (true only when every row is) and `ml_use_reserved` (each
   Series that is not, with the sentence), and says it in its description, as does the
   package. The files by licence class are resources like any other, so each class says its
   own. The validators hold a resource to the Catalog (it may reserve more, never less) and
   the writer's check holds it to the rows. The CSV stays a plain table with no comment line.
   A file's bytes cannot be made to say something new, so the site asks at the door: a file
   is handed out only if every Series it does not itself mark false is allowed for `ml_use`
   by the gate today (for versions, with their history). Otherwise it is refused whole, 403,
   as a file that may no longer be redistributed is.
9. **The IMF row is signed** (register 2026-11-12.5): display, redistribute and store true,
   `ml_use` false, by Alex on 2026-11-12. On bulk downloading he judged that two small
   requests a day (about 1.1 MB) are not that, to be looked at again if the job grows or the
   Fund says otherwise. The wording of the terms was read through extracts and no read of the
   page by Alex is recorded; that stays an open question on the row, as does what a national
   statistics office's own terms add.

## Considered and not done

- **Reading the row's decision in the writer instead of asking the gate.** One decision is
  not the answer: the gate also asks the Channel's row, its clearance and the representation.
- **One wording for every no.** "X's terms reserve it" would be untrue of a row nobody has
  signed. Hence the names in the contract and the second wording.
- **A per-licence-class summary at the top of the datapackage.** The files by class already
  say it, and a second statement of the same thing is a second thing to keep true.
- **Refusing a Release older than 0.8.0 that carries the field.** It costs every kept Release
  a rule and protects nothing: the field can only say no more loudly.

## What this does not do

- **A raw Claim lock (`/claims/{id}/lock.json`) is handed out as the bytes it was written
  as**, and those bytes do not carry the sentence; its hash is in the Release. The Claim's
  other files do. A lock contract that states it would be a later version of that contract.
- A reading page that is not a file (the Overview, Highlights, the Explorer on screen) shows
  values without the sentence; the series page and every file made from those pages have it.
- On a local build a row that is classified and not signed reads as "rights are not settled",
  which is what it is. The local Surface is never public (PLAN 6.1).
- Nothing here stops anybody training a model. It makes the condition impossible to miss in
  what they take away.

## Evidence

`tests/v2/test_rights.py` (the gate's answer and the shared sentences), `tests/v2/test_release.py`
and `packages/core/src/release/release.test.ts` (the shared cases of `checks/release-cases.json`),
`tests/v2/test_publish_bulk.py` (the Catalog of a written Release, the column in pandas, polars
and DuckDB, the datapackage, the check), `tests/v2/test_publish_edges.py` (a reuse from 0.7.0),
`site/src/lib/ml-use.test.tsx` (each surface of the site, for a Series that reserves it and one
that does not), `site/tests/built/` (the built server).
