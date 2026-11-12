# Capture fixtures

One recorded exchange for every endpoint the rights register lists (26 since M15: two of BLS,
two of Treasury Fiscal Data, ten of the Federal Reserve Board, two of the IMF, six of the BEA, four of the EIA), in the form
`atlas capture --replay` reads (ADR 0021):

```
{register row}/{endpoint}/exchange.json   requests, statuses, headers, times, provenance
{register row}/{endpoint}/part-N.*        the body of the Nth request, byte for byte
```

**Every value in them is invented.** `provenance.synthetic` is true in each. The shape of each
answer was copied from what the source served on 2026-11-11; none of its numbers was. The
repository is public and no row of the rights register is signed, so real agency bytes may not
be committed yet. The BEA's and the EIA's requests are recorded as a replay asks them, with no
API key; no key was used to make these files, and where the BEA's answer would repeat one it
says `REDACTED`, as a real capture does (ADR 0029). To change them, edit `make_fixtures.py`, run it and commit; a test fails if
the files and the script disagree.

## Real captures

When Alex has signed a row so that it allows `store` and `redistribute`:

```
.venv/bin/python -m atlas capture --only bls --store var/store
.venv/bin/python -m atlas capture --export-fixtures fixtures/capture --store var/store
```

The export asks the rights gate first and refuses bytes it may not redistribute. A real
fixture says `"synthetic": false` and carries its retrieval time and capture id; the test that
compares fixtures with `make_fixtures.py` then steps aside.
