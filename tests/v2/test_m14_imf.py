"""M14 on the committed fixtures: the consumer price index of the nineteen G20 countries and the
dollar rate of sixteen currencies go from recorded bytes of the IMF's shape through capture,
replay and the release writer, and pass the release gate when the IMF's row is signed. Under
the committed register, where no row is signed, nothing is captured, recorded or released.

The fixtures' values are invented (fixtures/capture/README.md). A decision in a register here
is test data and says nothing of what Alex has decided."""
from __future__ import annotations

import json
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
NOW = datetime(2026, 11, 12, 15, 0, 0, tzinfo=UTC)
G20 = ("ar", "au", "br", "ca", "cn", "de", "fr", "id", "in", "it", "jp", "kr", "mx", "ru", "sa", "tr", "uk",
       "us", "za")
# The Fund's index for the United Kingdom is not the ONS index v1 showed (uk_cpi): its own key.
CPI = [f"{c}_cpi" if c != "uk" else "uk_cpi_imf" for c in G20]
INFLATION = [f"{c}_infl" if c != "uk" else "uk_infl_imf" for c in G20]
FX = sorted([*(f"{c}_fx" for c in G20 if c not in ("de", "fr", "it", "us", "tr")), "tryusd", "ez_fx"])


def signed(tmp_path: Path, rows=("imf",)) -> Path:
    table = load_register()
    for row in table["rows"]:
        if row["id"] in rows:
            row["decision"] = dict(ALLOW)
    path = tmp_path / "register.json"
    path.write_text(json.dumps(table))
    return path


@pytest.fixture(scope="module")
def released(tmp_path_factory):
    """One run of the whole path, shared: capture the two IMF fixtures, replay them, release."""
    tmp = tmp_path_factory.mktemp("m14")
    register, store, root = signed(tmp), tmp / "store", tmp / "public"
    assert capture_main(["--store", str(store), "--register", str(register), "--replay", str(FIXTURES),
                         "--only", "imf"]) == 0
    assert replay_main(["--store", str(store), "--register", str(register)]) == 0
    spot = tmp / "no-spots.json"
    spot.write_text(json.dumps({"format": 1, "about": "none", "spots": []}))
    result = release(profile="public", root=root, store=store, register=register, now=NOW, spot=spot)
    return result, root, store, register


def current(root: Path) -> Path:
    return root / "releases" / (root / "CURRENT").read_text().strip()


def series(root: Path, key: str, where="series") -> dict[str, dict]:
    return {o["period"]: o for o in json.loads((current(root) / where / f"{key}.json").read_text())["observations"]}


def test_the_g20_rows_pass_the_release_gate_when_the_imf_row_is_signed(released):
    result, root, _, _ = released
    assert result.exit_code == 0, result.lines
    manifest = json.loads((current(root) / "manifest.json").read_text())
    assert validate_release(current(root)) == []
    published = {entry["key"]: entry for entry in json.loads((current(root) / "catalog.json").read_text())["series"]}
    assert sorted(published) == sorted([*CPI, *INFLATION, *FX])
    assert len(CPI) == 19 and len(FX) == 16
    assert manifest["withheld"] == []
    assert manifest["checks"]["passed"] is True
    assert {check["outcome"] for check in manifest["checks"]["report"]} == {"pass"}


def test_each_series_names_the_fund_its_dataflow_key_and_the_terms_it_is_shown_under(released):
    _, root, _, _ = released
    published = {entry["key"]: entry for entry in json.loads((current(root) / "catalog.json").read_text())["series"]}
    catalog = load_catalog()
    assert published["jp_cpi"]["source"] == {
        "origin": {"producer": "International Monetary Fund", "dataset": "Consumer Price Index",
                   "origin_id": "JPN.CPI._T.IX.M", "url": "https://data.imf.org/"},
        "channel": {"via": "direct", "adapter": "imf_sdmx", "endpoint": "imf-cpi-g20"}}
    assert published["ez_fx"]["source"]["origin"]["origin_id"] == "G163.XDC_USD.PA_RT.M"
    for key in [*CPI, *FX]:
        assert published[key]["source"]["origin"]["origin_id"] == catalog[key]["source"]["origin"]["origin_id"], key
        assert published[key]["rights"]["status"] == "citation_required", key
        assert published[key]["rights"]["attribution"] == "Source: International Monetary Fund.", key
    # A Derived series carries the Rights of what it is computed from.
    assert published["jp_infl"]["rights"]["status"] == "citation_required"


def test_values_reach_the_release_as_the_fund_printed_them(released):
    _, root, _, _ = released
    body = json.loads((FIXTURES / "imf/imf-cpi-g20/part-1.json").read_text())["data"]
    structure, listed = body["structures"][0], body["dataSets"][0]["series"]
    countries = [v["id"] for v in structure["dimensions"]["series"][0]["values"]]
    times = [v["value"] for v in structure["dimensions"]["observation"][0]["values"]]

    def printed(country: str) -> dict[str, str | None]:
        entry = listed[f"{countries.index(country)}:0:0:0:0"]
        return {times[int(at)].replace("-M", "-"): cell[0] for at, cell in entry["observations"].items()}

    japan = series(root, "jp_cpi")
    said = printed("JPN")
    # Listed with nulls before it begins: those months are padding, not missing months.
    assert said["2023-10"] is None and next(iter(japan)) == "2024-01"
    assert japan["2026-10"]["value"] == float(said["2026-10"]) and japan["2026-10"]["status"] == "final"
    assert all(japan[period]["value"] == float(text) for period, text in said.items() if text is not None)
    # The times came in no order; the Series is in order.
    assert list(japan) == sorted(japan)
    # A month the Fund does not list is an explicit missing month of the Series, never a made-up value.
    usa = series(root, "us_cpi")
    assert "2025-10" not in printed("USA")
    assert usa["2025-10"] == {**usa["2025-10"], "value": None, "status": "missing"}
    # Australia's monthly index begins in April 2024.
    assert next(iter(series(root, "au_cpi"))) == "2024-04"


def test_a_rate_from_before_a_redenomination_keeps_its_size(released):
    _, root, _, _ = released
    rate = series(root, "br_fx")
    assert 0 < rate["2024-01"]["value"] < 1e-11 and rate["2024-04"]["value"] > 0.1
    assert rate["2024-02"]["value"] != rate["2024-01"]["value"]  # the far decimals are kept


def test_inflation_is_the_change_from_the_same_month_a_year_earlier_by_the_calendar(released):
    _, root, _, _ = released
    index, change = series(root, "us_cpi"), series(root, "us_infl", "derived")
    expected = (index["2026-09"]["value"] / index["2025-09"]["value"] - 1) * 100
    assert change["2026-09"]["value"] == pytest.approx(expected, abs=1e-9)
    # October 2025 is not listed: nothing is computed for it, nor from it a year later, and the
    # months after it are still compared with their own month of the year before.
    assert change["2025-10"]["value"] is None
    assert "2026-10" not in change or change["2026-10"]["value"] is None
    after = (index["2025-11"]["value"] / index["2024-11"]["value"] - 1) * 100
    assert change["2025-11"]["value"] == pytest.approx(after, abs=1e-9)
    # A short index gives a short change: Australia's begins twelve months after its index.
    assert next(iter(series(root, "au_infl", "derived"))) == "2025-04"


def test_under_the_committed_register_nothing_is_captured_recorded_or_released(tmp_path, capsys, released):
    _, _, store, _ = released
    assert capture_main(["--store", str(tmp_path / "store"), "--replay", str(FIXTURES), "--only", "imf"]) == 1
    assert "the rights register row for International Monetary Fund (imf) is not signed" in capsys.readouterr().out
    assert not (tmp_path / "store").exists()
    assert replay_main(["--store", str(tmp_path / "vintages"), "--captures", str(store)]) == 1
    out = capsys.readouterr().out
    for key in ("jp_cpi", "us_cpi", "tryusd", "ez_fx"):
        assert f"REFUSED {key}:" in out
    result = release(profile="public", root=tmp_path / "public", store=store, now=NOW)
    assert result.exit_code == 1
    assert not (tmp_path / "public" / "CURRENT").exists()


def test_the_imf_row_decides_alone_another_origins_signature_shows_nothing_of_the_funds(tmp_path, released):
    _, _, store, _ = released
    register = signed(tmp_path, rows=("bls", "fed-board", "e-stat"))
    result = release(profile="public", root=tmp_path / "public", store=store, register=register, now=NOW)
    # Every Series in the store is the Fund's: there is nothing left to release.
    assert result.exit_code == 1
    assert not (tmp_path / "public" / "CURRENT").exists()
