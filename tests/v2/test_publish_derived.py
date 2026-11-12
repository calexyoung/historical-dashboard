"""Derived series in ``atlas release`` (PLAN M11, 4.2, 4.4 step 4; ADR 0002, 0003, 0025): the
series table declares Recipes, the Node step computes them inside the staging area, and a
Derived series is published only when everything it rests on is.

The store is M8's three-fetch fixture (invented values, a made-up Origin). After its third
fetch the price index holds January 100.000, no February, March 100.900 and April 101.300;
jobs hold January 150010, February 150120 and March 150300 (the last two preliminary)."""
from __future__ import annotations

import hashlib
import json
import stat
from datetime import timedelta
from pathlib import Path

import pytest

from atlas.publish import release, withdraw
from atlas.publish.export import build
from atlas.release import validate_release
from atlas.rights import RightsGate
from atlas.vintage.replay import SeriesTableError, load_derived, load_series

from .release_helpers import (
    MAKE,
    NOW,
    all_bytes,
    build_store,
    current,
    fixture_table,
    read_json,
    series_with_recipes,
    write_register,
)

HOUR = timedelta(hours=1)


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


@pytest.fixture
def series(tmp_path) -> Path:
    return series_with_recipes(tmp_path / "series.json")


def publish(tmp_path, register, store, series, **more):
    return release(**{"profile": "public", "root": tmp_path / "public", "store": store,
                      "register": register, "series": series, "now": NOW, **more})


def directory_of(tmp_path, result) -> Path:
    return tmp_path / "public" / "releases" / result.release_id


def recipe(key: str, op: dict, **catalog) -> dict:
    return {"key": key, "freq": "monthly", "name": f"Test recipe {key}", "unit": "percent",
            "recipe": op, "catalog": {"measure_kind": "rate", "segment": "economy_jobs",
                                      "continuity": "discrete", "agg": "none", **catalog}}


def change(key: str, of: str, lag: int = 1) -> dict:
    return recipe(key, {"op": "pct_change", "inputs": [of], "order": "aggregate_then_compute",
                        "params": {"lag": lag}})


# --- a release with Derived series -------------------------------------------------------------


def test_a_release_holds_the_derived_series_the_engine_computed(tmp_path, register, store, series):
    result = publish(tmp_path, register, store, series)

    assert result.outcome == "promoted" and result.exit_code == 0, result.lines
    directory = directory_of(tmp_path, result)
    assert validate_release(directory) == []
    manifest = read_json(directory / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_jobs", "fx_jobs_per_price", "fx_price", "fx_price_change"]
    assert manifest["semantics_version"] == "0.6.0"
    assert manifest["checks"]["passed"] is True
    assert {"check": "engine: derived series", "outcome": "pass"} in manifest["checks"]["report"]

    # April on March: 101.300 / 100.900. February is gone, so March has nothing to compare with.
    change_file = read_json(directory / "derived" / "fx_price_change.json")
    assert [o["period"] for o in change_file["observations"]] == ["2026-04"]
    assert change_file["observations"][0]["value"] == pytest.approx((101.3 / 100.9 - 1) * 100, abs=1e-12)
    assert change_file["observations"][0]["status"] == "final"
    # Jobs per index point: 150010 / 100; no February price; 150300 / 100.9, preliminary.
    ratio = read_json(directory / "derived" / "fx_jobs_per_price.json")
    assert [(o["period"], o["status"]) for o in ratio["observations"]] == [
        ("2026-01", "final"), ("2026-02", "missing"), ("2026-03", "preliminary")]
    assert ratio["observations"][0]["value"] == pytest.approx(1500.1, abs=1e-9)
    assert ratio["observations"][2]["value"] == pytest.approx(150300 / 100.9, abs=1e-9)

    row = manifest["series"]["fx_price_change"]
    assert row == {"kind": "derived", "channel": "computed", "rights_status": "public_domain",
                   "representation": "native",
                   "sha256": hashlib.sha256((directory / "derived" / "fx_price_change.json").read_bytes()).hexdigest()}
    assert not (directory / "vintages" / "fx_price_change.json").exists()


def test_the_catalog_says_what_a_derived_series_is_computed_from_and_under_what_rights(
        tmp_path, register, store, series):
    result = publish(tmp_path, register, store, series)

    catalog = {e["key"]: e for e in read_json(directory_of(tmp_path, result) / "catalog.json")["series"]}
    entry = catalog["fx_jobs_per_price"]
    assert entry["recipe"] == {"op": "ratio", "inputs": ["fx_jobs", "fx_price"], "order": "aggregate_then_compute"}
    assert entry["name"] == "Fixture jobs per point of the fixture price index"
    assert entry["unit"] == "thousands of persons per index point"
    assert entry["representation"] == "native" and entry["freq"] == "monthly"
    # The Origin is that of the first Series it rests on; the Channel says Macro Atlas computed it.
    assert entry["source"]["origin"] == catalog["fx_jobs"]["source"]["origin"]
    assert entry["source"]["channel"] == {"via": "computed", "adapter": "atlas-core"}
    assert entry["rights"] == catalog["fx_jobs"]["rights"]
    assert entry["allowed_transforms"] == ["lin", "chg", "ch1", "pch", "pc1", "pca", "log", "rebase", "z", "drawdown"]
    assert "seasonal_adjustment" not in entry


def test_a_derived_series_carries_the_most_restrictive_rights_of_what_it_rests_on(tmp_path, store, series):
    table = MAKE.register()
    prices = table["rows"][0]
    jobs = json.loads(json.dumps(prices))
    prices["datasets"] = ["fixture prices"]
    jobs.update(id="fx-jobs", name="Vintage fixture, jobs", datasets=["fixture jobs"], licence_class="citation_required",
                attribution="Cite the made-up jobs office", capture=[])
    table["rows"].append(jobs)
    register = write_register(tmp_path / "two-rows.json", table)

    result = publish(tmp_path, register, store, series)

    assert result.outcome == "promoted", result.lines
    directory = directory_of(tmp_path, result)
    catalog = {e["key"]: e for e in read_json(directory / "catalog.json")["series"]}
    assert catalog["fx_price_change"]["rights"]["status"] == "public_domain"
    rights = catalog["fx_jobs_per_price"]["rights"]
    assert rights["status"] == "citation_required"
    assert rights["attribution"] == "Cite the made-up jobs office; Synthetic test data, Macro Atlas project"
    assert rights["owner"] == "Vintage fixture, jobs; Vintage fixture"
    assert read_json(directory / "manifest.json")["series"]["fx_jobs_per_price"]["rights_status"] == "citation_required"


def test_a_derived_series_is_withheld_when_one_of_its_inputs_is_and_its_values_are_nowhere(tmp_path, store, series):
    """Rights intersection: the register covers prices only, so jobs and the ratio stay out."""
    narrowed = write_register(tmp_path / "prices-only.json", fixture_table(datasets=["fixture prices"]))

    result = publish(tmp_path, narrowed, store, series)

    assert result.outcome == "promoted", result.lines
    directory = directory_of(tmp_path, result)
    assert validate_release(directory) == []
    manifest = read_json(directory / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_price", "fx_price_change"]
    withheld = {row["key"]: row["reason"] for row in manifest["withheld"]}
    assert sorted(withheld) == ["fx_jobs", "fx_jobs_per_price"]
    assert "fx_jobs" in withheld["fx_jobs_per_price"] and "withheld" in withheld["fx_jobs_per_price"]
    everything = all_bytes(tmp_path / "public")
    for value in (b"150010", b"150300", b"1500.1", b"1489.5"):
        assert value not in everything
    assert b"fx_jobs_per_price" in everything                       # by name, in the catalog


def test_an_unsigned_row_publishes_no_derived_series_either(tmp_path, store, series):
    unsigned = write_register(tmp_path / "unsigned.json", fixture_table(decision=None))
    result = publish(tmp_path, unsigned, store, series)
    assert result.outcome == "refused" and current(tmp_path / "public") is None
    assert not (tmp_path / "public" / "releases").exists() or not list((tmp_path / "public" / "releases").iterdir())


def test_a_recipe_that_gives_no_value_is_withheld_with_what_rests_on_it(tmp_path, register, store):
    table = series_with_recipes(tmp_path / "series.json", [
        change("fx_price_yoy", "fx_price", lag=12), change("fx_on_top", "fx_price_yoy"), change("fx_price_change", "fx_price")])

    result = publish(tmp_path, register, store, table)

    assert result.outcome == "promoted", result.lines
    manifest = read_json(directory_of(tmp_path, result) / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_jobs", "fx_price", "fx_price_change"]
    withheld = {row["key"]: row["reason"] for row in manifest["withheld"]}
    assert sorted(withheld) == ["fx_on_top", "fx_price_yoy"]
    assert "no value" in withheld["fx_price_yoy"]
    assert validate_release(directory_of(tmp_path, result)) == []


def test_a_derived_series_whose_input_the_store_does_not_hold_is_left_out(tmp_path, register):
    """Like a stored Series the store does not hold yet: not in the Catalog, nothing said."""
    store = build_store(tmp_path / "store", register)
    table = read_json(series_with_recipes(tmp_path / "all.json"))
    table["series"].append({**table["series"][0], "key": "fx_later", "origin_id": "FXLATER0001"})
    table["derived"].append(change("fx_later_change", "fx_later"))
    path = tmp_path / "series.json"
    path.write_text(json.dumps(table))

    result = publish(tmp_path, register, store, path)

    assert result.outcome == "promoted", result.lines
    catalog = read_json(directory_of(tmp_path, result) / "catalog.json")["series"]
    assert "fx_later_change" not in {e["key"] for e in catalog}


# --- the series table --------------------------------------------------------------------------


def test_a_cyclic_recipe_refuses_the_run_with_the_cycle_named(tmp_path, register, store):
    table = series_with_recipes(tmp_path / "series.json", [
        change("fx_a", "fx_b"), change("fx_b", "fx_c"), change("fx_c", "fx_a")])

    result = publish(tmp_path, register, store, table)

    assert result.outcome == "refused" and result.exit_code == 1
    assert any("fx_a → fx_b → fx_c → fx_a" in line for line in result.lines), result.lines
    assert current(tmp_path / "public") is None


@pytest.mark.parametrize("broken, says", [
    ([change("fx_price", "fx_jobs")], "twice"),
    ([change("fx_x", "fx_nowhere")], "fx_nowhere"),
    ([{**change("fx_x", "fx_price"), "freq": "fortnightly"}], "frequency"),
    ([{k: v for k, v in change("fx_x", "fx_price").items() if k != "unit"}], "unit"),
    ([{**change("fx_x", "fx_price"), "recipe": {"op": "pct_change", "inputs": ["fx_price"]}}], "recipe"),
    ([{**change("fx_x", "fx_price"), "catalog": {"segment": "economy_jobs"}}], "measure_kind"),
    ([{**change("Bad Key", "fx_price")}], "key"),
])
def test_a_derived_entry_the_table_cannot_stand_behind_is_refused(tmp_path, broken, says):
    path = series_with_recipes(tmp_path / "series.json", broken)
    with pytest.raises(SeriesTableError, match=says):
        load_derived(path)


def test_a_table_without_recipes_has_none_and_the_committed_table_declares_cpi_yoy():
    from .release_helpers import SERIES
    assert load_derived(SERIES) == []
    committed = {e["key"]: e for e in load_derived()}
    assert committed["cpi_yoy"]["recipe"] == {"op": "pct_change", "inputs": ["cpi_nsa"],
                                              "order": "aggregate_then_compute", "params": {"lag": 12}}
    assert {"cpi", "cpi_nsa"} <= {e["key"] for e in load_series()}


# --- the Node step can fail, and nothing is promoted when it does ---------------------------------


def fake_node(tmp_path, body: str) -> Path:
    script = tmp_path / "fake-node"
    script.write_text("#!/bin/sh\n" + body)
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


def assert_nothing_promoted(tmp_path, result, says: str):
    assert result.outcome in ("rejected", "failed") and result.exit_code == 1, result.lines
    assert any(says in line for line in result.lines), result.lines
    assert current(tmp_path / "public") is None
    staging = tmp_path / "public" / ".staging"
    assert not staging.exists() or list(staging.iterdir()) == []


def test_without_node_no_release_with_derived_series_is_promoted(tmp_path, register, store, series, monkeypatch):
    monkeypatch.setenv("ATLAS_NODE", str(tmp_path / "no-such-node"))
    assert_nothing_promoted(tmp_path, publish(tmp_path, register, store, series), "Node")


def test_a_release_with_no_recipe_needs_no_node(tmp_path, register, store, monkeypatch):
    from .release_helpers import SERIES
    monkeypatch.setenv("ATLAS_NODE", str(tmp_path / "no-such-node"))
    result = publish(tmp_path, register, store, SERIES)
    assert result.outcome == "promoted", result.lines
    assert read_json(directory_of(tmp_path, result) / "manifest.json")["semantics_version"] == "none"


def test_a_step_that_fails_rejects_the_run(tmp_path, register, store, series, monkeypatch):
    monkeypatch.setenv("ATLAS_NODE", str(fake_node(tmp_path, "echo 'FAILED something is wrong' >&2\nexit 1\n")))
    result = publish(tmp_path, register, store, series)
    assert_nothing_promoted(tmp_path, result, "something is wrong")
    assert result.outcome == "rejected"
    assert any(check["check"] == "engine: derived series" for check in result.failed_checks)


def test_a_step_that_does_not_finish_in_time_rejects_the_run(tmp_path, register, store, series, monkeypatch):
    monkeypatch.setenv("ATLAS_NODE", str(fake_node(tmp_path, "exec sleep 30\n")))
    monkeypatch.setenv("ATLAS_ENGINE_TIMEOUT", "1")
    assert_nothing_promoted(tmp_path, publish(tmp_path, register, store, series), "did not finish")


@pytest.mark.parametrize("body, says", [
    ("exit 0\n", "report"),                                                           # wrote nothing
    ("echo '{' > engine-report.json\nexit 0\n", "report"),                             # not JSON
    ("echo '{\"format\":1,\"semantics_version\":\"9\",\"derived\":{},\"empty\":[],\"checks\":[]}' > engine-report.json\n"
     + "exit 0\n", "fx_"),                                                              # says nothing of what was asked
    ("echo x > stray.txt\nexit 0\n", "stray.txt"),                                     # a file nobody asked for
    ("echo x >> catalog.json\nexit 0\n", "catalog.json"),                              # changed its input
    ("mkdir -p derived && ln -s ../catalog.json derived/fx_price_change.json\nexit 0\n", "link"),
])
def test_what_the_step_leaves_is_checked_before_any_of_it_is_believed(
        tmp_path, register, store, series, monkeypatch, body, says):
    monkeypatch.setenv("ATLAS_NODE", str(fake_node(tmp_path, body)))
    assert_nothing_promoted(tmp_path, publish(tmp_path, register, store, series), says)


def test_a_file_that_is_not_the_one_the_report_hashed_is_refused(tmp_path, register, store, series, monkeypatch):
    real = "node"
    body = (f'{real} "$@" || exit $?\n'
            "printf ' ' >> derived/fx_price_change.json\n")
    monkeypatch.setenv("ATLAS_NODE", str(fake_node(tmp_path, body)))
    assert_nothing_promoted(tmp_path, publish(tmp_path, register, store, series), "fx_price_change")


def test_a_spot_value_that_is_off_rejects_the_run(tmp_path, register, store, series):
    spot = tmp_path / "spot.json"
    spot.write_text(json.dumps({"format": 1, "spots": [
        {"key": "fx_price_change", "period": "2026-04", "value": 5.0, "tolerance": 0.05, "source": "a test"}]}))
    result = publish(tmp_path, register, store, series, spot=spot)
    assert_nothing_promoted(tmp_path, result, "fx_price_change 2026-04")

    spot.write_text(json.dumps({"format": 1, "spots": [
        {"key": "fx_price_change", "period": "2026-04", "value": 0.4, "tolerance": 0.05, "source": "a test"}]}))
    result = publish(tmp_path, register, store, series, spot=spot)
    assert result.outcome == "promoted", result.lines
    checks = read_json(directory_of(tmp_path, result) / "manifest.json")["checks"]["report"]
    assert {"check": "spot value: fx_price_change 2026-04", "outcome": "pass"} in checks


# --- reuse and withdrawal ----------------------------------------------------------------------


def test_a_reuse_keeps_the_derived_files_and_does_not_run_the_step(tmp_path, register, store, series, monkeypatch):
    first = publish(tmp_path, register, store, series)
    monkeypatch.setenv("ATLAS_NODE", str(tmp_path / "no-such-node"))

    second = publish(tmp_path, register, store, series, reuse_data=True, now=NOW + HOUR)

    assert second.outcome == "promoted", second.lines
    one, two = directory_of(tmp_path, first), directory_of(tmp_path, second)
    assert (two / "derived" / "fx_price_change.json").read_bytes() == (one / "derived" / "fx_price_change.json").read_bytes()
    assert read_json(two / "manifest.json")["semantics_version"] == "0.6.0"


def test_withdrawing_an_input_takes_what_is_computed_from_it(tmp_path, register, store, series):
    publish(tmp_path, register, store, series)

    result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=tmp_path / "public",
                      store=store, register=register, now=NOW + HOUR)

    assert result.outcome == "withdrawn", result.lines
    manifest = read_json(tmp_path / "public" / "releases" / current(tmp_path / "public") / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_price", "fx_price_change"]
    assert b"1500.1" not in all_bytes(tmp_path / "public")

    # And a later full run keeps it out: the ratio rests on a withdrawn Series.
    again = publish(tmp_path, register, store, series, now=NOW + 2 * HOUR)
    assert again.outcome == "promoted", again.lines
    manifest = read_json(directory_of(tmp_path, again) / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_price", "fx_price_change"]
    assert sorted(row["key"] for row in manifest["withheld"]) == ["fx_jobs", "fx_jobs_per_price"]


# --- v1's Derived series are not the engine's ------------------------------------------------


def test_on_a_local_build_only_recipes_of_the_series_table_are_handed_to_the_engine(tmp_path, register, store, series):
    """v1's Derived series are carried as v1 computed them (ADR 0016): the engine is asked for
    the table's own recipes and no others. A hand-made legacy Release stands in for v1's."""
    legacy_entry = {
        "key": "v1_yoy", "name": "A v1 series", "unit": "percent", "measure_kind": "rate", "agg": "none",
        "freq": "monthly", "continuity": "discrete", "representation": "legacy_monthly_rounded",
        "segment": "economy_jobs", "status": "active",
        "source": {"origin": {"producer": "Computed by v1", "dataset": "v1", "origin_id": None, "url": None},
                   "channel": {"via": "computed"}},
        "rights": {"owner": "x", "terms_url": None, "status": "unknown", "attribution": None, "reviewed": None},
        "recipe": {"op": "pct_change", "inputs": ["v1_level"], "order": "aggregate_then_compute", "params": {"lag": 12}}}
    level = {**{k: v for k, v in legacy_entry.items() if k != "recipe"}, "key": "v1_level"}
    def file(key: str) -> bytes:
        return json.dumps({"key": key, "freq": "monthly", "representation": "legacy_monthly_rounded",
                           "period_start": "2024-01-01", "period_end": "2024-01-31", "observations": [
                               {"period": "2024-01", "period_start": "2024-01-01", "period_end": "2024-01-31",
                                "value": 1.5, "status": "final"}]}).encode()

    row = {"sha256": "0" * 64, "channel": "computed", "rights_status": "unknown", "representation": "legacy_monthly_rounded"}
    legacy = {
        "catalog.json": json.dumps({"series": [level, legacy_entry]}).encode(),
        "content/annotations.json": b'{"annotations": []}',
        "series/v1_level.json": file("v1_level"), "derived/v1_yoy.json": file("v1_yoy"),
        "manifest.json": json.dumps({"semantics_version": "v1-legacy", "series": {
            "v1_level": {"kind": "stored", **row}, "v1_yoy": {"kind": "derived", **row}}}).encode()}
    table = read_json(register)

    built = build(profile="local", store=store, table=table, gate=RightsGate(table), series=load_series(series),
                  derived=load_derived(series), created=NOW, legacy=legacy)

    assert built.materialise == ["fx_jobs_per_price", "fx_price_change"]
    assert built.files["derived/v1_yoy.json"] == legacy["derived/v1_yoy.json"]
    assert "derived/fx_price_change.json" not in built.files          # the engine has not run yet
