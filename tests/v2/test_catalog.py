"""Catalog v2 (PLAN M12; ADR 0026): one file per Series, read strictly, with no Rights of its
own, and projected into the series table the vintage store replays."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from atlas.catalog import CatalogError, load_catalog, read_catalog, rights_block, series_table
from atlas.rights import RightsGate, load_register
from atlas.vintage.replay import load_derived, load_series

from .catalog_helpers import derived, stored, write
from .test_vintage_replay import register  # noqa: F401  (a fixture)

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "schema" / "series.schema.json").read_text())
RELEASE = json.loads((ROOT / "schema" / "release.schema.json").read_text())


def test_the_definitions_shared_with_the_release_contract_are_the_same():
    for name in ("key", "date", "datetime", "period", "frequency", "origin", "channel", "recipeOrder", "recipe"):
        assert SCHEMA["$defs"][name] == RELEASE["$defs"][name], name
    entry = RELEASE["$defs"]["catalogEntry"]["properties"]
    for name in ("unit_kind", "measure_kind", "agg", "continuity", "seasonal_adjustment", "price_basis",
                 "segment", "max_lag", "range", "breaks", "definition"):
        assert SCHEMA["properties"][name] == entry[name], name


def test_a_catalog_is_read_one_file_per_series(tmp_path):
    directory = write(tmp_path / "series", stored(), derived())
    assert sorted(load_catalog(directory)) == ["fx_price", "fx_price_yoy"]


def test_a_file_must_be_named_for_its_key_and_say_nothing_twice(tmp_path):
    directory = write(tmp_path / "series", stored())
    (directory / "fx_other.json").write_text(json.dumps(stored()))
    (directory / "fx_twice.json").write_text('{"key": "fx_twice", "key": "fx_twice"}')
    entries, problems = read_catalog(directory)
    assert sorted(entries) == ["fx_price"]
    said = {Path(p.path).name: p.message for p in problems}
    assert "named for its key" in said["fx_other.json"] and "twice" in said["fx_twice.json"]
    with pytest.raises(CatalogError, match="fx_other.json"):
        load_catalog(directory)


@pytest.mark.parametrize("change", [
    lambda e: e.update(rights={"owner": "x", "terms_url": None, "status": "public_domain",
                               "attribution": None, "reviewed": None}),
    lambda e: e.update(display=True),
    lambda e: e.update(permissions={"display": True, "redistribute": True, "ml_use": True}),
    lambda e: e["source"].update(rights_status="public_domain"),
    lambda e: e["source"]["channel"].update(signed=True),
    lambda e: e["source"]["origin"].update(redistribute=True),
])
def test_no_entry_can_state_rights_or_a_permission(tmp_path, change):
    entry = stored()
    change(entry)
    _, problems = read_catalog(write(tmp_path / "series", entry))
    assert [p.layer for p in problems] == ["schema"]


def test_a_series_has_a_source_or_a_recipe_and_never_both(tmp_path):
    both = derived(source=stored()["source"])
    neither = stored(source=...)
    unsourced = stored("fx_none", source={"origin": stored()["source"]["origin"], "channel": None})
    explained = stored("fx_said", source={**unsourced["source"], "no_channel": {
        "kind": "rights_restriction", "reason": "The index is licensed."}})
    entries, problems = read_catalog(write(tmp_path / "series", both, neither, unsourced, explained))
    assert sorted(entries) == ["fx_said"]
    assert sorted(Path(p.path).name for p in problems) == ["fx_none.json", "fx_price.json", "fx_price_yoy.json"]


# --- Rights are looked up, never stored --------------------------------------------------------


def test_the_rights_of_a_stored_series_are_what_the_register_says_of_its_origin():
    table = load_register()
    gate = RightsGate(table)
    entries = {"fx_price": stored()}
    block = rights_block(entries["fx_price"], entries, table, gate)
    assert block["status"] == "public_domain" and block["owner"] == "Macro Atlas, synthetic fixture"
    unknown = stored(source={"origin": {"producer": "Nobody Known", "dataset": "x", "origin_id": None,
                                        "url": None}, "channel": {"via": "direct"}})
    assert rights_block(unknown, entries, table, gate) == {
        "owner": "Nobody Known", "terms_url": None, "status": "unknown", "attribution": None, "reviewed": None}


def test_the_rights_of_a_derived_series_are_the_most_restrictive_of_what_it_rests_on():
    table = load_register()
    gate = RightsGate(table)
    imf = stored("fx_imf", source={"origin": {"producer": "International Monetary Fund", "dataset": "CPI",
                                              "origin_id": None, "url": None}, "channel": {"via": "direct"}})
    entries = {"fx_price": stored(), "fx_imf": imf,
               "fx_ratio": derived("fx_ratio", recipe={"op": "ratio", "inputs": ["fx_price", "fx_imf"],
                                                       "order": "aggregate_then_compute"})}
    entries["fx_ratio_yoy"] = derived("fx_ratio_yoy", inputs=("fx_ratio",))
    block = rights_block(entries["fx_ratio_yoy"], entries, table, gate)
    assert block["status"] == "citation_required"
    assert "International Monetary Fund" in block["owner"] and "fixture" in block["owner"].lower()
    assert "International Monetary Fund" in block["attribution"]


# --- the series table the vintage store replays ------------------------------------------------

BOUND = {"origin": {"producer": "Macro Atlas fixture (synthetic)", "dataset": "Fixture prices",
                    "origin_id": "FXPRICE", "url": "https://example.test/fx"},
         "channel": {"via": "direct", "adapter": "fixture", "endpoint": "fx-monthly"}}


def test_a_bound_series_is_projected_with_its_dated_metadata_and_a_draft_is_left_out():
    entries = {
        "fx_price": stored(status="active", source=BOUND, max_lag="P3M", range=[50, 500],
                           topics=["prices"], description="Invented.", refresh="monthly",
                           earlier_metadata=[
                               {"from": None, "name": "Old name", "unit": "index, 2010 = 100",
                                "seasonal_adjustment": "sa"},
                               {"from": "2026-02-01T00:00:00Z", "name": "Middle name", "unit": "index, 2010 = 100"}],
                           metadata_from="2026-04-01T00:00:00Z"),
        "fx_ended": stored("fx_ended", status="retired", source={**BOUND, "origin": {**BOUND["origin"], "origin_id": "FXENDED"}}),
        "fx_draft": stored("fx_draft", source={**BOUND, "origin": {**BOUND["origin"], "origin_id": "FXDRAFT"}}),
        "fx_unbound": stored("fx_unbound"),
        "fx_price_yoy": derived(status="active", seasonal_adjustment="nsa"),
        "fx_draft_yoy": derived("fx_draft_yoy", inputs=("fx_draft",)),
    }
    table = series_table(entries)
    assert table["format"] == 1
    assert [e["key"] for e in table["series"]] == ["fx_ended", "fx_price"]
    assert table["series"][1] == {
        "key": "fx_price", "freq": "monthly", "endpoint": "fx-monthly", "origin_id": "FXPRICE",
        "dataset": "Fixture prices", "url": "https://example.test/fx",
        "metadata": [
            {"from": None, "name": "Old name", "unit": "index, 2010 = 100", "seasonal_adjustment": "sa"},
            {"from": "2026-02-01T00:00:00Z", "name": "Middle name", "unit": "index, 2010 = 100"},
            {"from": "2026-04-01T00:00:00Z", "name": "Fixture price index", "unit": "index, 2020 = 100",
             "seasonal_adjustment": "nsa"}],
        "catalog": {"measure_kind": "index", "unit_kind": "index", "segment": "economy_jobs",
                    "continuity": "discrete", "agg": "mean", "max_lag": "P3M", "range": [50, 500],
                    "price_basis": "not_applicable", "country": "USA", "topics": ["prices"]},
    }
    assert table["derived"] == [{
        "key": "fx_price_yoy", "freq": "monthly", "name": "Fixture price index, change from a year earlier",
        "unit": "percent change from a year earlier", "seasonal_adjustment": "nsa",
        "recipe": {"op": "pct_change", "inputs": ["fx_price"], "order": "aggregate_then_compute",
                   "params": {"lag": 12}},
        "catalog": {"measure_kind": "rate", "unit_kind": "percent", "segment": "economy_jobs",
                    "continuity": "discrete", "agg": "none", "price_basis": "not_applicable", "country": "USA"},
    }]


def test_the_loaders_of_the_vintage_store_read_a_catalog_directory(tmp_path):
    directory = write(tmp_path / "series", stored(status="active", source=BOUND),
                      derived(status="active"), stored("fx_draft"))
    assert [e["key"] for e in load_series(directory)] == ["fx_price"]
    assert [e["key"] for e in load_derived(directory)] == ["fx_price_yoy"]


def test_a_replay_through_the_catalog_writes_the_store_a_series_table_writes(tmp_path, register):
    """The takeover changes where the table comes from and nothing a store holds: the vintage
    fixture replayed through a catalog directory, with a metadata version taking effect between
    its fetches, is byte for byte the store its own series table gives."""
    from atlas.vintage.cli import main as replay_main

    from .test_vintage_replay import SERIES, capture, vintage_files

    table = json.loads(SERIES.read_text())
    directory = tmp_path / "catalog"
    for entry in table["series"]:
        first = entry["metadata"][0]
        later = {**first, "from": "2026-03-20T00:00:00Z", "name": first["name"] + " (renamed)"}
        entry["metadata"] = [first, later]
        block = entry["catalog"]
        write(directory, {
            "key": entry["key"], "name": later["name"], "unit": later["unit"],
            "unit_kind": block.get("unit_kind", "other"), "measure_kind": block["measure_kind"],
            "freq": entry["freq"], "continuity": block["continuity"], "agg": block.get("agg", "none"),
            "seasonal_adjustment": later.get("seasonal_adjustment", "not_applicable"),
            "price_basis": "not_applicable", "country": "USA", "segment": block["segment"],
            "refresh": "monthly", "status": "active",
            "earlier_metadata": [first], "metadata_from": later["from"],
            "source": {"origin": {"producer": "x", "dataset": entry["dataset"],
                                  "origin_id": entry["origin_id"], "url": entry.get("url")},
                       "channel": {"via": "direct", "endpoint": entry["endpoint"]}},
        })
        if "seasonal_adjustment" not in later:
            pytest.fail("the fixture declares an adjustment for every Series")
    versioned = tmp_path / "series.json"
    versioned.write_text(json.dumps(table))

    captured = tmp_path / "captured"
    capture(captured, register, "1-initial", "2-revision", "3-withdrawal")
    stores = []
    for name, series in (("by-table", versioned), ("by-catalog", directory)):
        store = shutil.copytree(captured, tmp_path / name)
        assert replay_main(["--store", str(store), "--register", str(register), "--series", str(series)]) == 0
        stores.append(vintage_files(store))
    assert stores[0] and stores[0] == stores[1]
    names = {json.loads(line)["metadata"]["name"]
             for line in stores[1]["metalog/fx_price.ndjson"].decode().splitlines()}
    assert names == {"Fixture price index", "Fixture price index (renamed)"}
