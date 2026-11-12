"""The release writer and vintages (PLAN M10, 4.3; ADR 0024): ``vintages/{key}.json`` is what
the store held for a published Series over time, and it obeys the rights gate like any value.

Stores here hold invented values of the fixture's made-up Origin."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from atlas.publish import release, withdraw
from atlas.publish import root as R
from atlas.release import load_release, validate_release
from atlas.rights import RightsGate

from .release_helpers import (
    NOW,
    all_bytes,
    build_store,
    fixture_table,
    read_json,
    write_register,
)
from .test_publish_edges import metadata, publish, record


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


def directory_of(tmp_path, result) -> Path:
    return tmp_path / "public" / "releases" / result.release_id


def test_a_published_series_carries_what_the_store_held_for_it_and_from_when(tmp_path, register, store):
    result = publish(tmp_path, register, store)
    assert result.outcome == "promoted", result.lines
    directory = directory_of(tmp_path, result)
    assert validate_release(directory) == []

    held = read_json(directory / "vintages" / "fx_price.json")
    assert (held["key"], held["freq"], held["representation"], held["provider_coverage"]) == (
        "fx_price", "monthly", "native", None)
    # The three fetches of fixtures/vintage: initial, revision, withdrawal (docs/method/vintage-store.md).
    assert [(r["period"], r["value"], r["status"], r["deleted"], r["recorded_from"], r["recorded_to"])
            for r in held["rows"]] == [
        ("2026-01", 100, "final", False, "2026-03-10T13:30:01Z", None),
        ("2026-02", 100.4, "final", False, "2026-03-10T13:30:01Z", "2026-05-12T12:30:01Z"),
        ("2026-02", None, None, True, "2026-05-12T12:30:01Z", None),
        ("2026-03", 100.9, "final", False, "2026-04-10T12:30:01Z", None),
        ("2026-04", 101.3, "final", False, "2026-05-12T12:30:01Z", None),
    ]
    assert all((r["provider_from"], r["provider_to"], r["provider_precision"], r["channel"])
               == (None, None, None, "fixture") for r in held["rows"])
    assert [(c["retrieved_at"], c["change"]) for c in held["captures"]] == [
        ("2026-03-10T13:30:01Z", "first"), ("2026-04-10T12:30:01Z", "revision"),
        ("2026-05-12T12:30:01Z", "revision")]
    assert all(c["scope"] == ["2026-01-01", "2026-12-31"] for c in held["captures"])
    (line,) = held["metadata"]
    assert line["recorded_from"] == "2026-03-10T13:30:01Z"
    assert {r["metadata"] for r in held["rows"]} == {line["hash"]}
    assert (line["metadata"]["name"], line["metadata"]["unit"]) == ("Fixture price index", "index, 2024-01 = 100")
    assert line["metadata"]["source"]["channel"]["via"] == "fixture"

    jobs = read_json(directory / "vintages" / "fx_jobs.json")
    assert [c["change"] for c in jobs["captures"]] == ["first", "revision", "none"]  # a confirmation
    assert [(r["value"], r["status"]) for r in jobs["rows"] if r["period"] == "2026-01"] == [
        (150000, "preliminary"), (150010, "final")]


def test_the_manifest_vouches_for_each_vintage_file(tmp_path, register, store):
    directory = directory_of(tmp_path, publish(tmp_path, register, store))
    manifest = read_json(directory / "manifest.json")
    for key in ("fx_price", "fx_jobs"):
        data = (directory / "vintages" / f"{key}.json").read_bytes()
        assert manifest["series"][key]["vintages_sha256"] == hashlib.sha256(data).hexdigest()


def test_a_withheld_series_has_no_vintage_file_and_none_of_its_past_values_is_written(tmp_path, store):
    narrowed = write_register(tmp_path / "narrowed.json", fixture_table(datasets=["fixture prices"]))
    result = publish(tmp_path, narrowed, store)
    assert result.outcome == "promoted", result.lines
    assert sorted(p.name for p in (directory_of(tmp_path, result) / "vintages").iterdir()) == ["fx_price.json"]
    everything = all_bytes(tmp_path / "public")
    assert b"150000" not in everything  # a value fx_jobs held only in the past
    assert b"100.4" in everything  # the grep does find a past value of the published Series


def test_history_that_came_through_a_channel_the_register_does_not_permit_is_left_out(tmp_path, register):
    """January was first held through an intermediary; a later, direct Capture asked about
    everything again. What is current is all direct and is published; the history is not."""
    store = tmp_path / "store"
    record(store, 0, [("2026-01", "99.123", "final")], channel="fixture_vendor",
           meta=metadata(channel="fixture_vendor"))
    record(store, 1, [("2026-01", "100.000", "final"), ("2026-02", "100.400", "final")])
    result = publish(tmp_path, register, store)

    assert result.outcome == "promoted", result.lines
    directory = directory_of(tmp_path, result)
    manifest = read_json(directory / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_price"] and "vintages_sha256" not in manifest["series"]["fx_price"]
    assert not (directory / "vintages" / "fx_price.json").exists()
    (line,) = [c for c in manifest["checks"]["report"] if c["check"] == "vintages"]
    assert line["outcome"] == "warn" and "fx_price" in line["detail"] and "fixture_vendor" in line["detail"]
    assert b"99.123" not in all_bytes(tmp_path / "public")  # the value held through the intermediary
    assert validate_release(directory) == []


def test_only_the_named_fields_of_recorded_metadata_are_published(tmp_path, register):
    """The store keeps whatever metadata it was given. A Release shows a fixed selection, so a
    field nobody expected, in a line of history nobody looks at, is not handed out."""
    store = tmp_path / "store"
    leaky = {**metadata(), "internal_note": "seeded-secret-7f3a"}
    leaky["source"] = {**leaky["source"], "request_headers": {"X-Api-Key": "seeded-secret-7f3a"}}
    record(store, 0, [("2026-01", "100.000", "final")], meta=leaky)
    record(store, 1, [("2026-01", "100.000", "final"), ("2026-02", "100.400", "final")])
    result = publish(tmp_path, register, store)

    assert result.outcome == "promoted", result.lines
    held = read_json(directory_of(tmp_path, result) / "vintages" / "fx_price.json")
    assert len(held["metadata"]) == 2
    assert sorted(held["metadata"][0]["metadata"]) == ["name", "rights", "seasonal_adjustment", "source", "unit"]
    assert sorted(held["metadata"][0]["metadata"]["source"]) == ["channel", "origin"]
    assert b"seeded-secret-7f3a" not in all_bytes(tmp_path / "public")
    assert "seeded-secret-7f3a" not in "\n".join(result.lines)


def test_the_check_over_a_releases_files_reads_the_lineage_of_its_history_too(tmp_path, register, store):
    """What ``atlas doctor --surface production``, rollback, pin and reuse ask: a vintage file
    whose rows came through a Channel today's register does not permit is a problem, whoever
    wrote the file and whatever its manifest says."""
    files = load_release(directory_of(tmp_path, publish(tmp_path, register, store)))
    gate = RightsGate(json.loads(register.read_text()))
    assert R.rights_problems(files, gate) == []

    held = json.loads(files["vintages/fx_price.json"])
    held["metadata"][0]["metadata"]["source"]["channel"]["via"] = "fred"
    for row in held["rows"]:
        row["channel"] = "fred"
    problems = R.rights_problems({**files, "vintages/fx_price.json": json.dumps(held).encode()}, gate)
    assert len(problems) == 1 and problems[0].startswith("fx_price: its history: ")

    unsigned = RightsGate(fixture_table(decision=None))
    assert any("its history" in p for p in R.rights_problems(files, unsigned))


def test_a_reuse_keeps_the_vintage_files_and_a_withdrawal_takes_the_series_history_with_it(
        tmp_path, register, store):
    root = tmp_path / "public"
    first = publish(tmp_path, register, store)
    second = release(profile="public", root=root, store=store, register=register, reuse_data=True,
                     now=NOW.replace(hour=16))
    assert second.outcome == "promoted", second.lines
    old, new = (root / "releases" / r.release_id / "vintages" / "fx_jobs.json" for r in (first, second))
    assert old.stat().st_ino == new.stat().st_ino
    assert validate_release(root / "releases" / second.release_id) == []

    gone = withdraw(key="fx_jobs", reason="the permission was wrong", profile="public", root=root,
                    store=store, register=register, now=NOW.replace(hour=17))
    assert gone.exit_code == 0, gone.lines
    left = root / "releases" / gone.release_id
    assert validate_release(left) == []
    assert sorted(p.name for p in (left / "vintages").iterdir()) == ["fx_price.json"]
    assert b"150000" not in all_bytes(root)  # fx_jobs' first print, held only in its history


def test_a_second_metadata_under_a_hash_already_used_does_not_hide_where_values_came_from(
        tmp_path, register, store):
    """A file that gives one hash to two lines: both lines are lineage, and so is every line a
    version's hash could mean."""
    files = load_release(directory_of(tmp_path, publish(tmp_path, register, store)))
    gate = RightsGate(json.loads(register.read_text()))
    held = json.loads(files["vintages/fx_price.json"])
    forged = json.loads(json.dumps(held["metadata"][0]))
    forged["metadata"]["source"]["origin"]["producer"] = "An Origin with no row"
    held["metadata"] = [forged, *held["metadata"]]
    problems = R.rights_problems({**files, "vintages/fx_price.json": json.dumps(held).encode()}, gate)
    assert len(problems) == 1 and "its history" in problems[0] and "An Origin with no row" in problems[0]


def test_history_that_does_not_say_where_it_came_from_is_left_out_not_a_crash(tmp_path, register):
    """An early line of the metadata history names no dataset. What is current is whole and is
    published; the history cannot be asked about, so it is not written."""
    store = tmp_path / "store"
    nameless = metadata()
    nameless["source"]["origin"]["dataset"] = ""
    record(store, 0, [("2026-01", "99.123", "final")], meta=nameless)
    record(store, 1, [("2026-01", "100.000", "final"), ("2026-02", "100.400", "final")])
    result = publish(tmp_path, register, store)

    assert result.outcome == "promoted", result.lines
    directory = directory_of(tmp_path, result)
    assert not (directory / "vintages").exists()
    (line,) = [c for c in read_json(directory / "manifest.json")["checks"]["report"] if c["check"] == "vintages"]
    assert line["outcome"] == "warn" and "does not name its Origin" in line["detail"]
    assert b"99.123" not in all_bytes(tmp_path / "public")
