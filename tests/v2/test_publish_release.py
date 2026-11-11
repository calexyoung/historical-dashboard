"""``atlas release`` (PLAN M9, 4.3, 4.4, 6.1): a Release written from the vintage store.

The store is M8's three-fetch fixture: invented values of a made-up Origin, released under a
register written for the test."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from atlas.publish import release
from atlas.release import validate_release

from .release_helpers import (
    NOW, ORIGIN, SERIES, all_bytes, build_store, current, fixture_table, read_json, write_register,
)


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


def publish(tmp_path, register, store, **more):
    options = {"profile": "public", "root": tmp_path / "public", "store": store,
               "register": register, "series": SERIES, "now": NOW, **more}
    return release(**options)


def test_a_public_release_from_the_fixture_store_validates_and_is_current(tmp_path, register, store):
    result = publish(tmp_path, register, store)

    assert result.outcome == "promoted" and result.exit_code == 0, result.lines
    root = tmp_path / "public"
    assert current(root) == result.release_id
    directory = root / "releases" / result.release_id
    assert validate_release(directory) == []
    manifest = read_json(directory / "manifest.json")
    assert manifest["profile"] == "public"
    assert manifest["created"] == "2026-05-13T15:07:11Z"
    assert manifest["rights_register"]["version"] == "fixture-vintage-1"
    assert manifest["rights_register"]["signed"] is True
    assert manifest["withheld"] == []
    assert sorted(manifest["series"]) == ["fx_jobs", "fx_price"]
    assert manifest["checks"]["passed"] is True


def test_a_series_file_is_the_latest_vintage_at_native_frequency_with_gaps_explicit(
        tmp_path, register, store):
    result = publish(tmp_path, register, store)
    directory = tmp_path / "public" / "releases" / result.release_id

    # Written out by hand from the three bodies in fixtures/vintage/three-fetch: the third
    # fetch no longer lists February for the price Series, and revised January's jobs.
    price = read_json(directory / "series" / "fx_price.json")
    assert [(o["period"], o["value"], o["status"]) for o in price["observations"]] == [
        ("2026-01", 100.0, "final"), ("2026-02", None, "missing"),
        ("2026-03", 100.9, "final"), ("2026-04", 101.3, "final")]
    assert (price["freq"], price["representation"]) == ("monthly", "native")
    assert (price["period_start"], price["period_end"]) == ("2026-01-01", "2026-04-30")
    jobs = read_json(directory / "series" / "fx_jobs.json")
    assert [(o["period"], o["value"], o["status"]) for o in jobs["observations"]] == [
        ("2026-01", 150010, "final"), ("2026-02", 150120, "preliminary"),
        ("2026-03", 150300, "preliminary")]


def test_the_catalog_says_where_each_series_came_from_and_under_what_rights(tmp_path, register, store):
    result = publish(tmp_path, register, store)
    directory = tmp_path / "public" / "releases" / result.release_id

    entries = {e["key"]: e for e in read_json(directory / "catalog.json")["series"]}
    jobs = entries["fx_jobs"]
    assert jobs["name"] == "Fixture jobs" and jobs["unit"] == "thousands of persons"
    assert jobs["seasonal_adjustment"] == "sa" and jobs["measure_kind"] == "stock"
    assert jobs["source"]["origin"] == {"producer": ORIGIN, "dataset": "fixture jobs",
                                        "origin_id": "FXJOBS00001", "url": None}
    assert jobs["source"]["channel"]["via"] == "fixture"
    assert jobs["rights"]["status"] == "public_domain"
    assert jobs["rights"]["attribution"] == "Synthetic test data, Macro Atlas project"
    assert jobs["representation"] == "native" and jobs["status"] == "active"
    row = read_json(directory / "manifest.json")["series"]["fx_jobs"]
    assert row["kind"] == "stored" and row["channel"] == "fixture" and row["state_hash"]


def test_the_manifest_says_how_fresh_each_source_is(tmp_path, register, store):
    result = publish(tmp_path, register, store)
    manifest = read_json(tmp_path / "public" / "releases" / result.release_id / "manifest.json")
    assert manifest["sources"] == [{"producer": ORIGIN, "via": "fixture",
                                    "fetched": "2026-05-12T12:30:01Z", "outcome": "ok"}]


def test_a_withheld_series_is_named_and_its_values_appear_nowhere_in_the_public_root(
        tmp_path, register, store):
    # The row is signed for one dataset only: the jobs Series has no row at all.
    narrowed = write_register(tmp_path / "narrowed.json", fixture_table(datasets=["fixture prices"]))

    result = publish(tmp_path, narrowed, store)

    assert result.outcome == "promoted", result.lines
    root = tmp_path / "public"
    manifest = read_json(root / "releases" / result.release_id / "manifest.json")
    assert [w["key"] for w in manifest["withheld"]] == ["fx_jobs"]
    assert "is not in the rights register" in manifest["withheld"][0]["reason"]
    assert sorted(manifest["series"]) == ["fx_price"]
    entries = {e["key"] for e in read_json(root / "releases" / result.release_id / "catalog.json")["series"]}
    assert entries == {"fx_jobs", "fx_price"}  # listed by name
    everything = all_bytes(root)
    for seeded in (b"150010", b"150120", b"150300", b"150000"):  # every value the store holds for it
        assert seeded not in everything
    assert b"100.9" in everything  # the grep does find a published value


def test_a_public_release_is_refused_when_nothing_may_be_published(tmp_path, store):
    unsigned = write_register(tmp_path / "unsigned.json", fixture_table(decision=None))

    result = publish(tmp_path, unsigned, store)

    assert result.outcome == "refused" and result.exit_code == 1
    assert "is not signed" in "\n".join(result.lines)
    assert not (tmp_path / "public" / "CURRENT").exists()
    assert not list((tmp_path / "public").glob("releases/*"))


def test_an_untrusted_register_publishes_nothing(tmp_path, store):
    table = fixture_table()
    table["rows"][0]["decision"]["signed_by"] = "the builder"
    result = publish(tmp_path, write_register(tmp_path / "forged.json", table), store)
    assert result.outcome == "refused" and "cannot be trusted" in "\n".join(result.lines)
    assert not (tmp_path / "public" / "CURRENT").exists()


def test_a_value_a_double_cannot_hold_exactly_is_published_with_a_warning(tmp_path, register):
    from atlas.publish.export import number

    assert number("129.250") == (129.25, True)
    assert number("150010") == (150010, True)
    value, exact = number("36123456789012345.67")
    assert exact is False and isinstance(value, float)


def test_the_same_store_released_twice_at_one_instant_is_refused_not_rewritten(tmp_path, register, store):
    first = publish(tmp_path, register, store)
    again = publish(tmp_path, register, store)
    assert again.exit_code == 1 and again.outcome == "failed"
    assert current(tmp_path / "public") == first.release_id
    status = json.loads((tmp_path / "public" / "STATUS.json").read_text())
    assert status["outcome"] == "failed" and status["current"] == first.release_id
