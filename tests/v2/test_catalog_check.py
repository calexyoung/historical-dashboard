"""`atlas check` (PLAN 5, M12): four layers over the Catalog, each failing on a seeded error,
and the committed Catalog passing all of them."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from atlas.capture.run import endpoints_from_register
from atlas.catalog import load_catalog
from atlas.catalog.check import LAYERS, check
from atlas.cli import main as atlas_main
from atlas.rights import load_register

from .catalog_helpers import derived, stored, write

ROOT = Path(__file__).resolve().parents[2]
V1_KEYS = sorted([*json.loads((ROOT / "data" / "atlas.json").read_text())["series"],
                  "approval", "pres_margin", "house_margin"])
#: Ranges M13 widened to the whole history the Board publishes (ADR 0027, decision 10).
WIDENED = ("fedfunds", "gs10", "gs2", "jpy")
BOUND = {"origin": {"producer": "U.S. Bureau of Labor Statistics", "dataset": "Consumer Price Index",
                    "origin_id": "CUSR0000SA0", "url": None},
         "channel": {"via": "direct", "adapter": "bls", "endpoint": "bls-headline"}}


def failed(report) -> dict[str, list[str]]:
    return {layer.name: [p.message for p in layer.problems] for layer in report.layers if layer.problems}


def run(tmp_path, *entries, register=None):
    return check(write(tmp_path / "series", *entries), register)


# --- the committed Catalog ---------------------------------------------------------------------


def test_the_committed_catalog_passes_every_layer():
    report = check()
    assert failed(report) == {}
    assert [layer.name for layer in report.layers] == list(LAYERS) == ["schema", "references", "semantics", "rights"]
    assert all(layer.ran for layer in report.layers) and report.ok


def test_every_v1_key_is_a_key_of_the_catalog_unchanged():
    """v1's 126 series: the 123 in its output and the three it entered by hand. An Explorer
    address names Series by key, so a key that changed would break a link from track A."""
    catalog = load_catalog()
    assert len(V1_KEYS) == 126
    assert [key for key in V1_KEYS if key not in catalog] == []
    new = sorted(set(catalog) - set(V1_KEYS))
    assert [key for key in new if not key.endswith(("_cpi", "_infl", "_fx"))] == [
        "construction_private", "construction_public", "construction_total",  # M16: the C30 totals
        "cpi_nsa", "elec_gen", "gdp_nominal", "net_worth", "outlays", "pce", "personal_income",
        "real_dpi", "receipts", "trade_q", "uk_cpi_imf", "uk_infl_imf"]  # M15 added six
    # M14: the G20 rows. An index and its change for sixteen countries v1 had neither for, and
    # a monthly dollar rate for fifteen currencies (Turkey's is v1's tryusd). The Fund's index
    # for the United Kingdom is not the ONS index v1 showed, so it has a key of its own.
    assert [len([key for key in new if key.endswith(end)]) for end in ("_cpi", "_infl", "_fx")] == [16, 16, 15]
    recorded = json.loads((ROOT / "checks" / "v1-links.json").read_text())
    selected = {key for group in ("presets", "links") for item in recorded.get(group, [])
                for key in item["v1"]["sel"]}
    assert len(selected) > 10 and selected <= set(catalog)


def test_all_109_entries_of_v1s_catalog_are_migrated_with_what_v1_said_of_them():
    v1 = yaml.safe_load((ROOT / "atlas" / "catalog.yaml").read_text())
    catalog = load_catalog()
    assert len(v1) == 109
    for old in v1:
        entry = catalog[old["key"]]
        assert entry["migration"]["v1_source"], old["key"]
        assert entry["topics"] and entry["segment"]
        if old["key"] not in ("cpi", "unrate", "payems"):  # bound in M8, with limits of their own
            assert entry["max_lag"] == f"P{old['max_lag_months']}M", old["key"]
            if old["key"] not in WIDENED:
                assert entry.get("range") == ([float(x) for x in old["range"]] if "range" in old else None), old["key"]
            else:  # v1's range was for the years since 2000; the Board's file begins decades earlier
                assert entry["range"][0] <= old["range"][0] and entry["range"][1] > old["range"][1], old["key"]


def test_the_fourteen_year_over_year_series_and_the_ratio_are_recipes():
    catalog = load_catalog()
    expected = {  # key: (input, Periods in a year at the input's frequency)
        "cpi_yoy": ("cpi_nsa", 12), "corecpi_yoy": ("corecpi", 12), "gdp_yoy": ("gdp", 4),
        "m2_yoy": ("m2", 12), "wages_yoy": ("wages", 12), "cs_yoy": ("caseshiller", 12),
        "rent_yoy": ("rent_cpi", 12), "ez_infl": ("ez_hicp", 12), "ez_gdp_yoy": ("ez_gdp", 4),
        "uk_infl": ("uk_cpi", 12), "jp_infl": ("jp_cpi", 12), "cn_infl": ("cn_cpi", 12),
        "cn_gdp_yoy": ("cn_gdp", 1), "food_yoy": ("food", 12),
    }
    for key, (source, lag) in expected.items():
        assert catalog[key]["recipe"] == {"op": "pct_change", "inputs": [source],
                                          "order": "aggregate_then_compute", "params": {"lag": lag}}, key
        assert catalog[key]["freq"] == catalog[source]["freq"] and "source" not in catalog[key]
    assert catalog["gold_eur"]["recipe"] == {"op": "ratio", "inputs": ["gold", "eurusd"],
                                             "order": "aggregate_then_compute"}
    assert catalog["gold_eur"]["freq"] == "monthly"  # month-end gold over the month's mean rate
    m14 = [*(f"{c}_infl" for c in ("ar", "au", "br", "ca", "de", "fr", "id", "in", "it", "kr", "mx", "ru",
                                   "sa", "tr", "us", "za")), "uk_infl_imf"]  # not in v1: the rest of the G20 row
    for key in m14:
        assert catalog[key]["recipe"] == {"op": "pct_change", "inputs": [key.replace("_infl", "_cpi")],
                                          "order": "aggregate_then_compute", "params": {"lag": 12}}, key
    assert sorted(k for k, e in catalog.items() if "recipe" in e) == sorted([*expected, "gold_eur", "t10y2y", *m14])


def test_only_what_an_adapter_is_built_for_is_in_the_pipeline():
    """A draft is a proposal: it is never captured, replayed or released, so a local Release
    keeps v1's own Series, with v1's own provenance, for every key not yet live."""
    catalog = load_catalog()
    live = sorted(k for k, e in catalog.items() if e["status"] != "draft")
    g20 = ["ar", "au", "br", "ca", "cn", "de", "fr", "id", "in", "it", "jp", "kr", "mx", "ru", "sa", "tr",
           "uk", "us", "za"]
    assert [k for k in live if "recipe" in catalog[k]] == sorted([
        "corecpi_yoy", "cpi_yoy", "gdp_yoy", "m2_yoy", "rent_yoy", "t10y2y", "wages_yoy",  # M15: gdp_yoy
        *(f"{c}_infl" for c in g20 if c != "uk"), "uk_infl_imf"])  # M14: inflation in the nineteen
    by_adapter: dict[str, list[str]] = {}
    for key in live:
        channel = catalog[key].get("source", {}).get("channel")
        if channel:
            by_adapter.setdefault(channel["adapter"], []).append(key)
    assert by_adapter == {  # M7 and M8: four BLS Series. M13: the rest.
        "bls": ["civpart", "corecpi", "cpi", "cpi_nsa", "eggs", "labor_share", "payems", "real_wages",
                "rent_cpi", "unrate", "wages"],
        "treasury_fiscal_data": ["debt", "outlays", "receipts"],
        "fed_board": ["brl", "cad", "cny", "credit", "delinq", "eurusd", "fedassets", "fedfunds",
                      "gbpusd", "gs10", "gs2", "indpro", "inr", "jpy", "m2", "mxn", "net_worth",
                      "usd_broad"],
        # M14: the index of each of the nineteen, and the dollar rate of the fifteen with a
        # currency of their own that is not the dollar, and of the euro.
        "imf_sdmx": sorted([*(f"{c}_cpi" for c in g20 if c != "uk"), "uk_cpi_imf", "tryusd", "ez_fx",
                            *(f"{c}_fx" for c in g20 if c not in ("de", "fr", "it", "us", "tr"))]),
        # M15: the two sources that want a key.
        "bea": ["gdp", "gdp_nominal", "gdp_qoq", "pce", "personal_income", "profits", "real_dpi", "saving",
                "trade_q"],
        "eia": ["brent", "elec_gen", "gas", "natgas", "wti"],
        # M16: three flat files of the Census Bureau's Economic Indicators, and its construction workbook.
        "census_eits": ["houst", "retail", "trade"],
        "census_c30": ["construction_private", "construction_public", "construction_total"],
    }
    assert all(catalog[key]["source"]["channel"]["auth"] == "api_key" for key in (*by_adapter["bea"], *by_adapter["eia"]))
    # The monthly balance v1 showed is not in the BEA's API: it is read from the Census Bureau's file.
    assert catalog["trade"]["source"]["origin"]["producer"] == "U.S. Census Bureau"
    assert catalog["trade"]["migration"]["milestone"] == "M16" and catalog["trade_q"]["status"] == "active"
    # The hand-entered Series wait for a signed row: the adapter is built, no value is entered.
    assert {catalog[key]["status"] for key in ("approval", "pres_margin", "house_margin")} == {"draft"}
    # v1's UK index is the ONS's, which the Fund's is not: it stays a draft under its own key.
    assert catalog["uk_cpi"]["status"] == catalog["uk_infl"]["status"] == "draft"
    assert catalog["uk_cpi"]["source"]["origin"]["origin_id"] == "D7BT"
    assert catalog["ted"]["status"] == "retired" and catalog["ted"]["source"]["channel"] is None
    assert all(e["source"]["channel"] is None or "endpoint" not in e["source"]["channel"]
               for e in catalog.values() if e["status"] == "draft" and "source" in e)
    intermediaries = sorted({e["source"]["channel"]["via"] for e in catalog.values()
                             if "source" in e and e["source"]["channel"]})
    assert intermediaries == ["direct", "hand_entered"]  # nothing proposes FRED or Yahoo


# --- a seeded error in each layer --------------------------------------------------------------


@pytest.mark.parametrize("country, valid", [("USA", True), ("EA", True), ("G20", True), ("US", False),
                                            ("ZZZZ", False), ("usa", False)])
def test_a_country_is_three_capital_letters_or_a_group_code(tmp_path, country, valid):
    report = run(tmp_path, stored(country=country))
    assert report.ok is valid


def test_schema_layer_a_field_the_schema_does_not_know(tmp_path):
    report = run(tmp_path, stored(), stored("fx_other", ml_use=True))
    assert list(failed(report)) == ["schema"]
    assert [layer.ran for layer in report.layers] == [True, False, False, False] and not report.ok


@pytest.mark.parametrize("entries, said", [
    ([derived(inputs=("fx_nowhere",))], "fx_nowhere"),
    ([stored(aliases=["fx_two"]), stored("fx_two")], "fx_two"),
    ([stored(status="active", source={**BOUND, "channel": {"via": "direct", "endpoint": "bls-nothing"}})],
     "bls-nothing"),
    ([stored(status="active", source={**BOUND, "origin": {**BOUND["origin"], "dataset": "Another survey"}})],
     "Another survey"),
    ([stored(status="active", source={**BOUND, "origin": {**BOUND["origin"], "origin_id": "CUSR0000XXX"}})],
     "CUSR0000XXX"),
    ([stored(status="active", source={**BOUND, "origin": {**BOUND["origin"], "producer": "Somebody Else"}})],
     "Somebody Else"),
    ([stored(status="active", source={**BOUND, "channel": {**BOUND["channel"], "adapter": "fed_board"}})],
     "fed_board"),
    ([stored(status="active", source=BOUND), stored("fx_again", status="active", source=BOUND)], "bound"),
])
def test_references_layer(tmp_path, entries, said):
    report = run(tmp_path, *entries)
    assert list(failed(report)) == ["references"]
    assert any(said in message for message in failed(report)["references"])
    assert [layer.ran for layer in report.layers] == [True, True, False, False]


def ring(*keys):
    return [derived(key, inputs=(keys[(i + 1) % len(keys)],)) for i, key in enumerate(keys)]


@pytest.mark.parametrize("entries, said", [
    (ring("fx_a", "fx_b", "fx_c"), "fx_a → fx_b → fx_c → fx_a"),
    ([stored(measure_kind="flow", agg="mean")], "a flow is combined by sum"),
    ([stored(), stored("fx_rate", unit="percent", unit_kind="percent", measure_kind="rate"),
      derived("fx_gap", recipe={"op": "difference", "inputs": ["fx_price", "fx_rate"],
                                "order": "aggregate_then_compute"})], "the same kind of unit"),
    ([stored("fx_long", unit="percent", unit_kind="percent", measure_kind="rate"),
      stored("fx_short", unit="percent", unit_kind="percent", measure_kind="rate"),
      derived("fx_gap", recipe={"op": "difference", "inputs": ["fx_long", "fx_short"],
                                "order": "aggregate_then_compute"})], "percentage points"),
    ([stored("fx_usd", unit="U.S. dollars", unit_kind="currency", measure_kind="stock"),
      stored("fx_musd", unit="millions of U.S. dollars", unit_kind="currency", measure_kind="stock"),
      derived("fx_gap", unit="U.S. dollars", unit_kind="currency", measure_kind="stock",
              recipe={"op": "difference", "inputs": ["fx_usd", "fx_musd"],
                      "order": "aggregate_then_compute"})], "in one unit"),
    ([stored("fx_long", unit="percent", unit_kind="percent", measure_kind="rate"),
      stored("fx_short", unit="percent", unit_kind="percent", measure_kind="rate"),
      derived("fx_both", unit="index", unit_kind="index", measure_kind="rate",
              recipe={"op": "sum", "inputs": ["fx_long", "fx_short"],
                      "order": "aggregate_then_compute"})], "same kind of unit, not index"),
    ([stored(), derived(status="retired")], "is retired and its input fx_price is a draft"),
    ([stored(status="retired"), derived(status="active")], "its input fx_price names no Endpoint"),
    ([stored(freq="quarterly"), derived()], "finer than"),
    ([stored(status="active")], "names no Endpoint"),
    ([stored(), derived(status="active")], "is a draft"),
    ([stored(range=[5, 1])], "range"),
    ([stored(earlier_metadata=[{"from": "2026-01-01T00:00:00Z", "name": "a", "unit": "b", "seasonal_adjustment": "nsa"}],
             metadata_from="2026-02-01T00:00:00Z")], "from the start"),
    ([stored(earlier_metadata=[{"from": None, "name": "a", "unit": "b", "seasonal_adjustment": "nsa"}],
             metadata_from="2026-02-01T00:00:00Z"),
      stored("fx_late", earlier_metadata=[{"from": None, "name": "a", "unit": "b", "seasonal_adjustment": "nsa"},
                                          {"from": "2026-03-01T00:00:00Z", "name": "c", "unit": "b", "seasonal_adjustment": "nsa"}],
             metadata_from="2026-02-01T00:00:00Z")], "order of time"),
])
def test_semantics_layer(tmp_path, entries, said):
    report = run(tmp_path, *entries)
    assert list(failed(report)) == ["semantics"], failed(report)
    assert any(said in message for message in failed(report)["semantics"]), failed(report)
    assert [layer.ran for layer in report.layers] == [True, True, True, False]


def test_rights_layer_an_active_series_through_an_intermediary_nobody_cleared(tmp_path):
    register = load_register()
    register["rows"][0]["capture"][0]["channel"] = "fred"
    path = tmp_path / "register.json"
    path.write_text(json.dumps(register))
    through_fred = stored("cpi", status="active", source={**BOUND, "channel": {"via": "fred", "endpoint": "bls-headline"}})
    report = run(tmp_path, through_fred, register=path)
    assert list(failed(report)) == ["rights"]
    assert "fred" in failed(report)["rights"][0] and "ADR 0006" in failed(report)["rights"][0]


def test_rights_layer_a_register_the_gate_cannot_trust(tmp_path):
    register = load_register()
    register["rows"][0]["decision"] = {"display": True, "redistribute": True, "store": True, "ml_use": True,
                                       "signed_by": "Somebody", "signed_on": "2026-11-11"}
    path = tmp_path / "register.json"
    path.write_text(json.dumps(register))
    report = run(tmp_path, stored(), register=path)
    assert list(failed(report)) == ["rights"] and "register" in failed(report)["rights"][0]


def test_a_draft_may_propose_an_intermediary_and_stays_withheld(tmp_path):
    report = run(tmp_path, stored(source={**stored()["source"], "channel": {"via": "fred"}}))
    assert report.ok


# --- the command -------------------------------------------------------------------------------


def test_atlas_check_exits_zero_on_the_committed_catalog_and_names_each_layer(capsys):
    assert atlas_main(["check"]) == 0
    out = capsys.readouterr().out
    for layer in LAYERS:
        assert f"{layer}: ok" in out
    assert "188 Series" in out


def test_atlas_check_exits_one_and_names_the_file_and_the_layers_not_run(tmp_path, capsys):
    directory = write(tmp_path / "series", stored(), derived(inputs=("fx_nowhere",)))
    assert atlas_main(["check", "--catalog", str(directory)]) == 1
    out = capsys.readouterr().out
    assert "fx_price_yoy.json" in out and "references: 1 error" in out
    assert "semantics: not run" in out and "rights: not run" in out


def test_v1s_data_check_is_still_there_under_its_own_flag(monkeypatch, capsys):
    from atlas import cli

    seen = []
    monkeypatch.setattr(cli, "cmd_check", lambda a: seen.append("v1") or 0)
    assert atlas_main(["check", "--v1"]) == 0 and seen == ["v1"]
    assert "check --v1" in (ROOT / "Makefile").read_text()


# --- the boundary with v1's data (PLAN 6.1) ----------------------------------------------------


def test_a_local_release_keeps_v1s_series_and_provenance_whatever_the_catalog_proposes(tmp_path):
    """Draft entries propose agency Sources for v1's keys. None of that reaches a Release: a
    local Release built with the committed Catalog still holds every v1 series whole, in the
    legacy representation, under the Source v1 recorded, and nothing under a proposed one."""
    from datetime import UTC, datetime

    from atlas.legacy import build_release
    from atlas.publish.export import build
    from atlas.rights import RightsGate
    from atlas.vintage.replay import load_derived, load_series

    now = datetime(2026, 11, 12, tzinfo=UTC)
    _, legacy = build_release(ROOT, now)
    table = load_register()
    store = tmp_path / "store"
    store.mkdir()
    built = build(profile="local", store=store, table=table, gate=RightsGate(table), series=load_series(),
                  derived=load_derived(), created=now, legacy=legacy)
    catalog = {e["key"]: e for e in json.loads(built.files["catalog.json"])["series"]}
    assert sorted(catalog) == V1_KEYS
    assert {e["representation"] for e in catalog.values()} == {"legacy_monthly_rounded"}
    assert catalog["gs10"]["source"]["channel"] == {"via": "fred"} and catalog["gs10"]["freq"] == "monthly"
    assert catalog["cpi"]["source"]["origin"]["origin_id"] == "CPIAUCSL"
    assert catalog["spx"]["source"]["channel"] == {"via": "yahoo"}
    assert built.files["series/gs10.json"] == legacy["series/gs10.json"]
    assert not any(e["source"]["channel"]["via"] == "direct" and e["source"]["origin"]["producer"].startswith("Board")
                   for e in catalog.values())


def test_a_catalog_that_passes_the_check_gives_a_series_table_the_store_can_load():
    from atlas.vintage.replay import load_derived, load_series

    assert check().ok
    stored_keys = {e["key"] for e in load_series()}
    for row in load_derived():
        assert set(row["recipe"]["inputs"]) <= stored_keys | {r["key"] for r in load_derived()}


# --- what an Endpoint must say of a Series bound to it (M13) ----------------------------------

FED_SOURCE = {"origin": {"producer": "Board of Governors of the Federal Reserve System",
                         "dataset": "H.15 Selected Interest Rates", "origin_id": "RIFLGFCY10_N.B", "url": None},
              "channel": {"via": "direct", "adapter": "fed_board", "endpoint": "fed-h15-treasury-yields"}}


def _fed(origin_id, freq="business_daily"):
    source = {**FED_SOURCE, "origin": {**FED_SOURCE["origin"], "origin_id": origin_id}}
    return stored("gs10", status="active", freq=freq, measure_kind="rate", unit="percent",
                  unit_kind="percent", source=source)


def test_a_series_bound_to_a_board_package_is_one_of_its_columns(tmp_path):
    assert failed(run(tmp_path, _fed("RIFLGFCY10_N.B"))) == {}
    assert failed(run(tmp_path, _fed("NOT_A_COLUMN"))) == {"references": [
        "the endpoint fed-h15-treasury-yields does not ask for NOT_A_COLUMN"]}


def test_a_series_read_from_a_board_package_has_its_unit_and_multiplier_pinned(tmp_path):
    # RIFLGFCY30_N.B is a column of the package, and the endpoint pins no label for it: a
    # change of unit or multiplier would go unseen.
    assert failed(run(tmp_path, _fed("RIFLGFCY30_N.B"))) == {"references": [
        ("the endpoint fed-h15-treasury-yields does not say what unit and multiplier the Board "
        "labels RIFLGFCY30_N.B with (its labels)")]}


def test_a_series_frequency_is_the_one_its_endpoint_reads_at(tmp_path):
    assert failed(run(tmp_path, _fed("RIFLGFCY10_N.B", freq="monthly"))) == {"references": [
        "it is monthly, and the endpoint fed-h15-treasury-yields is read by day"]}


# --- what an IMF endpoint must say of a Series bound to it (M14) ------------------------------

IMF_SOURCE = {"origin": {"producer": "International Monetary Fund", "dataset": "Consumer Price Index",
                         "origin_id": "JPN.CPI._T.IX.M", "url": None},
              "channel": {"via": "direct", "adapter": "imf_sdmx", "endpoint": "imf-cpi-g20"}}


def _imf(origin_id="JPN.CPI._T.IX.M", **changes):
    source = {**IMF_SOURCE, "origin": {**IMF_SOURCE["origin"], "origin_id": origin_id}}
    return stored("jp_cpi", status="active", source=source, **changes)


def _register_without_pins(tmp_path) -> Path:
    table = load_register()
    row = next(r for r in table["rows"] if r["id"] == "imf")
    del next(e for e in row["capture"] if e["id"] == "imf-cpi-g20")["params"]["reference"]["JPN.CPI._T.IX.M"]
    path = tmp_path / "register.json"
    path.write_text(json.dumps(table))
    return path


def test_a_series_bound_to_an_imf_endpoint_is_one_of_the_series_it_asks_for(tmp_path):
    assert failed(run(tmp_path, _imf())) == {}
    assert failed(run(tmp_path, _imf("NZL.CPI._T.IX.M"))) == {"references": [
        "the endpoint imf-cpi-g20 does not ask for NZL.CPI._T.IX.M"]}


def test_a_series_frequency_is_the_one_its_imf_key_ends_in(tmp_path):
    assert failed(run(tmp_path, _imf(freq="quarterly"))) == {"references": [
        "it is quarterly, and JPN.CPI._T.IX.M is a monthly series of the Fund's"]}


def test_an_index_read_from_the_imf_has_its_reference_period_pinned(tmp_path):
    # Without the pin a rebase would go unseen and every figure would mean something else.
    assert failed(run(tmp_path, _imf(), register=_register_without_pins(tmp_path))) == {"references": [
        ("the endpoint imf-cpi-g20 does not pin the reference period the Fund gives "
         "JPN.CPI._T.IX.M (its reference)")]}
    # Only an index has a reference period: an exchange rate needs no pin.
    rate = stored("jp_fx", status="active", unit="Japanese yen per U.S. dollar", unit_kind="currency",
                  measure_kind="rate", source={
                      "origin": {**IMF_SOURCE["origin"], "dataset": "Exchange Rates", "origin_id": "JPN.XDC_USD.PA_RT.M"},
                      "channel": {**IMF_SOURCE["channel"], "endpoint": "imf-er-g20"}})
    assert failed(run(tmp_path / "rate", rate)) == {}


# --- what a BEA or an EIA endpoint must say of a Series bound to it (M15) ----------------------


def _keyed(key, adapter, endpoint, producer, dataset, origin_id, **changes):
    source = {"origin": {"producer": producer, "dataset": dataset, "origin_id": origin_id, "url": None},
              "channel": {"via": "direct", "adapter": adapter, "endpoint": endpoint, "auth": "api_key"}}
    return stored(key, status="active", source=source, **changes)


def test_a_series_bound_to_a_bea_table_is_one_of_its_lines_at_the_tables_frequency(tmp_path):
    bea = ("bea", "bea-nipa-t10106", "U.S. Bureau of Economic Analysis",
           "National Income and Product Accounts, Table 1.1.6")
    assert failed(run(tmp_path, _keyed("gdp", *bea, "A191RX", freq="quarterly"))) == {}
    assert failed(run(tmp_path, _keyed("gdp", *bea, "DPCERX", freq="quarterly"))) == {"references": [
        "the endpoint bea-nipa-t10106 does not ask for DPCERX"]}
    assert failed(run(tmp_path, _keyed("gdp", *bea, "A191RX", freq="monthly"))) == {"references": [
        "it is monthly, and the endpoint bea-nipa-t10106 asks the Bureau for quarterly figures"]}


def test_a_series_bound_to_an_eia_route_is_one_of_its_series_at_the_routes_frequency(tmp_path):
    eia = ("eia", "eia-gasoline-retail", "U.S. Energy Information Administration", "Gasoline and Diesel Fuel Update")
    assert failed(run(tmp_path, _keyed("gas", *eia, "EMM_EPMR_PTE_NUS_DPG", freq="weekly"))) == {}
    assert failed(run(tmp_path, _keyed("gas", *eia, "EMM_EPMR_PTE_NUS_DPG", freq="monthly"))) == {"references": [
        "it is monthly, and the endpoint eia-gasoline-retail asks the Administration for weekly figures"]}


# --- what a Census endpoint must say of a Series bound to it (M16) -----------------------------


def _census(key, adapter, endpoint, dataset, origin_id, **changes):
    source = {"origin": {"producer": "U.S. Census Bureau", "dataset": dataset, "origin_id": origin_id, "url": None},
              "channel": {"via": "direct", "adapter": adapter, "endpoint": endpoint}}
    return stored(key, status="active", source=source, **changes)


def test_a_series_bound_to_a_census_file_is_one_of_the_series_it_reads_and_is_monthly(tmp_path):
    flat = ("census_eits", "census-marts", "Advance Monthly Sales for Retail and Food Services")
    assert failed(run(tmp_path, _census("retail", *flat, "44X72:SM:US:SA"))) == {}
    assert failed(run(tmp_path, _census("retail", *flat, "44000:SM:US:SA"))) == {"references": [
        "the endpoint census-marts does not ask for 44000:SM:US:SA"]}
    assert failed(run(tmp_path, _census("retail", *flat, "44X72:SM:US:SA", freq="quarterly"))) == {"references": [
        "it is quarterly, and the endpoint census-marts reads a file of monthly figures"]}
    book = ("census_c30", "census-c30-total", "Value of Construction Put in Place")
    assert failed(run(tmp_path / "book", _census("construction_total", *book, "Total Construction1"))) == {}
    assert failed(run(tmp_path / "book", _census("construction_total", *book, "Total Construction1", freq="annual"))) == {
        "references": ["it is annual, and the endpoint census-c30-total reads a file of monthly figures"]}


# --- hand-entered files and the Series bound to them (M16) -------------------------------------

MANUAL_FIXTURE = ROOT / "fixtures" / "manual" / "catalog" / "manual"
OFFICE = "An Invented Election Office"


def _manual_register(tmp_path, *, signed=True, record=True, **grants) -> Path:
    """The committed register with a row for the invented office and its hand-entered file, and
    the public-record row decided or not."""
    table = load_register()
    decision = {"display": True, "redistribute": True, "store": True, "ml_use": True,
                "signed_by": "Alex", "signed_on": "2026-11-11", **grants}
    table["rows"].append({
        "id": "office", "kind": "origin", "name": "An invented office", "origins": [OFFICE], "datasets": "*",
        "used_for": "test", "terms": [], "terms_note": "invented", "licence_class": "public_domain",
        "attribution": None, "open_questions": [],
        "proposal": {"display": True, "redistribute": True, "store": True, "ml_use": True, "note": "an invented row for a test"},
        "decision": decision if signed else None,
        "capture": [{"id": "office-margins", "adapter": "manual", "channel": "hand_entered",
                     "datasets": ["Official results, invented"],
                     "params": {"file": "catalog/manual/invented-margins.json", "frequency": "irregular",
                                "series": ["margin"], "units": {"margin": "percentage points"}}}]})
    if record:
        next(r for r in table["rows"] if r["id"] == "public-record")["decision"] = decision
    path = tmp_path / "register.json"
    path.write_text(json.dumps(table))
    return path


def _margin(**changes):
    source = {"origin": {"producer": OFFICE, "dataset": "Official results, invented", "origin_id": "margin", "url": None},
              "channel": {"via": "hand_entered", "adapter": "manual", "endpoint": "office-margins"}}
    return stored("fx_margin", **{
        "status": "active", "unit": "percentage points", "unit_kind": "percentage_points", "measure_kind": "rate",
        "agg": "none", "freq": "irregular", "continuity": "held", "seasonal_adjustment": "not_applicable",
        "refresh": "irregular", "source": source, **changes})


def _with_files(tmp_path, *, series=True, terms=True) -> Path:
    """A catalog directory with the invented hand-entered files beside it, as in the repository."""
    import shutil

    if series:
        (tmp_path / "manual").mkdir(parents=True, exist_ok=True)
        shutil.copy(MANUAL_FIXTURE / "invented-margins.json", tmp_path / "manual")
    if terms:
        (tmp_path / "manual" / "terms").mkdir(parents=True, exist_ok=True)
        shutil.copy(MANUAL_FIXTURE / "terms" / "invented-office.json", tmp_path / "manual" / "terms")
    return tmp_path / "series"


def run_in(directory, *entries, register):
    return check(write(directory, *entries), register=register)


def test_a_series_bound_to_a_hand_entered_file_has_its_frequency_and_its_unit(tmp_path):
    register = _manual_register(tmp_path)
    assert failed(run_in(_with_files(tmp_path / "a"), _margin(), register=register)) == {}
    assert failed(run_in(_with_files(tmp_path / "b"), _margin(freq="annual", agg="mean"), register=register)) == {
        "references": ["it is annual, and the hand-entered file of office-margins is irregular"]}
    assert failed(run_in(_with_files(tmp_path / "c"), _margin(unit="percent"), register=register)) == {
        "references": ["its unit is 'percent', and the hand-entered file of office-margins gives margin in 'percentage points'"]}


def test_a_hand_entered_file_is_held_to_its_endpoint_and_to_its_format(tmp_path):
    register = _manual_register(tmp_path)
    directory = _with_files(tmp_path)
    (tmp_path / "manual" / "stray.json").write_text((tmp_path / "manual" / "invented-margins.json").read_text())
    text = (tmp_path / "manual" / "invented-margins.json").read_text()
    (tmp_path / "manual" / "invented-margins.json").write_text(text.replace('"locator": "page 5, table A, the row \\"Total\\""', '"locator": ""'))
    (tmp_path / "manual" / "terms" / "invented-office.json").write_text(
        (tmp_path / "manual" / "terms" / "invented-office.json").read_text().replace('"end": "2021-01-31"', '"end": "2021-02-01"'))
    report = run_in(directory, _margin(), register=register)
    assert failed(report) == {"references": [
        "series margin, 2020-11-03, has a citation with no locator",
        "no endpoint of the rights register reads it: a hand-entered file is read through the capture kit or not kept",
        "term 2 (B. Sample) starts on 2021-02-01, not after the term before it ended (2021-02-01)"]}
    assert [Path(p.path).name for p in report.layers[1].problems] == ["invented-margins.json", "stray.json", "invented-office.json"]


def test_nothing_else_is_kept_under_catalog_manual(tmp_path):
    """A file the checks do not read could hold what no check has seen."""
    directory = _with_files(tmp_path)
    (tmp_path / "manual" / "results.csv").write_text("2020,5200,4800\n")
    (tmp_path / "manual" / "archive").mkdir()
    (tmp_path / "manual" / "archive" / "old.json").write_text("{}")
    (tmp_path / "manual" / "terms" / "notes.txt").write_text("x")
    report = run_in(directory, _margin(), register=_manual_register(tmp_path))
    assert [Path(p.path).name for p in report.layers[1].problems] == ["old.json", "results.csv", "notes.txt"]
    assert all("nothing else is kept there" in p.message for p in report.layers[1].problems)


def test_a_hand_entered_file_may_be_in_the_repository_only_when_its_origins_row_allows_a_public_copy(tmp_path):
    """No value is typed into the repository ahead of a decision: a committed file is a copy
    anyone can read, so its Origin's row must be signed for store and for redistribute."""
    directory = _with_files(tmp_path)
    assert failed(run_in(directory, _margin(), register=_manual_register(tmp_path))) == {}
    assert failed(run_in(directory, _margin(), register=_manual_register(tmp_path, signed=False, record=False))) == {"rights": [
        ("it holds values entered by hand from An Invented Election Office, and the rights register row for "
        "An Invented Election Office (office) is not signed: a committed file is a public copy"),
        ("it holds terms entered by hand from Macro Atlas, from the public record, and the rights register row for "
        "Macro Atlas, from the public record (public-record) is not signed: a committed file is a public copy")]}
    said = failed(run_in(directory, _margin(), register=_manual_register(tmp_path, redistribute=False)))["rights"]
    assert len(said) == 2 and all("does not allow redistribute" in line for line in said)


def test_the_repository_holds_no_hand_entered_file_while_no_row_is_signed():
    from atlas import manual

    assert manual.series_files() == [] and manual.terms_files() == []
    assert not any(e.adapter == "manual" for e in endpoints_from_register(load_register()))
