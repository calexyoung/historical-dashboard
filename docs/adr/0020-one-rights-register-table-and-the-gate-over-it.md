---
status: accepted (M6, 2026-11-11)
---

# One rights register table, and the gate over it

ADR 0006 says a public release is built from an allowlist that Alex signs, and PLAN 6.1 says how
v1's data is kept off public surfaces until he has. M0 shipped the question every export, twin
and query asks, `permits(rightsUsed, surface)`, with a body that allowed the local surface and
nothing else. M6 writes the register and puts it behind that question. This records the shape.

## Decisions

1. **One table.** `schema/rights-register.json` is the register: one row per Origin and one per
   intermediary Channel, each with the terms pages read, short quotations, a licence class, an
   attribution, a proposal with its reason, open questions, and a `decision` that is null until
   Alex signs it. `docs/v2/rights-register.md` (for reading) and
   `packages/core/src/rights-register.generated.ts` (the rows the TypeScript gate reads, without
   the prose) are generated from it and checked by `npm run gen:check`. Python reads the file.
   There is no second place where a permission can be written.

   *Note, 2026-11-12.* "One row per Origin" is no longer exact. A row covers an Origin's
   datasets: all of them (`"datasets": "*"`) or a named list, and no two rows may cover the
   same dataset of one Origin (the gate refuses a table where they do). Since the Energy
   Information Administration's row was split that day, one Origin has two rows: `eia` (retail
   gasoline and electricity generation, signed) and `eia-spot-prices` (not signed). The table
   is still the one place a permission is written.
2. **A grant is a signed decision, nothing else.** A decision says yes or no to display,
   redistribute, store and ML use, and carries `signed_by` and `signed_on`. The gate accepts
   only the signer named in its own code, and a real date. The proposal is advice and is never
   read by the gate. This is what ADR 0006 means by Permissions being derived and not typed in:
   no Catalog entry, Release or caller can state a permission; each is looked up from the
   decision on the register row. `tests/v2/test_rights_register.py` holds the list of rows Alex
   has signed, which is empty, so a decision cannot appear in the table unnoticed.

   *Note, 2026-11-12.* That list is no longer empty; the test holds whatever it names. And
   from contract 0.8.0 a Release's Catalog records, for each Series, the gate's answer about
   ML use on the day the Release was written (ADR 0041). That is a record of the decision for
   a reader of a file to see, not a second place to grant one: the writer looks it up from the
   signed row, and the site asks the gate again and takes the stricter of the two.
3. **What the gate asks on a public Surface**, for every row of a lineage, most restrictive
   wins: the representation is not legacy (refused whatever the register says); the Origin and
   dataset have a row, signed, that says yes; and, for an intermediary Channel, the Channel has
   its own row, signed, that says yes, and is named in `cleared_intermediaries` with the date of
   an amendment to ADR 0006 that Alex approved. Unknown Origin, dataset or Channel is a refusal.
4. **Which Channels are intermediaries is fixed in code.** `direct`, and Macro Atlas's own
   routes (`computed`, `hand_entered`, `fixture`), have no terms of their own and take no row.
   Every other Channel is an intermediary. The table cannot reclassify one.
5. **Rows for one Origin may not overlap.** An Origin has one row for all datasets, or rows
   that each list datasets; two rows that cover the same Origin and dataset make the table
   invalid. So at most one origin row answers any question, and clearing one dataset of an
   Origin is done by narrowing its row, in plain sight.
6. **A table the gate cannot trust permits nothing public.** A missing or unreadable file, an
   unknown format, a duplicate id, a decision by another signer, a row for `direct`: each gives
   a gate that refuses staging and production and says why. It never raises, and the local
   Surface is not affected. `python -m atlas rights` exits non-zero on such a table.
7. **Storage is a separate question with no Surface in it.** `RightsGate.may_store(origin,
   dataset, channel)` (Python only; capture is Python's, ADR 0002 and 0012) needs a signed row
   that allows `store`, and the same intermediary rule. Running on one machine clears nothing.
   M7's capture job asks it, and adds its endpoint list to the rows it uses.
8. **What a Release records.** `rights_register.version` is the table's `version` and `sha256`
   is the hash of the file's bytes (`register_identity()`). `signed` is for M9's writer to set,
   true only when every row the Release rests on is signed in that file. It stays a second,
   independent check (ADR 0015): it never authorises a Series. A reader's gate asks its own
   copy of the register, so a decision withdrawn later refuses a retained Release's data too.

## Known gap: staging

PLAN 6.1 lets a local-profile Release be served on staging behind a password that covers every
route. The gate does not know whether a password is there, so it counts staging as public, as
M0 did: on staging, Query, exports and the Explorer refuse everything until rows are signed,
and refuse legacy data always. That is stricter than 6.1 allows and it is deliberate; a staging
site that shows v1's data would need the build to tell the gate that it is password-protected,
with the deploy check 6.1 already requires. That is left to the milestone that first deploys
staging (it needs Alex's server credentials) and is not decided here.

## Considered options

- **Permissions derived from the licence class alone.** Fewer fields, but one class does not
  fit one answer: the IMF's terms as read allow display and reserve model training, and
  OpenFEMA's allow everything with a required sentence. Alex's decision per row is explicit
  instead, and the licence class is description.
- **A wildcard row per Channel that covers any Origin.** A signed wildcard would admit an
  Origin nobody had read. Channel rows carry only the Channel's own terms; the Origin's row is
  always needed as well.
- **Most specific row wins.** A signed dataset row under an unsigned Origin row would then
  open quietly. Overlap is invalid instead.
- **The register written in Markdown and parsed.** A table in prose is easy to read and easy to
  break. The JSON is the table; the page is drawn from it.

## Consequences

- Nothing changes on any Surface today: no row is signed, so the gate answers as M0's did. The
  first signed row changes what staging and production may show without a change of code.
- Signing takes Alex four small edits (the row, the version, the test's list, `npm run gen`),
  described at the top of `docs/v2/rights-register.md`.
- A new source needs a row before its data can leave the local Surface, and a new Channel name
  is an unknown intermediary until it has a row and an amendment.
- Derived Series in M11 must be catalogued under an Origin that has a row (`Macro Atlas`), and
  their inputs are asked about one by one, as `rightsLineage()` already does.
