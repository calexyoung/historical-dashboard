"""The rights gate: permits(rightsUsed, surface) over the rights register (PLAN M6; 6.1; ADR 0006)."""
import copy
import json
from pathlib import Path

import pytest

from atlas.rights import PERMISSIONS, SURFACES, RightsGate, ml_use_note, permits

ROOT = Path(__file__).resolve().parents[2]
TABLE = json.loads((ROOT / "checks" / "permits-cases.json").read_text())
DIRECT = TABLE["lineage"]["agency_direct"]
TEST_REGISTER = TABLE["registers"]["test"]
OPEN = TABLE["lineage"]["open__direct__display"]


def _ask(case):
    lineage = TABLE["lineage"][case["lineage"]]
    if "register" in case:
        return RightsGate(TABLE["registers"][case["register"]]).permits(lineage, case["surface"])
    return permits(lineage, case["surface"])


@pytest.mark.parametrize("case", TABLE["cases"], ids=lambda c: c["name"])
def test_shared_table(case):
    decision = _ask(case)
    assert decision.allowed is case["allowed"], decision.reason
    if "reason_has" in case:
        assert case["reason_has"] in decision.reason


def test_the_shared_table_crosses_status_channel_and_surface():
    # The M6 acceptance criterion, checked on the table itself so a deleted row is noticed.
    asked = {(c["lineage"], c["surface"]) for c in TABLE["cases"] if c.get("register") == "test"}
    for status in ("open", "display_only", "unsigned", "unknown"):
        for channel in ("direct", "mirror_ok", "mirror_uncleared"):
            for permission in PERMISSIONS:
                for surface in SURFACES:
                    assert (f"{status}__{channel}__{permission}", surface) in asked


def test_the_committed_register_permits_only_the_local_surface_to_an_origin_it_does_not_list():
    assert set(SURFACES) == {"local", "staging", "production"}
    for surface in SURFACES:
        for permission in PERMISSIONS:
            lineage = [{**DIRECT[0], "permission": permission}]
            assert permits(lineage, surface).allowed is (surface == "local"), (surface, permission)


def test_a_denial_says_why_and_an_allowance_has_no_reason():
    denied = permits(DIRECT, "production")
    assert not denied.allowed
    assert "production" in denied.reason
    assert permits(DIRECT, "local").reason is None


def test_a_decision_cannot_be_used_as_a_bare_boolean():
    # `if permits(...)` on a denial object would be truthy by default; make that mistake loud.
    with pytest.raises(TypeError):
        bool(permits(DIRECT, "production"))


def test_a_malformed_lineage_row_is_denied_not_raised():
    assert not permits([{"origin": "x"}], "local").allowed
    assert not permits(None, "local").allowed
    assert not permits([{**DIRECT[0], "permission": "publish"}], "local").allowed


def test_a_gate_keeps_the_table_it_was_built_from():
    # Signing a row in the caller's copy afterwards must not open a gate that already exists.
    table = copy.deepcopy(TEST_REGISTER)
    unsigned = TABLE["lineage"]["unsigned__direct__display"]
    gate = RightsGate(table)
    assert not gate.permits(unsigned, "production").allowed
    signed = next(row for row in table["rows"] if row["decision"] is not None)["decision"]
    next(row for row in table["rows"] if row["id"] == "unsigned")["decision"] = dict(signed)
    assert not gate.permits(unsigned, "production").allowed
    assert RightsGate(table).permits(unsigned, "production").allowed


def test_a_gate_says_what_is_wrong_with_a_table_it_cannot_trust():
    assert RightsGate(TEST_REGISTER).problem is None
    assert "format" in RightsGate(TABLE["registers"]["invalid_format"]).problem
    assert "open" in RightsGate(TABLE["registers"]["invalid_duplicate_id"]).problem


class TestStorage:
    """Whether the capture job may keep what a source serves (M7). No surface: local does not help."""

    gate = RightsGate(TEST_REGISTER)

    def test_a_signed_row_that_allows_storage_permits_it(self):
        assert self.gate.may_store("Agency Open", "Any set", "direct").allowed

    def test_an_unsigned_or_unknown_origin_may_not_be_stored(self):
        assert "not signed" in self.gate.may_store("Agency Unsigned", "Any set", "direct").reason
        assert not self.gate.may_store("Agency Nobody Listed", "Any set", "direct").allowed

    def test_display_only_does_not_include_storage(self):
        assert not self.gate.may_store("Agency Display Only", "Any set", "direct").allowed

    def test_an_intermediary_needs_its_own_row_and_the_adr_amendment(self):
        assert self.gate.may_store("Agency Open", "Any set", "mirror_ok").allowed
        assert not self.gate.may_store("Agency Open", "Any set", "mirror_uncleared").allowed
        assert not self.gate.may_store("Agency Open", "Any set", "mirror_display").allowed

    def test_a_table_that_cannot_be_trusted_permits_no_storage(self):
        gate = RightsGate(TABLE["registers"]["invalid_format"])
        assert not gate.may_store("Agency Open", "Any set", "direct").allowed


ML_USE = json.loads((ROOT / "checks" / "ml-use-cases.json").read_text())


@pytest.mark.parametrize("case", ML_USE["cases"], ids=lambda c: c["name"])
def test_the_sentence_about_machine_learning(case):
    assert ml_use_note(case["rights"]) == case["note"]


class TestMlUse:
    """What a Release's Rights block says of use in training a model (ADR 0041): the gate's
    answer for production, and the signed rows that say no, by name."""

    gate = RightsGate(TEST_REGISTER)

    @staticmethod
    def row(origin, channel="direct", representation="native"):
        return {"origin": origin, "dataset": "Any set", "channel": channel, "representation": representation}

    def test_a_signed_row_that_allows_it(self):
        assert self.gate.ml_use([self.row("Agency Open")]) == {"ml_use": True}

    def test_a_signed_row_that_reserves_it_is_named(self):
        assert self.gate.ml_use([self.row("Agency Display Only")]) == {
            "ml_use": False, "ml_use_reserved_by": ["Agency Display Only"]}

    def test_an_unsigned_or_unlisted_origin_is_not_allowed_and_nobody_is_named(self):
        assert self.gate.ml_use([self.row("Agency Unsigned")]) == {"ml_use": False}
        assert self.gate.ml_use([self.row("Agency Nobody Listed")]) == {"ml_use": False}

    def test_the_most_restrictive_of_several_wins_and_each_that_reserves_is_named_once(self):
        rows = [self.row("Agency Open"), self.row("Agency Display Only"), self.row("Agency Display Only"),
                self.row("Agency Refused")]
        assert self.gate.ml_use(rows) == {
            "ml_use": False, "ml_use_reserved_by": ["Agency Display Only", "Agency Refused"]}

    def test_an_intermediary_that_is_not_cleared_is_not_allowed(self):
        assert self.gate.ml_use([self.row("Agency Open", "mirror_ok")]) == {"ml_use": True}
        assert self.gate.ml_use([self.row("Agency Open", "mirror_uncleared")])["ml_use"] is False

    def test_an_intermediary_whose_signed_row_reserves_it_is_named(self):
        table = copy.deepcopy(TEST_REGISTER)
        row = next(r for r in table["rows"] if r.get("channel") == "mirror_ok")
        row["decision"]["ml_use"] = False
        row["name"] = "The Mirror"
        assert RightsGate(table).ml_use([self.row("Agency Open", "mirror_ok")]) == {
            "ml_use": False, "ml_use_reserved_by": ["The Mirror"]}

    def test_the_legacy_representation_and_no_lineage_are_never_allowed(self):
        assert self.gate.ml_use([self.row("Agency Open", representation="legacy_monthly_rounded")]) == {"ml_use": False}
        assert self.gate.ml_use([]) == {"ml_use": False}

    def test_a_table_that_cannot_be_trusted_allows_nothing(self):
        assert RightsGate(TABLE["registers"]["invalid_format"]).ml_use([self.row("Agency Open")]) == {"ml_use": False}
