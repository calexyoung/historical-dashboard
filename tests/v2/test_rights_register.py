"""The committed rights register (PLAN 6 and M6; ADR 0006, ADR 0020): a row for every source the
plan names, each with a proposal, and no decision that Alex has not signed."""
import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from atlas.cli import main
from atlas.rights import (
    GRANTS,
    OWN_CHANNELS,
    PERMISSIONS,
    REGISTER_PATH,
    RightsGate,
    committed_gate,
    load_register,
    register_identity,
)

ROOT = Path(__file__).resolve().parents[2]
REGISTER = load_register()
ROWS = {row["id"]: row for row in REGISTER["rows"]}

# Every source in PLAN section 6: the table, and the list of rows the register "must cover".
PLAN_SOURCES = {
    "BLS": "bls",
    "BEA": "bea",
    "Census": "census",
    "Treasury Fiscal Data": "treasury-fiscal-data",
    "Federal Reserve Board": "fed-board",
    "EIA": "eia",
    "FRED": "fred",
    "ALFRED": "alfred",
    "Yahoo": "yahoo",
    "Philadelphia Fed": "philadelphia-fed",
    "IMF": "imf",
    "OECD": "oecd",
    "national statistics offices": "national-statistics-offices",
    "World Bank": "world-bank",
    "BIS": "bis",
    "Eurostat": "eurostat",
    "e-Stat": "e-stat",
    "BTS": "bts",
    "USAspending": "usaspending",
    "OpenFEMA": "openfema",
    "CDC NCHS": "cdc-nchs",
    "NOAA": "noaa-ncei",
    "OWID": "owid",
    "EM-DAT": "em-dat",
    "NTIA": "ntia",
    "hand-entered approval": "gallup",
    "hand-entered election margins": "wikipedia",
    "hand-entered election margins, from the official record": "fec",  # M16
    "hand-entered terms of government": "public-record",
}

# The rows Alex has signed. Only Alex adds to this list, in the same change in which he signs the
# row in schema/rights-register.json. The builder never does (PLAN 6: "The agent proposes; Alex
# decides and signs once").
SIGNED_BY_ALEX: set[str] = {"bls", "treasury-fiscal-data", "fed-board"}


def test_the_register_has_the_shape_its_schema_describes():
    schema = json.loads((ROOT / "schema" / "rights-register.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    errors = [e.message for e in Draft202012Validator(schema).iter_errors(REGISTER)]
    assert errors == []


def test_the_gate_trusts_the_committed_register():
    assert committed_gate().problem is None


@pytest.mark.parametrize("source", sorted(PLAN_SOURCES))
def test_every_source_in_the_plan_has_a_row(source):
    assert PLAN_SOURCES[source] in ROWS


@pytest.mark.parametrize("row", REGISTER["rows"], ids=lambda r: r["id"])
def test_every_row_has_a_proposal_with_its_reason_and_says_what_was_read(row):
    assert all(isinstance(row["proposal"][grant], bool) for grant in GRANTS)
    assert len(row["proposal"]["note"]) > 20
    assert row["terms"] or row.get("terms_note"), "a row with no terms page says why"
    for terms in row["terms"]:
        assert (terms["read_on"] is None) == (terms["how"] == "not_read")
        if terms["how"] == "not_read":
            assert terms["quotes"] == [] and terms.get("note"), "an unread page says why"


@pytest.mark.parametrize("row", REGISTER["rows"], ids=lambda r: r["id"])
def test_a_row_whose_terms_were_never_read_proposes_nothing(row):
    # Rows with no outside terms at all (Macro Atlas's own work, the public record) are exempt.
    if row["terms"] and all(terms["how"] == "not_read" for terms in row["terms"]):
        assert not any(row["proposal"][grant] for grant in GRANTS)


def test_no_decision_is_filled_in_that_alex_has_not_signed():
    assert {row["id"] for row in REGISTER["rows"] if row["decision"] is not None} == SIGNED_BY_ALEX


def test_an_intermediary_is_cleared_only_by_a_dated_amendment_to_adr_0006():
    adr = (ROOT / "docs" / "adr" / "0006-rights-gate-allowlist-releases.md").read_text()
    for entry in REGISTER["cleared_intermediaries"]:
        heading = rf"^## Amendment {entry['adr_0006_amendment']}: the {entry['channel']} channel is cleared \(approved by Alex\)$"
        assert re.search(heading, adr, re.MULTILINE), entry
    # Today there is none, and FRED and Yahoo are intermediaries with rows of their own.
    assert REGISTER["cleared_intermediaries"] == []
    assert {"fred", "alfred", "yahoo"} <= {r["channel"] for r in REGISTER["rows"] if r["kind"] == "channel"}


def test_no_unsigned_row_of_the_committed_register_permits_anything_on_a_public_surface():
    # The acceptance criterion: an unsigned row permits nothing on a public surface. Asked of
    # every row Alex has not signed, every Permission, and every Channel a value could arrive by.
    gate = committed_gate()
    channels = ["direct", *OWN_CHANNELS, *(r["channel"] for r in REGISTER["rows"] if r["kind"] == "channel")]
    asked = 0
    for row in REGISTER["rows"]:
        if row["kind"] != "origin" or row["id"] in SIGNED_BY_ALEX:
            continue
        datasets = ["anything"] if row["datasets"] == "*" else row["datasets"]
        for origin in row["origins"]:
            for dataset in datasets:
                for channel in channels:
                    assert not gate.may_store(origin, dataset, channel).allowed
                    for permission in PERMISSIONS:
                        lineage = [{"origin": origin, "dataset": dataset, "channel": channel,
                                    "representation": "native", "permission": permission}]
                        assert gate.permits(lineage, "local").allowed
                        for surface in ("staging", "production"):
                            assert not gate.permits(lineage, surface).allowed, (origin, channel, permission)
                            asked += 1
    assert asked > 1000 or SIGNED_BY_ALEX


def test_the_proposal_alone_opens_nothing_and_a_signature_would():
    # Guards the test above against passing for the wrong reason: the same question is allowed
    # once the row is signed, in a copy that is never written anywhere.
    lineage = [{"origin": "U.S. Bureau of Labor Statistics", "dataset": "CPI-U", "channel": "direct",
                "representation": "native", "permission": "redistribute"}]
    unsigned = json.loads(json.dumps(REGISTER))
    next(r for r in unsigned["rows"] if r["id"] == "bls")["decision"] = None
    assert "not signed" in RightsGate(unsigned).permits(lineage, "production").reason
    signed = json.loads(json.dumps(unsigned))
    row = next(r for r in signed["rows"] if r["id"] == "bls")
    row["decision"] = {**{g: row["proposal"][g] for g in GRANTS}, "signed_by": "Alex", "signed_on": "2026-01-01"}
    assert RightsGate(signed).permits(lineage, "production").allowed
    legacy = [{**lineage[0], "channel": "fred", "representation": "legacy_monthly_rounded"}]
    assert not RightsGate(signed).permits(legacy, "production").allowed


def test_a_missing_register_permits_nothing_public_and_does_not_raise(tmp_path, monkeypatch):
    from atlas import rights

    monkeypatch.setattr(rights, "REGISTER_PATH", tmp_path / "nowhere.json")
    monkeypatch.setattr(rights, "_committed", None)
    lineage = [{"origin": "U.S. Bureau of Labor Statistics", "dataset": "CPI-U", "channel": "direct",
                "representation": "native", "permission": "display"}]
    assert rights.permits(lineage, "local").allowed
    assert "cannot be trusted" in rights.permits(lineage, "production").reason


def test_a_release_can_record_which_register_it_was_built_against():
    identity = register_identity()
    assert identity["version"] == REGISTER["version"]
    assert re.fullmatch(r"[0-9a-f]{64}", identity["sha256"])


def test_the_typescript_gate_reads_the_same_rows():
    # The generated module is checked byte for byte by `npm run gen:check`; this catches a
    # register edited without regenerating when only pytest is run.
    text = (ROOT / "packages" / "core" / "src" / "rights-register.generated.ts").read_text()
    table = json.loads(text[text.index("= {") + 2 : text.rindex(";")])
    assert table["version"] == REGISTER["version"]
    assert [(r["id"], r["decision"]) for r in table["rows"]] == [(r["id"], r["decision"]) for r in REGISTER["rows"]]


def test_the_written_register_is_generated_from_the_table():
    text = (ROOT / "docs" / "v2" / "rights-register.md").read_text()
    for row in REGISTER["rows"]:
        assert f"`{row['id']}`" in text
        for terms in row["terms"]:
            assert terms["url"] in text
    undecided = sum(row["decision"] is None for row in REGISTER["rows"])
    assert text.count("Decision: **not decided**") == undecided


class TestCli:
    def test_atlas_rights_lists_every_row_and_what_is_signed(self, capsys):
        assert main(["rights"]) == 0
        out = capsys.readouterr().out
        for row_id in ROWS:
            assert row_id in out
        assert f"{len(SIGNED_BY_ALEX)} of {len(ROWS)} rows signed" in out
        assert ("nothing is permitted on staging or production" in out) is (not SIGNED_BY_ALEX)

    def test_atlas_rights_fails_on_a_register_the_gate_cannot_trust(self, tmp_path, capsys):
        bad = tmp_path / "register.json"
        bad.write_text(json.dumps({**REGISTER, "format": 2}))
        assert main(["rights", "--register", str(bad)]) == 1
        assert "format" in capsys.readouterr().err

    def test_the_register_path_is_the_one_table(self):
        assert REGISTER_PATH == ROOT / "schema" / "rights-register.json"


def test_an_attested_read_has_no_quotation_and_a_note():
    """An `attested` read is a person's report, not the page's text: it carries no quotation and
    must say what was reported."""
    import copy

    schema = json.loads((ROOT / "schema" / "rights-register.schema.json").read_text())
    validator = Draft202012Validator(schema)
    base = {"url": "https://example.gov/terms", "read_on": "2026-11-12", "how": "attested", "quotes": []}

    def errors_for(terms):
        register = copy.deepcopy(REGISTER)
        register["rows"][0]["terms"] = [terms]
        return [e.message for e in validator.iter_errors(register)]

    assert errors_for({**base, "note": "Read in a browser; nothing against."}) == []
    assert errors_for({**base, "note": "x", "quotes": ["some words"]})  # a quotation is refused
    assert errors_for(base)  # no note is refused
    assert errors_for({**base, "note": ""})  # an empty note is refused
