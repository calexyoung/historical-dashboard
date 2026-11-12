"""The migration table and `atlas add series` (PLAN M12; ADR 0026)."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from atlas.catalog import load_catalog
from atlas.catalog.check import ALLOWED_AGGREGATION, check
from atlas.catalog.table import TABLE_PATH, proposal, render_table
from atlas.cli import main as atlas_main
from atlas.rights import RightsGate, load_register

from .catalog_helpers import derived, stored
from .test_catalog_check import V1_KEYS

ROOT = Path(__file__).resolve().parents[2]


def proposals(entries: dict) -> dict[str, object]:
    table = load_register()
    gate = RightsGate(table)
    return {key: proposal(entry, entries, table, gate) for key, entry in entries.items()}


def source(producer, via="direct", origin_id="X1"):
    return {"origin": {"producer": producer, "dataset": "d", "origin_id": origin_id, "url": None},
            "channel": {"via": via}}


def test_a_proposal_is_worked_out_from_the_entry_and_the_register_and_typed_nowhere():
    entries = {
        "fx_bls": stored("fx_bls", source=source("U.S. Bureau of Labor Statistics")),
        "fx_oecd": stored("fx_oecd", source=source("Organisation for Economic Co-operation and Development")),
        "fx_new": stored("fx_new", source=source("An Office Nobody Listed")),
        "fx_fred": stored("fx_fred", source=source("U.S. Bureau of Labor Statistics", via="fred")),
        "fx_none": stored("fx_none", source={"origin": source("S&P")["origin"], "channel": None,
                                             "no_channel": {"kind": "rights_restriction", "reason": "Licensed."}}),
        "fx_gone": stored("fx_gone", source={"origin": source("x")["origin"], "channel": None,
                                             "no_channel": {"kind": "discontinued", "reason": "It ended."}}),
    }
    entries["fx_ok_yoy"] = derived("fx_ok_yoy", inputs=("fx_bls",))
    entries["fx_mixed"] = derived("fx_mixed", recipe={"op": "ratio", "inputs": ["fx_bls", "fx_oecd"],
                                                      "order": "aggregate_then_compute"})
    entries["fx_lost"] = derived("fx_lost", recipe={"op": "ratio", "inputs": ["fx_mixed", "fx_none"],
                                                    "order": "aggregate_then_compute"})
    got = proposals(entries)
    assert {key: p.label for key, p in got.items()} == {
        "fx_bls": "re-source", "fx_oecd": "needs D2", "fx_new": "needs D2", "fx_fred": "needs D2",
        "fx_none": "withheld", "fx_gone": "withheld", "fx_ok_yoy": "re-source", "fx_mixed": "needs D2",
        "fx_lost": "withheld"}
    assert got["fx_bls"].text == "re-source from Bureau of Labor Statistics"
    assert "no row" in got["fx_new"].text and "An Office Nobody Listed" in got["fx_new"].text
    assert "intermediary" in got["fx_fred"].text and "ADR 0006" in got["fx_fred"].text
    assert "proposes no display" in got["fx_oecd"].text
    assert got["fx_none"].text == "withheld (rights restriction): Licensed."
    assert got["fx_gone"].text == "withheld (discontinued): It ended."
    assert got["fx_lost"].text.startswith("withheld: it is computed from fx_none")
    assert "adapter not built" in got["fx_bls"].open and "register row not signed" not in " ".join(got["fx_bls"].open)
    unsettled = proposal(stored("fx_x", source=source("U.S. Bureau of Labor Statistics", origin_id=None)),
                         entries, load_register(), RightsGate(load_register()))
    assert "identifier not settled" in unsettled.open


def test_the_table_lists_every_v1_series_under_one_of_three_proposals():
    catalog = load_catalog()
    text = render_table(catalog, load_register())
    rows = {m[1]: m[0] for m in re.finditer(r"^\| `([a-z0-9_]+)` \|.*$", text, re.MULTILINE)}
    assert sorted(rows) == sorted(catalog)
    assert [key for key in V1_KEYS if key not in rows] == []
    for key, row in rows.items():
        cells = [c.strip() for c in row.strip("|").split("|")]
        assert cells[4].startswith(("re-source from ", "needs D2: ", "withheld")), (key, cells[4])
    got = proposals(catalog)
    counts = {label: sum(p.label == label for k, p in got.items() if k in V1_KEYS)
              for label in ("re-source", "needs D2", "withheld")}
    assert sum(counts.values()) == 126
    assert f"| re-source from an Origin | {counts['re-source']} |" in text
    assert f"| needs D2 | {counts['needs D2']} |" in text
    assert f"| withheld | {counts['withheld']} |" in text
    # Independent of the code: what the plan says of these.
    assert got["spx"].label == "withheld" and got["cpi"].text == "re-source from Bureau of Labor Statistics"
    assert got["approval"].label == "needs D2" and got["gold_eur"].label == "withheld"
    assert got["cpi_yoy"].label == "re-source" and got["jp_cpi"].text == "re-source from International Monetary Fund"
    assert "signed" not in text.split("## The table")[1]  # signing a row does not make the table stale


def test_the_committed_table_is_what_the_command_writes(tmp_path, capsys):
    assert TABLE_PATH == ROOT / "docs" / "v2" / "catalog-migration.md"
    assert TABLE_PATH.read_text() == render_table(load_catalog(), load_register())
    assert atlas_main(["catalog", "--check"]) == 0
    assert atlas_main(["catalog"]) == 0
    out = capsys.readouterr().out
    assert "185 Series" in out and "0 the rights gate would show on production today" in out


def test_no_proposal_reads_a_decision():
    """The table is advice. A signed refusal changes what the gate does, not what was proposed."""
    table = load_register()
    row = next(r for r in table["rows"] if r["id"] == "bls")
    before = render_table(load_catalog(), table)
    row["decision"] = {"display": False, "redistribute": False, "store": False, "ml_use": False,
                       "signed_by": "Alex", "signed_on": "2026-11-12"}
    assert render_table(load_catalog(), table) == before


def test_the_aggregation_table_is_the_engines():
    text = (ROOT / "packages" / "core" / "src" / "aggregate.ts").read_text()
    body = text[text.index("ALLOWED_AGGREGATION"):]
    body = body[body.index("{") + 1:body.index("};")]
    engine = {m[1]: tuple(re.findall(r'"(\w+)"', m[2])) for m in re.finditer(r"(\w+): \[([^\]]*)\]", body)}
    assert engine == ALLOWED_AGGREGATION


# --- atlas add series ------------------------------------------------------------------------

ADD = ["add", "series", "construction_total", "--name", "Total construction spending",
       "--unit", "millions of U.S. dollars, annual rate", "--unit-kind", "currency",
       "--measure-kind", "annualized", "--freq", "monthly", "--agg", "mean",
       "--seasonal-adjustment", "saar", "--price-basis", "nominal", "--country", "USA",
       "--segment", "infrastructure", "--producer", "U.S. Census Bureau",
       "--dataset", "Value of Construction Put in Place", "--origin-id", "TTLCONS"]


def test_add_series_writes_a_draft_that_passes_the_check_and_commits_nothing(tmp_path, capsys):
    directory = tmp_path / "series"
    directory.mkdir()
    before = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    assert atlas_main([*ADD, "--catalog", str(directory)]) == 0
    out = capsys.readouterr().out
    entry = json.loads((directory / "construction_total.json").read_text())
    assert entry["status"] == "draft" and entry["source"]["channel"] == {"via": "direct"}
    assert entry["source"]["origin"]["producer"] == "U.S. Census Bureau"
    assert "rights" not in entry and "refresh" in entry
    assert check(directory).ok
    assert "draft" in out and "python -m atlas check" in out
    assert "Census Bureau" in out and "not signed" in out  # what the register says, looked up
    assert subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True, check=True).stdout == before


def test_add_series_never_overwrites_and_refuses_what_is_not_a_series(tmp_path, capsys):
    directory = tmp_path / "series"
    directory.mkdir()
    assert atlas_main([*ADD, "--catalog", str(directory)]) == 0
    written = (directory / "construction_total.json").read_bytes()
    assert atlas_main([*ADD, "--catalog", str(directory), "--name", "Another name"]) == 1
    assert (directory / "construction_total.json").read_bytes() == written
    assert "already" in capsys.readouterr().err
    bad = [a if a != "construction_total" else "Construction-Total" for a in ADD]
    assert atlas_main([*bad, "--catalog", str(directory)]) == 1
    assert sorted(p.name for p in directory.iterdir()) == ["construction_total.json"]
    assert "key" in capsys.readouterr().err


def test_add_series_says_so_when_the_register_has_no_row_for_the_origin(tmp_path, capsys):
    directory = tmp_path / "series"
    directory.mkdir()
    args = [a if a != "U.S. Census Bureau" else "A New Office" for a in ADD]
    assert atlas_main([*args, "--catalog", str(directory)]) == 0
    assert "no row" in capsys.readouterr().out


def test_add_series_can_declare_a_derived_series(tmp_path):
    directory = tmp_path / "series"
    directory.mkdir()
    assert atlas_main([*ADD, "--catalog", str(directory)]) == 0
    assert atlas_main(["add", "series", "construction_yoy", "--name", "Construction spending, y/y",
                       "--unit", "percent change from a year earlier", "--unit-kind", "percent",
                       "--measure-kind", "rate", "--freq", "monthly", "--seasonal-adjustment", "saar",
                       "--price-basis", "nominal", "--country", "USA", "--segment", "infrastructure",
                       "--recipe", "pct_change", "--inputs", "construction_total", "--lag", "12",
                       "--catalog", str(directory)]) == 0
    entry = json.loads((directory / "construction_yoy.json").read_text())
    assert entry["recipe"] == {"op": "pct_change", "inputs": ["construction_total"],
                               "order": "aggregate_then_compute", "params": {"lag": 12}}
    assert "source" not in entry and entry["agg"] == "none" and check(directory).ok
