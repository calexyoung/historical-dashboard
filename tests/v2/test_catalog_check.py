"""`atlas check` (PLAN 5, M12): four layers over the Catalog, each failing on a seeded error,
and the committed Catalog passing all of them."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from atlas.catalog import load_catalog
from atlas.catalog.check import LAYERS, check
from atlas.cli import main as atlas_main
from atlas.rights import load_register

from .catalog_helpers import derived, stored, write

ROOT = Path(__file__).resolve().parents[2]
V1_KEYS = sorted([*json.loads((ROOT / "data" / "atlas.json").read_text())["series"],
                  "approval", "pres_margin", "house_margin"])
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
    assert sorted(set(catalog) - set(V1_KEYS)) == ["cpi_nsa"]
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
            assert entry.get("range") == ([float(x) for x in old["range"]] if "range" in old else None), old["key"]


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
    assert sorted(k for k, e in catalog.items() if "recipe" in e) == sorted([*expected, "gold_eur", "t10y2y"])


def test_only_what_an_adapter_is_built_for_is_in_the_pipeline():
    """A draft is a proposal: it is never captured, replayed or released, so a local Release
    keeps v1's own Series, with v1's own provenance, for every key not yet live."""
    catalog = load_catalog()
    assert sorted(k for k, e in catalog.items() if e["status"] != "draft") == [
        "cpi", "cpi_nsa", "cpi_yoy", "payems", "ted", "unrate"]
    assert catalog["ted"]["status"] == "retired" and catalog["ted"]["source"]["channel"] is None
    assert all(e["source"]["channel"] is None or "endpoint" not in e["source"]["channel"]
               for e in catalog.values() if e["status"] == "draft" and "source" in e)
    intermediaries = sorted({e["source"]["channel"]["via"] for e in catalog.values()
                             if "source" in e and e["source"]["channel"]})
    assert intermediaries == ["direct", "hand_entered"]  # nothing proposes FRED or Yahoo


# --- a seeded error in each layer --------------------------------------------------------------


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
    ([stored(freq="quarterly"), derived()], "finer than"),
    ([stored(status="active")], "names no Endpoint"),
    ([stored(), derived(status="active")], "is a draft"),
    ([stored(range=[5, 1])], "range"),
    ([stored(earlier_metadata=[{"from": "2026-01-01T00:00:00Z", "name": "a", "unit": "b"}],
             metadata_from="2026-02-01T00:00:00Z")], "from the start"),
    ([stored(earlier_metadata=[{"from": None, "name": "a", "unit": "b"}],
             metadata_from="2026-02-01T00:00:00Z"),
      stored("fx_late", earlier_metadata=[{"from": None, "name": "a", "unit": "b"},
                                          {"from": "2026-03-01T00:00:00Z", "name": "c", "unit": "b"}],
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
    assert "127 Series" in out


def test_atlas_check_exits_one_and_names_the_file_and_the_layers_not_run(tmp_path, capsys):
    directory = write(tmp_path / "series", stored(), derived(inputs=("fx_nowhere",)))
    assert atlas_main(["check", "--catalog", str(directory)]) == 1
    out = capsys.readouterr().out
    assert "fx_price_yoy.json" in out and "references: 1 error" in out
    assert "semantics: not run" in out and "rights: not run" in out


def test_v1s_data_check_is_still_there_under_its_own_flag(monkeypatch, capsys):
    import atlas.cli as cli

    seen = []
    monkeypatch.setattr(cli, "cmd_check", lambda a: seen.append("v1") or 0)
    assert atlas_main(["check", "--v1"]) == 0 and seen == ["v1"]
    assert "check --v1" in (ROOT / "Makefile").read_text()
