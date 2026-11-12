"""M16's first acceptance item (PLAN): every one of v1's 126 series is accounted for as live
from origin, live via a cleared channel, or withheld with a reason. The account is worked out
from the Catalog and the rights register (atlas/catalog/v1coverage.py) and written to
docs/v2/v1-coverage.md."""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

from atlas.capture.adapters import ADAPTERS
from atlas.catalog import load_catalog
from atlas.catalog.table import gate_shows
from atlas.catalog.v1coverage import CLASSES, COVERAGE_PATH, account, render_v1_coverage
from atlas.cli import main as atlas_main
from atlas.rights import RightsGate, load_register

from .capture_helpers import committed_with
from .catalog_helpers import derived, stored

ROOT = Path(__file__).resolve().parents[2]
#: v1's series, from v1's own output and its three hand-entered ones: not from the Catalog.
V1_KEYS = sorted([*json.loads((ROOT / "data" / "atlas.json").read_text())["series"],
                  "approval", "pres_margin", "house_margin"])
ORIGIN, CLEARED, WITHHELD = CLASSES


def committed():
    return account(load_catalog(), load_register())


def test_exactly_v1s_126_series_are_accounted_for_each_in_one_class():
    rows = committed()
    assert len(V1_KEYS) == 126 and sorted(rows) == V1_KEYS
    assert {row.klass for row in rows.values()} <= set(CLASSES)
    counts = {name: sum(row.klass == name for row in rows.values()) for name in CLASSES}
    assert sum(counts.values()) == 126
    # Today: 51 are read from the agency that produces them, none comes through an intermediary
    # (D2 cleared none), and 75 are withheld.
    assert counts == {ORIGIN: 51, CLEARED: 0, WITHHELD: 75}


def test_every_withheld_series_says_why_and_every_live_one_says_where_it_is_read():
    for key, row in committed().items():
        if row.klass == WITHHELD:
            assert len(row.reason) > 25 and row.reason[0].isupper() is False, key
            assert row.reads is None
        else:
            assert row.reason is None and row.reads, key


def test_what_the_account_says_of_series_the_plan_names():
    rows = committed()
    assert rows["cpi"].klass == ORIGIN and "U.S. Bureau of Labor Statistics" in rows["cpi"].reads
    # M16's own: the Census files.
    for key in ("retail", "houst", "trade"):
        assert rows[key].klass == ORIGIN and rows[key].reads.startswith("U.S. Census Bureau"), key
    # A Derived series is what the Series under it are.
    assert rows["t10y2y"].klass == ORIGIN and rows["t10y2y"].reads == "computed from `gs10`, `gs2`"
    assert rows["cpi_yoy"].klass == ORIGIN and rows["cpi_yoy"].relation == "a different quantity from v1's"
    assert rows["cs_yoy"].klass == WITHHELD and rows["cs_yoy"].reason.startswith("it is computed from `caseshiller`, which is withheld")
    assert rows["gold_eur"].klass == WITHHELD and "`gold`" in rows["gold_eur"].reason
    # Index levels: a rights restriction. Nothing is fetched through Yahoo or FRED.
    assert rows["spx"].klass == WITHHELD and rows["spx"].reason.startswith("rights restriction")
    assert rows["ted"].reason.startswith("discontinued")
    # Hand-entered: the reader exists and nothing is typed in ahead of a decision.
    assert "the register proposes no display for Gallup" in rows["approval"].reason
    for key in ("pres_margin", "house_margin"):
        assert rows[key].klass == WITHHELD
        assert "entered by hand" in rows[key].reason and "Federal Election Commission" in rows[key].reason
    assert "the rights register has no row for National Bureau of Economic Research" in rows["usrec"].reason
    assert "no reader is built for it yet (planned for v2.2)" in rows["births"].reason
    assert "no reader is built for it yet (planned for v2.1)" in rows["medhome"].reason


def test_no_series_comes_through_an_intermediary_and_no_adapter_for_one_exists():
    """PLAN M16: "legacy-channel adapters only for channels Alex cleared in D2". He cleared none:
    the register lists no cleared intermediary, so no such adapter was built."""
    table = load_register()
    assert table["cleared_intermediaries"] == []
    assert not [name for name in ADAPTERS if re.search("fred|yahoo|alfred", name)]
    assert sorted(ADAPTERS) == ["bea", "bls", "census_c30", "census_eits", "eia", "fed_board", "fixture",
                                "imf_sdmx", "manual", "treasury_fiscal_data"]
    assert not [key for key, row in committed().items() if row.klass == CLEARED]
    vias = {(e["source"]["channel"] or {}).get("via") for e in load_catalog().values()
            if "source" in e and e["status"] != "draft"}
    assert vias <= {"direct", "hand_entered", None}


def test_a_series_through_an_intermediary_is_live_only_once_the_channel_is_cleared():
    """What the middle class would hold if Alex cleared a channel, on invented entries."""
    fred = {"origin": {"producer": "U.S. Bureau of Labor Statistics", "dataset": "Consumer Price Index",
                       "origin_id": "X", "url": None},
            "channel": {"via": "fred", "adapter": "fred", "endpoint": "fred-x"}}
    migration = {"v1_source": "FRED X", "change": "same"}
    entries = {"a": stored("a", status="active", source=fred, migration=migration),
               "b": derived("b", inputs=("a",), status="active", migration=migration)}
    table = load_register()
    rows = account(entries, table)
    assert rows["a"].klass == WITHHELD and "fred is an intermediary Channel that is not cleared" in rows["a"].reason
    assert rows["b"].klass == WITHHELD and rows["b"].reason.startswith("it is computed from `a`, which is withheld")
    # An amendment alone is half of it: the channel's own row must be signed and allow display.
    amended = copy.deepcopy(table)
    amended["cleared_intermediaries"] = [{"channel": "fred", "adr_0006_amendment": "2026-12-01", "approved_by": "Alex"}]
    assert account(entries, amended)["a"].klass == WITHHELD
    decision = {"display": True, "redistribute": True, "store": True, "ml_use": False,
                "signed_by": "Alex", "signed_on": "2026-12-01"}
    refused = copy.deepcopy(amended)
    next(r for r in refused["rows"] if r["id"] == "fred")["decision"] = {**decision, "display": False}
    assert account(entries, refused)["a"].klass == WITHHELD
    cleared = copy.deepcopy(amended)
    next(r for r in cleared["rows"] if r["id"] == "fred")["decision"] = decision
    rows = account(entries, cleared)
    assert rows["a"].klass == CLEARED and rows["a"].reads.endswith("through fred")
    assert rows["b"].klass == CLEARED  # the least direct route among what it rests on


def test_the_committed_page_is_what_the_command_writes_and_states_what_live_means(tmp_path, monkeypatch, capsys):
    text = render_v1_coverage(load_catalog(), load_register())
    assert COVERAGE_PATH == ROOT / "docs" / "v2" / "v1-coverage.md"
    assert COVERAGE_PATH.read_text() == text
    assert atlas_main(["catalog", "--check"]) == 0
    listed = re.findall(r"^\| `([a-z0-9_]+)` \|", text, re.MULTILINE)
    assert sorted(listed) == V1_KEYS  # each once, in one table
    assert "| live from origin | 51 |" in text and "| live via a cleared channel | 0 |" in text
    assert "| withheld | 75 |" in text
    # "Live" is a statement about the pipeline. What a public Surface shows is the gate's: none
    # of them with no row signed, and under the committed register the ones whose rows Alex signed.
    catalog, gate = load_catalog(), RightsGate(load_register())
    shown = sum(gate_shows(catalog[key], catalog, gate) for key, row in committed().items() if row.klass != WITHHELD)
    assert f"The rights gate would show {shown} of them on production today" in text
    unsigned = render_v1_coverage(catalog, committed_with())
    assert "| live from origin | 51 |" in unsigned  # the classes are the pipeline's, signed or not
    assert "The rights gate would show 0 of them on production today" in unsigned
    assert "docs/v2/v1-overlap.md" in text
    # No figure of any agency is on the page: it is names, sources and reasons.
    assert not re.search(r"\d{4}-\d{2}: -?\d", text)
    # A stale page fails the check.
    import atlas.catalog.v1coverage as module

    stale = tmp_path / "v1-coverage.md"
    stale.write_text(text + "\nedited by hand\n")
    monkeypatch.setattr(module, "COVERAGE_PATH", stale)
    assert atlas_main(["catalog", "--check"]) == 1
    assert "is out of date" in capsys.readouterr().err
