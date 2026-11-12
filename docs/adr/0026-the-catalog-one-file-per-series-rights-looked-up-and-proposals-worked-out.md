---
status: accepted (M12, 2026-11-11); sources no agency data (D2 is open, no row is signed)
---

# The Catalog: one file per Series, Rights looked up, proposals worked out

PLAN 5 lists a Series' fields and says the Catalog is files in the repository, checked in
layers by `atlas check` and added to by `atlas add`. M8 and M11 kept a stand-in,
`atlas/vintage/series.json`, "until the catalog of M12". M12 writes the Catalog, migrates v1's
109 entries into it and retires the stand-in. This records the choices the plan left open.
The contract is `schema/series.schema.json`; the rules are `docs/method/catalog.md`.

## Decisions

1. **One file per Series, `catalog/series/{key}.json`, at the top of the repository.** JSON,
   like the register and the release contract, so Python, the Node step and a later
   TypeScript reader need no second parser. A file is named for its key. The directory is let
   into the ingest image's build context; it names Series and Sources and holds no value.
2. **An entry holds no Rights and no Permission.** PLAN's M12 line says the migration adds a
   "rights block"; its acceptance says "no permission is hand-set". Both hold by computing the
   block: the Rights of a Series are looked up in the rights register for its Origin and
   dataset whenever the Catalog is read, exactly as the release writer has done since M9, and
   a Derived series takes the most restrictive status of the stored Series it rests on with
   all their owners and attributions (ADR 0025). The schema is closed at every depth, so
   `rights`, `display`, `permissions` and the like are refused where they are typed. ADR 0020
   already said a grant is a signed decision and nothing else; now nothing else can even be
   written down.
3. **A stored Series names a Source; a Derived series names a Recipe and no Source.** ADR
   0025 gave a Derived entry one Origin "as a label" because the release contract's entry has
   room for one, and left a proper lineage to M12. In the Catalog the lineage is the Recipe's
   inputs and nothing else. The release writer still writes the label into a Release; that is
   the release contract's shape and is not changed here.
4. **`draft` means declared and nothing more.** Only a Series that is not a draft and (if
   stored) names an Endpoint is in the series table the vintage store replays and the writer
   publishes from. So migrating 109 entries puts no new Series in a store or a Release: the
   table is the same four BLS Series and `cpi_yoy`, with the same bindings, recorded metadata
   and Recipe. Their Catalog entries in a future Release do read differently in four fields
   that are no part of the recorded history: `country` (decision 14), `topics`, `base_period`
   for the two CPI indices, and `price_basis` where the stand-in left it out. A local Release keeps v1's Series, whole
   and under v1's own provenance, for every key not yet live (ADR 0016); a test builds one
   with the committed Catalog and finds no proposed Source in it. A favourable proposal
   authorises no capture, storage or display.
5. **A retired Series that was bound stays in the series table,** so that its history is
   still replayed and shown. Replay eligibility is "bound and not a draft", not "active"; a
   Derived series likewise stays unless it is a draft, and one that is not a draft may not
   rest on a draft.
6. **The dated metadata versions keep the shape the store replays.** An entry's own `name`,
   `unit` and `seasonal_adjustment` are the version in force; earlier ones sit in
   `earlier_metadata` with their own `from`, and `metadata_from` dates the current one. Every
   version states all three fields, so moving one into `earlier_metadata` changes nothing. A
   test replays the vintage fixture through a catalog directory with a version taking effect
   between fetches and gets, byte for byte, the store the M8 table file gives.
   `atlas/vintage/series.json` is deleted; `--series` takes a catalog directory or a table
   file of the M8 shape, which the fixtures still use.
7. **"No free publishable source" is three different findings and the entry says which.**
   `source.channel` is null and `no_channel.kind` is `rights_restriction` (the register's own
   reading: index levels, D5), `no_route_established` (nobody has found or assessed an
   origin route: exchange-traded prices, the debt ratio, sentiment) or `discontinued`. All
   three are withheld; they are not the same claim.
8. **A key keeps its quantity.** Each migrated entry records how the proposed figure relates
   to the one v1 showed: `same`, `representation` (the same quantity at another cadence,
   unit, scale or base: `debt` daily in dollars, `gs10` and `gs2` by business day) or
   `different`. A different quantity takes a new key. So the five interbank rates stay
   proposed from the OECD, which needs D2, and BIS policy rates are noted as new Series for
   v2.2; month-end gold is withheld and not replaced by the IMF's monthly average. The one
   `different` is `cpi_yoy`, the exception ADR 0025 recorded and left open with Alex.
9. **The three-way table is worked out, and reads proposals, never decisions.** *re-source
   from X*: a direct or hand-entered Channel, a register row for the Origin, and a proposal on
   that row to allow display. *needs D2*: an intermediary Channel, an Origin with no row, or a
   row that proposes no display. *withheld*: no Channel. A Derived series takes the least
   favourable of what it rests on. Because it reads no decision, signing a row does not make
   the committed table stale, and it is labelled advice: the rights gate's own answer is
   printed separately by `python -m atlas catalog`. "Still open" says what else stands in the
   way (adapter, identifier, representation, open questions on the row).
10. **Election margins are proposed from the official record, not Wikipedia.** The register's
    Wikipedia row already says so. The entries name the Federal Election Commission, which has
    no row yet, so they need D2. v1's label is kept in `migration.v1_source`.
11. **`t10y2y` becomes a Recipe** (`gs10` less `gs2`). v1 took a spread FRED computes; no
    agency publishes it and the Board publishes both yields. That is a sixteenth Recipe beyond
    the fifteen the plan names. `debtgdp`, which FRED also computes, is not made one: it needs
    nominal GDP and a ratio in percent, and the Catalog and the engine have neither yet.
12. **The other thirteen year-over-year Recipes take v1's own parent.** `corecpi_yoy` is over
    the adjusted index as v1 computed it, while `cpi_yoy` is over the unadjusted one (ADR
    0025). That inconsistency is deliberate here and is Alex's to settle with the open
    question on `cpi_yoy`; M12 does not widen an exception he has not approved.
13. **`atlas check` is the layered check, and v1's data check moves to `atlas check --v1`.**
    The plan gives the name to the Catalog's validation from here on (M19 and M20 add layers).
    `make check` calls the flag, so v1's routine on this branch is unchanged; `main` and
    `refresh.yml` are not touched. A layer runs only if the layers before it passed.
14. **`country` is ISO alpha-3, with group codes** (EA, EU, G20, WLD), as the release contract
    says. The schema checks the shape (three capital letters, or one of the four), not the
    list of countries. The stand-in table wrote `US` for the four BLS Series; they are `USA` now. That
    field is no part of the recorded metadata history, so nothing is revised.
15. **The migration script is kept and not re-run.** `scripts/migrate_catalog.py` is the
    record of how the files were first written. No test holds the files to its output, since
    the next milestone edits them.

## Considered options

- **One `catalog.yaml`, as v1 and research 03 had it.** One file is easy to scan and hard to
  review: every milestone that binds an adapter would touch it. `atlas add` writing "a draft
  file" (PLAN 5) is literal with a file per Series.
- **A generated Rights block stored in each entry and checked against the register.** It
  satisfies the plan's wording to the letter and puts 127 copies of the register's text in
  files a person edits. A copy that can be stale is a copy someone will trust.
- **Keep `series.json` beside the Catalog.** Two places to say what `cpi` is.
- **Type the three-way disposition into each entry.** It would be a judgment about rights
  written in the Catalog, which decision 2 exists to prevent, and it would go stale when the
  register changes.
- **Put every migrated Series in the pipeline and let the writer withhold them by name.** That
  is M16's acceptance. Doing it here would make the public Release's withheld list depend on
  proposals nobody has verified.
- **Replace a v1 series with the nearest agency figure under the same key.** Rejected by the
  glossary: a Series has a fixed definition.

## Consequences

- Binding a Series to an adapter is an edit to one file: the Endpoint, the identifier,
  `status: active`. `atlas check` then holds it to the register's endpoint list.
- 70 of the 127 are proposed from an Origin, 24 need D2 and 33 are withheld (of v1's 126:
  69, 24, 33). Eight Origins need a register row before anything can be decided for 13
  Series. Every one of these is a proposal: the gate shows none of them on production today.
- Identifiers the migration wrote for the Fed Board, BEA, Eurostat, the World Bank and others
  are unverified until the milestone that builds each adapter captures a fixture. Where it
  did not know one it wrote null. Only the BLS identifiers were checked against the source.
- The release contract's Catalog entry is unchanged, so a Release does not yet carry
  `refresh`, `fallback` or the migration note. A later version of the contract can.

## Open with Alex

- **Eight Origins without a register row** (ONS, ECB, the New York Fed, the Department of
  Labor, Freddie Mac, the Economic Policy Uncertainty project, the NBER, the FEC). Each needs
  its terms read and a row; until then their Series are "needs D2".
- **`cpi_yoy` and its siblings** (decision 12): one rule for all the CPI-family
  year-over-year series, adjusted or not.
- **D5** stands as recommended: index levels are withheld by name.
