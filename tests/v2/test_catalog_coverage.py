"""The coverage matrix (PLAN M14): a page generated from the Catalog that shows, for each G20
country and each headline indicator, which Series exists and why anything is missing."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from atlas.catalog import load_catalog
from atlas.catalog.check import check
from atlas.catalog.coverage import COVERAGE_PAGE, load_coverage, render_coverage
from atlas.catalog.table import gate_shows
from atlas.cli import main as atlas_main
from atlas.rights import RightsGate, load_register

from .capture_helpers import committed_with
from .catalog_helpers import derived, stored, write

ROOT = Path(__file__).resolve().parents[2]
G20 = ["ARG", "AUS", "BRA", "CAN", "CHN", "FRA", "DEU", "IND", "IDN", "ITA", "JPN", "KOR", "MEX", "RUS",
       "SAU", "ZAF", "TUR", "GBR", "USA"]
BOUND = {"origin": {"producer": "U.S. Bureau of Labor Statistics", "dataset": "Consumer Price Index",
                    "origin_id": "CUSR0000SA0", "url": None},
         "channel": {"via": "direct", "adapter": "bls", "endpoint": "bls-headline"}}


def matrix(rows, columns=None) -> dict:
    return {"format": 1, "title": "Test matrix", "about": "test",
            "columns": columns or [{"id": "cpi", "name": "Consumer prices"},
                                   {"id": "rate", "name": "Policy rate",
                                    "default": {"none": "Nobody has looked for one.", "waits_for": "M36"}}],
            "rows": rows}


def run(tmp_path, entries, declared):
    directory = write(tmp_path / "series", *entries)
    (tmp_path / "coverage").mkdir(exist_ok=True)
    (tmp_path / "coverage" / "test.json").write_text(json.dumps(declared))
    report = check(directory)
    return {layer.name: [p.message for p in layer.problems] for layer in report.layers if layer.problems}


# --- the committed matrix ----------------------------------------------------------------------


def test_the_committed_matrix_is_the_nineteen_countries_and_the_euro_area_by_seven_indicators():
    declared = load_coverage()["g20"]
    assert sorted(row["country"] for row in declared["rows"]) == sorted([*G20, "EA"])
    assert [column["id"] for column in declared["columns"]] == [
        "cpi", "inflation", "fx", "policy_rate", "unemployment", "gdp_growth", "stock_index"]
    assert {row["country"] for row in declared["rows"] if row.get("member_of") == "EA"} == {"DEU", "FRA", "ITA"}


def test_every_series_read_from_the_imf_has_its_cell():
    catalog = load_catalog()
    declared = load_coverage()["g20"]
    placed = {cell.get("series") or cell.get("shared") for row in declared["rows"] for cell in row["cells"].values()}
    fund = {key for key, entry in catalog.items()
            if (entry.get("source", {}).get("channel") or {}).get("adapter") == "imf_sdmx"}
    assert len(fund) == 35 and fund <= placed
    assert {key.replace("_cpi", "_infl") for key in fund if "_cpi" in key} <= placed


def test_the_plans_two_rows_are_whole_cpi_for_all_nineteen_and_a_rate_for_every_currency():
    catalog = load_catalog()
    rows = {row["country"]: row for row in load_coverage()["g20"]["rows"]}
    for country in G20:
        cpi = catalog[rows[country]["cells"]["cpi"]["series"]]
        assert cpi["status"] == "active" and cpi["source"]["origin"]["producer"] == "International Monetary Fund"
        cell = rows[country]["cells"]["fx"]
        if country == "USA":
            assert "none" in cell  # the dollar is what the others are quoted against
        elif country in ("DEU", "FRA", "ITA"):
            assert cell == {"shared": "ez_fx"}
        else:
            assert catalog[cell["series"]]["status"] == "active", country
    assert rows["EA"]["cells"]["fx"]["series"] == "ez_fx"


# --- `atlas check` holds a matrix to the Catalog ----------------------------------------------


def test_a_matrix_whose_cells_all_resolve_passes(tmp_path):
    entries = [stored("fx_cpi", country="JPN"), stored("fx_ea", country="EA")]
    rows = [{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_cpi"}}},
            {"country": "DEU", "name": "Germany", "member_of": "EA", "cells": {"cpi": {"shared": "fx_ea"}}}]
    assert run(tmp_path, entries, matrix(rows)) == {}


@pytest.mark.parametrize("rows, said", [
    ([{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_nowhere"}}}],
     "Japan, cpi: fx_nowhere is not in the catalog"),
    ([{"country": "DEU", "name": "Germany", "cells": {"cpi": {"series": "fx_cpi"}}}],
     "Germany, cpi: fx_cpi is a Series of JPN, not of DEU"),
    ([{"country": "DEU", "name": "Germany", "cells": {"cpi": {"shared": "fx_ea"}}}],
     "Germany, cpi: a shared Series needs the row to say what it is a member of"),
    ([{"country": "DEU", "name": "Germany", "member_of": "EA", "cells": {"cpi": {"shared": "fx_cpi"}}}],
     "Germany, cpi: fx_cpi is a Series of JPN, not of EA"),
    ([{"country": "JPN", "name": "Japan", "cells": {}}],
     "Japan, cpi: the cell is not filled and the column has no default"),
    ([{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_cpi"}, "gdp": {"none": "x"}}}],
     "Japan: gdp is not a column of the matrix"),
    ([{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_cpi"}, "rate": {"series": "fx_cpi"}}}],
     "Japan, rate: fx_cpi is already the cpi cell of Japan"),
    ([{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_cpi"}}},
      {"country": "JPN", "name": "Japan again", "cells": {"cpi": {"none": "x"}}}],
     "JPN has two rows"),
])
def test_references_layer_a_cell_that_does_not_fit_the_catalog(tmp_path, rows, said):
    entries = [stored("fx_cpi", country="JPN"), stored("fx_ea", country="EA")]
    found = run(tmp_path, entries, matrix(rows))
    assert list(found) == ["references"] and said in found["references"][0], found
    assert "coverage/test.json" in str(check(tmp_path / "series").layers[1].problems[0])


@pytest.mark.parametrize("change, said", [
    (lambda m: m["rows"][0]["cells"]["cpi"].update(shared="fx_cpi"), "cells"),
    (lambda m: m["rows"][0]["cells"].update(cpi={"none": ""}), "cells"),
    (lambda m: m.update(format=2), "format"),
    (lambda m: m["columns"].append(dict(m["columns"][0])), "two columns are called cpi"),
    (lambda m: m["rows"][0].update(verdict="covered"), "verdict"),
])
def test_schema_layer_a_matrix_out_of_shape(tmp_path, change, said):
    declared = matrix([{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_cpi"}}}])
    change(declared)
    found = run(tmp_path, [stored("fx_cpi", country="JPN")], declared)
    assert list(found) == ["schema"] and said in found["schema"][0], found


# --- the page ----------------------------------------------------------------------------------


def page(tmp_path, entries, rows, register=None):
    directory = write(tmp_path / "series", *entries)
    (tmp_path / "coverage").mkdir(exist_ok=True)
    (tmp_path / "coverage" / "test.json").write_text(json.dumps(matrix(rows)))
    table = register or load_register()
    return render_coverage(load_catalog(directory), table, load_coverage(tmp_path / "coverage")["test"])


def cells(text: str, country: str) -> list[str]:
    row = next(line for line in text.splitlines() if line.startswith(f"| {country} |"))
    return [cell.strip() for cell in row.strip("|").split("|")][1:]


def test_a_cell_says_what_exists_and_the_page_says_why_anything_is_missing(tmp_path):
    entries = [stored("fx_live", country="JPN", status="active", source=BOUND),
               stored("fx_draft", country="KOR", source={
                   "origin": {**BOUND["origin"], "origin_id": "CES0000000001"}, "channel": {"via": "direct"}}),
               stored("fx_held", country="IND", source={
                   "origin": {"producer": "An exchange", "dataset": "Index", "origin_id": None, "url": None},
                   "channel": None,
                   "no_channel": {"kind": "rights_restriction", "reason": "Index levels are licensed."}}),
               stored("fx_ea", country="EA", status="active",
                      source={**BOUND, "origin": {**BOUND["origin"], "origin_id": "CUUR0000SA0"}})]
    rows = [{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_live", "note": "Begins in 1955."}}},
            {"country": "KOR", "name": "South Korea", "cells": {"cpi": {"series": "fx_draft"}}},
            {"country": "IND", "name": "India", "cells": {"cpi": {"series": "fx_held"},
                                                           "rate": {"none": "Its bank publishes no file.", "waits_for": "D5"}}},
            {"country": "DEU", "name": "Germany", "member_of": "EA", "cells": {"cpi": {"shared": "fx_ea"}}}]
    text = page(tmp_path, entries, rows)
    assert cells(text, "Japan") == ["`fx_live`", "—"]
    assert cells(text, "South Korea") == ["`fx_draft` (draft)", "—"]
    assert cells(text, "India") == ["`fx_held` (withheld)", "—"]
    assert cells(text, "Germany") == ["`fx_ea` (EA)", "—"]
    why = text.split("## Why a cell is not live")[1].split("## Notes")[0]
    # A draft: what is proposed for it and what is still open, worked out as the migration table does.
    assert "- **South Korea**, `fx_draft` (draft): re-source from Bureau of Labor Statistics. Still open: adapter not built" in why
    assert "- **India**, `fx_held` (withheld): withheld (rights restriction): Index levels are licensed." in why
    # No Series at all: the reason typed for the cell, or the column's; countries that share one are listed together.
    assert "- **Japan, South Korea, Germany**: no Series. Nobody has looked for one. Waits for M36." in why
    assert "- **India**: no Series. Its bank publishes no file. Waits for D5." in why
    assert "fx_live" not in why  # a Series in the pipeline is not missing
    assert "- `fx_live` (Japan, Consumer prices): Begins in 1955." in text.split("## Notes")[1]
    assert "| Consumer prices | 2 | 1 | 1 | 0 |" in text  # in the pipeline, draft, withheld, no Series


def test_the_page_gives_the_gates_answer_and_never_reads_a_proposal_as_permission(tmp_path):
    entries = [stored("fx_live", country="JPN", status="active", source=BOUND)]
    rows = [{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_live"}}}]
    # No row signed: the register still proposes all four for the Bureau, and a proposal shows nothing.
    unsigned = committed_with()
    assert next(row for row in unsigned["rows"] if row["id"] == "bls")["proposal"]["display"] is True
    text = page(tmp_path, entries, rows, register=unsigned)
    assert "The rights gate would show 0 of the 1 Series in the pipeline on production today." in text
    assert "| Bureau of Labor Statistics | `bls` | not signed | 1 |" in text
    text = page(tmp_path, entries, rows, register=committed_with(["bls"]))
    assert "The rights gate would show 1 of the 1 Series in the pipeline on production today." in text
    assert "| Bureau of Labor Statistics | `bls` | signed 2026-11-11: display allowed | 1 |" in text


def test_a_derived_cell_rests_on_its_inputs(tmp_path):
    entries = [stored("fx_price", country="JPN"), derived("fx_price_yoy", country="JPN")]
    rows = [{"country": "JPN", "name": "Japan", "cells": {"cpi": {"series": "fx_price"},
                                                           "rate": {"series": "fx_price_yoy"}}}]
    text = page(tmp_path, entries, rows)
    assert cells(text, "Japan") == ["`fx_price` (draft)", "`fx_price_yoy` (draft)"]


def test_the_committed_page_is_what_the_command_writes(capsys):
    assert COVERAGE_PAGE == ROOT / "docs" / "v2" / "g20-coverage.md"
    text = render_coverage(load_catalog(), load_register(), load_coverage()["g20"])
    assert COVERAGE_PAGE.read_text() == text
    assert atlas_main(["catalog", "--check"]) == 0
    # All twenty rows, by name, and every cell filled with a Series or a dash.
    rows = [line for line in text.split("## The matrix")[1].split("How to read a cell")[0].splitlines()
            if re.match(r"^\| [A-Z]", line) and not line.startswith("| Country")]
    assert len(rows) == 20 and all(len(row.strip("|").split("|")) == 8 for row in rows)
    assert cells(text, "Japan")[:3] == ["`jp_cpi`", "`jp_infl`", "`jp_fx`"]
    assert cells(text, "Germany")[2] == "`ez_fx` (EA)"
    # The gate's count is worked out from the committed register, whatever Alex has signed in it.
    catalog, gate = load_catalog(), RightsGate(load_register())
    series = {cell.get("series") or cell.get("shared") for row in load_coverage()["g20"]["rows"]
              for cell in row["cells"].values()} - {None}
    live = [key for key in series if catalog[key]["status"] != "draft"
            and ("recipe" in catalog[key] or (catalog[key]["source"]["channel"] or {}).get("endpoint"))]
    shown = sum(gate_shows(catalog[key], catalog, gate) for key in live)
    assert f"The rights gate would show {shown} of the {len(live)} Series in the pipeline on production today." in text


def test_a_stale_page_fails_the_check(tmp_path, monkeypatch, capsys):
    from atlas.catalog import coverage

    stale = tmp_path / "g20-coverage.md"
    stale.write_text("old\n")
    monkeypatch.setattr(coverage, "COVERAGE_PAGE", stale)
    assert atlas_main(["catalog", "--check"]) == 1
    assert "is out of date: run python -m atlas catalog --write" in capsys.readouterr().err
    assert atlas_main(["catalog", "--write"]) == 0
    assert stale.read_text().startswith("# G20 coverage")
