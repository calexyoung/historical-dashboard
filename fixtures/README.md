# Fixtures

`public/` is the committed **fixture release**: a small, valid, public-profile Release in the same
layout as `$ATLAS_PUBLIC` (`releases/{id}/` and `CURRENT`). It backs every TypeScript test, CI
preview and screenshot (PLAN section 9).

Every value in it is invented. It holds nothing from FRED, Yahoo or any agency, which is why it
may appear in CI logs and artefacts when v1's real data may not (PLAN 6.1). Keep it that way:
tests that need v1's values build a local release in a temporary directory instead.

| Series | What it is there to exercise |
|---|---|
| `fx_price_index` | monthly; one explicit gap; a preliminary latest value |
| `fx_output_quarterly` | a sparse quarterly flow; one missing quarter; revised and estimate statuses |
| `fx_poverty_rate_annual` | annual; a rights status that asks for a citation |
| `fx_vote_margin` | held (step), irregular: one value per election |
| `fx_price_index_yoy` | derived by a Recipe, in `derived/` |
| `fx_exchange_index` | withheld: in the catalog by name, no values anywhere |
| `fx_payrolls_break` | a break, with its `data_note` Annotation |
| `fx_permits_stale` | stale: ends eighteen months before the release was created |

Annotations cover every anchor type (date, span, open-ended span, period) and the kinds event,
recession, governance, policy and data_note.

Three Series carry a vintage file (`vintages/`), each version written out by hand in
`make_fixture.py`. Captures are daily from 8 December 2025 with none on 12, 13 and 14 December.

| Series | Its history |
|---|---|
| `fx_price_index` | Atlas-observed: October revised on 10 December, November added then and revised on 15 December, after the three-day Capture gap |
| `fx_output_quarterly` | provider vintages: an archive of the Origin's releases, complete from April 2022 to 8 December 2025; two quarters revised, one of them dated only to the day |
| `fx_poverty_rate_annual` | a metadata change on 9 December; 2012 to 2015 were not asked about again and keep the earlier unit |

`node scripts/as-of.mjs fx_price_index 2025-12-13` prints an as-of answer from it
(`docs/method/vintage-resolution.md`).

To change it, edit the literals in `make_fixture.py`, run `python fixtures/make_fixture.py` and
commit the result. A test fails if the committed files and the script disagree.

`capture/` holds the capture kit's recorded exchanges, one per first source, also invented: see
`capture/README.md`.

`vintage/recipes.json` holds two invented Recipes over the vintage fixture's two Series, which the
release writer's tests and `release/demo.py` add to the fixture's series table.

`vintage/` holds the vintage store's fixture: three recorded fetches of one endpoint (initial,
revision, withdrawal), invented, for a made-up Origin. `python fixtures/vintage/demo.py` replays
them and prints the store. See `docs/method/vintage-store.md`.
