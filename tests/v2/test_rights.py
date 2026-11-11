"""The permits(rightsUsed, surface) contract, default body (PLAN M0; section 6.1; ADR 0006)."""
import json
from pathlib import Path

import pytest

from atlas.rights import PERMISSIONS, SURFACES, permits

ROOT = Path(__file__).resolve().parents[2]
TABLE = json.loads((ROOT / "checks" / "permits-cases.json").read_text())
DIRECT = TABLE["lineage"]["agency_direct"]


@pytest.mark.parametrize("case", TABLE["cases"], ids=lambda c: c["name"])
def test_shared_table(case):
    decision = permits(TABLE["lineage"][case["lineage"]], case["surface"])
    assert decision.allowed is case["allowed"]


def test_every_surface_other_than_local_is_denied_for_every_permission():
    # The M0 acceptance criterion: permits() denies every non-local surface.
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
