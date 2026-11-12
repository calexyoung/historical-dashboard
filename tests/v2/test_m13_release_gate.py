"""M13's acceptance, on the committed fixtures: every Series the Treasury, Board and BLS
adapters read goes from recorded bytes through capture, replay and the release writer, and
passes the release gate when its Origin's row is signed. Under the committed register, where no
row is signed, nothing is captured, recorded or released.

The fixtures' values are invented (fixtures/capture/README.md). A decision in a register here
is test data and says nothing of what Alex has decided."""
from __future__ import annotations

import functools
import json
import operator
from datetime import UTC, datetime
from pathlib import Path

import pytest

from atlas.capture.cli import main as capture_main
from atlas.catalog import load_catalog
from atlas.publish.run import release
from atlas.release import validate_release
from atlas.rights import load_register
from atlas.vintage.cli import main as replay_main

from .capture_helpers import ALLOW

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures" / "capture"
ROWS = ("bls", "treasury-fiscal-data", "fed-board")
NOW = datetime(2026, 11, 12, 15, 0, 0, tzinfo=UTC)
#: What M13 added to the pipeline: 28 stored Series and five Derived series.
STORED = {
    "bls": ["civpart", "corecpi", "eggs", "labor_share", "real_wages", "rent_cpi", "wages"],
    "treasury_fiscal_data": ["debt", "outlays", "receipts"],
    "fed_board": ["brl", "cad", "cny", "credit", "delinq", "eurusd", "fedassets", "fedfunds", "gbpusd",
                  "gs10", "gs2", "indpro", "inr", "jpy", "m2", "mxn", "net_worth", "usd_broad"],
}
DERIVED = ["corecpi_yoy", "m2_yoy", "rent_yoy", "t10y2y", "wages_yoy"]
M8 = ["cpi", "cpi_nsa", "cpi_yoy", "payems", "unrate"]


def signed(tmp_path: Path, rows=ROWS) -> Path:
    table = load_register()
    for row in table["rows"]:
        if row["id"] in rows:
            row["decision"] = dict(ALLOW)
    path = tmp_path / "register.json"
    path.write_text(json.dumps(table))
    return path


@pytest.fixture(scope="module")
def released(tmp_path_factory):
    """One run of the whole path, shared: capture the fixtures, replay them, release."""
    tmp = tmp_path_factory.mktemp("m13")
    register, store, root = signed(tmp), tmp / "store", tmp / "public"
    assert capture_main(["--store", str(store), "--register", str(register), "--replay", str(FIXTURES)]) == 0
    assert replay_main(["--store", str(store), "--register", str(register)]) == 0
    # The spot values are real published figures (checks/spot.json). Invented values do not
    # meet them, which the last test here shows; this run is given none to meet.
    spot = tmp / "no-spots.json"
    spot.write_text(json.dumps({"format": 1, "about": "none", "spots": []}))
    result = release(profile="public", root=root, store=store, register=register, now=NOW, spot=spot)
    return result, root, store, register


def test_every_series_the_three_adapters_read_passes_the_release_gate(released):
    result, root, _, _ = released
    assert result.exit_code == 0, result.lines
    current = root / "releases" / (root / "CURRENT").read_text().strip()
    manifest = json.loads((current / "manifest.json").read_text())
    assert validate_release(current) == []
    published = {entry["key"]: entry for entry in json.loads((current / "catalog.json").read_text())["series"]}
    expected = sorted([*functools.reduce(operator.iadd, STORED.values(), []), *DERIVED, *M8])
    assert sorted(published) == expected
    assert manifest["withheld"] == []
    # Every check of the release writer, by name: none failed and none only warned.
    assert manifest["checks"]["passed"] is True
    assert {check["check"]: check["outcome"] for check in manifest["checks"]["report"]} == {
        "no observation after the release": "pass", "values within the catalog's range": "pass",
        "staleness": "pass", "withdrawn series stay out": "pass",
        "rights: every Series and every input is permitted for display": "pass", "vintages": "pass",
        "engine: derived series": "pass", "release contract": "pass"}
    assert {source["outcome"] for source in manifest["sources"]} == {"ok"}


def test_each_released_series_names_its_origin_its_endpoint_and_the_register_row(released):
    _, root, _, _ = released
    current = root / "releases" / (root / "CURRENT").read_text().strip()
    published = {entry["key"]: entry for entry in json.loads((current / "catalog.json").read_text())["series"]}
    catalog = load_catalog()
    for adapter, keys in STORED.items():
        for key in keys:
            source = published[key]["source"]
            assert source["channel"] == {"via": "direct", "adapter": adapter,
                                         "endpoint": catalog[key]["source"]["channel"]["endpoint"]}, key
            assert source["origin"]["origin_id"] == catalog[key]["source"]["origin"]["origin_id"], key
            assert published[key]["rights"]["status"] == "public_domain", key
    assert published["t10y2y"]["rights"]["status"] == "public_domain"


def test_values_reach_the_release_as_the_source_printed_them(released):
    _, root, _, _ = released
    current = root / "releases" / (root / "CURRENT").read_text().strip()

    def series(key):
        return {o["period"]: o for o in json.loads((current / "series" / f"{key}.json").read_text())["observations"]}

    # Debt to the Penny: the last business day of the fixture, to the cent.
    debt = json.loads((FIXTURES / "treasury-fiscal-data/treasury-debt-to-penny/part-1.json").read_text())["data"][-1]
    assert series("debt")[debt["record_date"]]["value"] == float(debt["tot_pub_debt_out_amt"])
    # The MTS summary: July 2026's outlays are the figure of the latest statement, which revised it.
    rows = json.loads((FIXTURES / "treasury-fiscal-data/treasury-mts-summary/part-1.json").read_text())["data"]
    july = [row for row in rows if row["classification_desc"] == "July" and row["record_date"] >= "2026-07-31"
            and row["record_fiscal_year"] == "2026" and row["print_order_nbr"] > "14"]
    july = [row for row in july if row["record_type_cd"] == "MTH"]
    first, last = july[0]["current_month_gross_outly_amt"], july[-1]["current_month_gross_outly_amt"]
    assert first != last and series("outlays")["2026-07"]["value"] == float(last)
    # The Board: ND is a day listed with no number; a week is named for its Wednesday's ISO week.
    assert series("gs10")["2026-10-12"] == {**series("gs10")["2026-10-12"], "value": None, "status": "missing"}
    assert list(series("fedassets"))[:2] == ["2026-W34", "2026-W35"]
    assert list(series("net_worth"))[-1] == "2026-Q2" and next(iter(series("delinq"))) == "2021-Q3"
    # BLS: a quarter, a revised figure, and the quarter that was not produced.
    assert series("labor_share")["2026-Q2"]["status"] == "revised"
    assert series("real_wages")["2025-Q4"] == {**series("real_wages")["2025-Q4"], "value": None, "status": "missing"}


def test_under_the_committed_register_nothing_is_captured_recorded_or_released(tmp_path, capsys, released):
    _, _, store, _ = released
    assert capture_main(["--store", str(tmp_path / "store"), "--replay", str(FIXTURES)]) == 1
    assert not (tmp_path / "store").exists()
    # A store that does exist (made under the test register) is not replayed or released either.
    assert replay_main(["--store", str(tmp_path / "vintages"), "--captures", str(store)]) == 1
    out = capsys.readouterr().out
    for key in ("debt", "gs10", "wages", "net_worth"):
        assert f"REFUSED {key}:" in out
    result = release(profile="public", root=tmp_path / "public", store=store, now=NOW)
    assert result.exit_code == 1
    assert not (tmp_path / "public" / "CURRENT").exists()


def test_one_unsigned_origin_withholds_its_series_and_what_is_computed_from_them(tmp_path, released):
    _, _, store, _ = released
    register = signed(tmp_path, rows=("bls", "treasury-fiscal-data"))
    spot = tmp_path / "no-spots.json"
    spot.write_text(json.dumps({"format": 1, "about": "none", "spots": []}))
    result = release(profile="public", root=tmp_path / "public", store=store, register=register, now=NOW, spot=spot)
    assert result.exit_code == 0, result.lines
    current = tmp_path / "public" / "releases" / (tmp_path / "public" / "CURRENT").read_text().strip()
    withheld = {w["key"] for w in json.loads((current / "manifest.json").read_text())["withheld"]}
    assert withheld == {*STORED["fed_board"], "m2_yoy", "t10y2y"}
    assert not any((current / "series" / f"{key}.json").exists() for key in withheld)


def test_the_invented_fixture_does_not_pass_for_real_cpi(tmp_path, released):
    # cpi_yoy for June 2022 must be the published 9.1 (checks/spot.json). The fixture's index is
    # invented, and the engine step rejects the release that holds it.
    _, _, store, register = released
    result = release(profile="public", root=tmp_path / "public", store=store, register=register, now=NOW)
    assert result.exit_code == 1
    assert any("cpi_yoy 2022-06" in line for line in result.lines)
    assert not (tmp_path / "public" / "CURRENT").exists()
