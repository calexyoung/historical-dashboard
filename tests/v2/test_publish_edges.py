"""The release writer at its edges (PLAN M9; ADR 0023): states of the store a Release cannot
show as they are, what recovery records, and that nothing stops a withdrawal half way.

Stores here are written through ``VintageStore.record`` with invented values of the fixture's
made-up Origin, so each test can say exactly what the store holds."""
from __future__ import annotations

import errno
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from atlas.capture import store as S
from atlas.capture.cli import main as capture_main
from atlas.legacy import LegacyRefused, legacy_release
from atlas.publish import pin, release, withdraw
from atlas.publish import root as R
from atlas.vintage.store import CaptureRef, SeriesState, VintageStore

from .release_helpers import (
    NOW,
    ORIGIN,
    SERIES,
    THREE,
    all_bytes,
    build_store,
    current,
    read_json,
    write_register,
)
from .test_publish_failures import JOBS, killed_run

HOUR = timedelta(hours=1)
YEAR = ("2026-01-01", "2026-12-31")


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


def metadata(unit="index, 2024-01 = 100", channel="fixture") -> dict:
    return {"name": "Fixture price index", "unit": unit, "seasonal_adjustment": "nsa",
            "source": {"origin": {"producer": ORIGIN, "dataset": "fixture prices",
                                  "origin_id": "FXPRICE0001", "url": None},
                       "channel": {"via": channel, "adapter": "bls", "endpoint": "fx-bls-shape"}},
            "rights": None}


def record(store: Path, number: int, observations, *, scope=YEAR, meta=None, channel="fixture") -> None:
    when = datetime(2026, 3, 10, 13, 30, tzinfo=UTC) + timedelta(days=30 * number)
    state = SeriesState("fx_price", "monthly", True, scope,
                        [{"period": p, "value": v, "status": s} for p, v, s in observations],
                        meta or metadata(channel=channel))
    VintageStore(store).record(state, CaptureRef(f"run-{number}/fx-bls-shape", when, channel,
                                                 "fx-bls-shape", real_bytes=False))


def publish(tmp_path, register, store, now=NOW, **more):
    return release(profile="public", root=tmp_path / "public", store=store, register=register,
                   series=SERIES, now=now, **more)


def manifest_of(tmp_path, result) -> dict:
    return read_json(tmp_path / "public" / "releases" / result.release_id / "manifest.json")


# --- what the store holds --------------------------------------------------------------------------


def test_a_value_with_more_digits_than_a_double_is_published_as_the_nearest_double_with_a_warning(
        tmp_path, register):
    store = tmp_path / "store"
    record(store, 0, [("2026-01", "100.000", "final"), ("2026-02", "100.12345678901234567", "final")])

    result = publish(tmp_path, register, store)

    assert result.outcome == "promoted", result.lines
    manifest = manifest_of(tmp_path, result)
    warning = next(c for c in manifest["checks"]["report"] if c["check"] == "values as doubles")
    assert warning["outcome"] == "warn" and "fx_price" in warning["detail"]
    assert manifest["checks"]["passed"] is True
    price = read_json(tmp_path / "public" / "releases" / result.release_id / "series" / "fx_price.json")
    assert price["observations"][1]["value"] == 100.12345678901235
    assert any(line.startswith("WARNING values as doubles") for line in result.lines)


def test_a_series_held_under_two_definitions_is_withheld_not_published_under_the_newer_one(
        tmp_path, register):
    """The unit changed, and the Capture that brought the change asked only about March on:
    January and February are still held under the old unit (ADR 0022 decision 7)."""
    store = tmp_path / "store"
    record(store, 0, [("2026-01", "100.000", "final"), ("2026-02", "100.400", "final")])
    record(store, 1, [("2026-03", "50.450", "final")], scope=("2026-03-01", "2026-12-31"),
           meta=metadata(unit="index, 2026-01 = 50"))
    both = publish(tmp_path, register, store)
    assert both.outcome == "refused" and "more than one definition or Channel" in "\n".join(both.lines)

    # Once a Capture has asked about every Period again, there is one definition and it is published.
    record(store, 2, [("2026-01", "50.000", "final"), ("2026-02", "50.200", "final"),
                      ("2026-03", "50.450", "final")], meta=metadata(unit="index, 2026-01 = 50"))
    whole = publish(tmp_path, register, store)
    assert whole.outcome == "promoted" and sorted(manifest_of(tmp_path, whole)["series"]) == ["fx_price"]


def test_rights_are_asked_about_the_channel_every_row_came_through(tmp_path, register):
    """Older Periods arrived through an intermediary; a later Capture, direct, asked only
    about the newest. The Series is not published as if all of it were direct."""
    store = tmp_path / "store"
    record(store, 0, [("2026-01", "100.000", "final")], channel="fixture_vendor",
           meta=metadata(channel="fixture_vendor"))
    record(store, 1, [("2026-02", "100.400", "final")], scope=("2026-02-01", "2026-12-31"))
    result = publish(tmp_path, register, store)
    assert result.outcome == "refused" and current(tmp_path / "public") is None
    assert b"100.4" not in all_bytes(tmp_path / "public")


def test_an_observation_for_a_period_that_has_not_begun_is_refused_unless_it_is_projected(
        tmp_path, register):
    store = tmp_path / "store"
    record(store, 0, [("2026-04", "101.300", "final"), ("2026-05", "101.500", "final"),
                      ("2026-06", "101.900", "final")])     # NOW is 13 May 2026
    result = publish(tmp_path, register, store)
    assert result.outcome == "rejected"
    assert [c["check"] for c in result.failed_checks] == ["no observation after the release"]
    assert "fx_price (2026-06)" in result.failed_checks[0]["detail"]

    record(store, 1, [("2026-04", "101.300", "final"), ("2026-05", "101.500", "final"),
                      ("2026-06", "101.900", "projected")])
    assert publish(tmp_path, register, store).outcome == "promoted"


def test_a_series_the_source_no_longer_lists_at_all_is_withheld(tmp_path, register):
    store = build_store(tmp_path / "store", register)
    record(store, 6, [])                                          # a complete answer with no Period
    result = publish(tmp_path, register, store)
    assert result.outcome == "promoted"
    manifest = manifest_of(tmp_path, result)
    assert manifest["withheld"] == [{"key": "fx_price", "reason": "its source lists no Observation for it now"}]
    assert sorted(manifest["series"]) == ["fx_jobs"]


def test_a_capture_that_has_not_been_replayed_makes_the_source_stale_not_ok(tmp_path, register):
    store = build_store(tmp_path / "store", register, "1-initial", "2-revision")
    assert capture_main(["--store", str(store), "--register", str(register),
                         "--replay", str(THREE / "3-withdrawal")]) == 0      # captured, not replayed
    result = publish(tmp_path, register, store)
    (source,) = manifest_of(tmp_path, result)["sources"]
    assert source["outcome"] == "stale" and "is not recorded yet" in source["detail"]
    assert source["fetched"] == "2026-04-10T12:30:01Z"


def test_a_reuse_judges_staleness_against_its_own_date(tmp_path, register):
    store = build_store(tmp_path / "store", register)
    first = publish(tmp_path, register, store)
    assert manifest_of(tmp_path, first)["sources"][0]["outcome"] == "ok"

    later = publish(tmp_path, register, store, now=NOW + timedelta(days=200), reuse_data=True)

    assert later.outcome == "promoted", later.lines
    (source,) = manifest_of(tmp_path, later)["sources"]
    assert source["outcome"] == "stale" and "fx_price" in source["detail"]
    assert source["fetched"] == "2026-05-12T12:30:01Z"          # carried over: a reuse fetches nothing


# --- recovery --------------------------------------------------------------------------------------


def test_a_promotion_cut_off_before_its_record_gets_its_journal_line_from_the_next_run(
        tmp_path, register):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    publish(tmp_path, register, store)
    assert killed_run(root, register, store, NOW + HOUR, "run._Run.finish = die") == 9
    second = current(root)

    publish(tmp_path, register, store, now=NOW + 2 * HOUR)

    lines = [r for r in S.read_release_runs(store) if r.get("release_id") == second]
    assert [(r["event"], r["outcome"], r.get("recovered")) for r in lines] == [("finished", "promoted", True)]
    assert sorted(lines[0]["published"]) == ["fx_jobs", "fx_price"] and all(lines[0]["published"].values())


def test_a_release_a_killed_run_left_unnamed_cannot_be_pinned_into_staying(tmp_path, register):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    first = publish(tmp_path, register, store)
    assert killed_run(root, register, store, NOW + HOUR, "atlas.staging._write_current = die") == 9
    (orphan,) = [i for i in R.release_ids(root) if i != first.release_id]

    result = pin(release_id=orphan, reason="x", profile="public", root=root, store=store, register=register)

    assert result.outcome == "refused" and not (root / "pins.json").exists()
    assert R.release_ids(root) == [first.release_id] and R.release_ids(root, "trash") == [orphan]
    assert read_json(root / "STATUS.json")["outcome"] == "failed"   # the intent is closed


def test_recording_a_run_never_capture_runs_and_the_other_way_round(tmp_path, register):
    store = build_store(tmp_path / "store", register)
    before = S.read_runs(store)
    publish(tmp_path, register, store)
    assert S.read_runs(store) == before                             # capture's readers see no release run
    assert [r["event"] for r in S.read_release_runs(store)] == ["started", "finished"]
    assert S.unfinished_runs(S.read_runs(store)) == []


# --- a withdrawal goes through ---------------------------------------------------------------------


def test_a_journal_that_cannot_be_written_does_not_stop_a_withdrawal(tmp_path, register, monkeypatch):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    first = publish(tmp_path, register, store)

    def full(path, record):
        raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC), str(path))

    monkeypatch.setattr(S, "append_line", full)
    result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=root, store=store,
                      register=register, now=NOW + HOUR)

    assert result.exit_code == 1                                   # it says the record is missing
    assert current(root) not in (None, first.release_id)
    assert R.release_ids(root) == [current(root)]
    assert (store / "retired" / first.release_id).is_dir()
    assert not any(value in all_bytes(root) for value in JOBS)


def test_a_disk_that_fills_before_the_withdrawal_is_written_down_changes_nothing_and_says_so(
        tmp_path, register, monkeypatch):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    first = publish(tmp_path, register, store)

    def full(path, document):
        raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC), str(path))

    monkeypatch.setattr(R, "replace_json", full)
    result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=root, store=store,
                      register=register, now=NOW + HOUR)
    assert result.outcome == "failed" and result.exit_code == 1
    assert current(root) == first.release_id


# --- the legacy converter keeps to the root's rules ------------------------------------------------


def test_the_legacy_converter_does_not_write_into_a_public_root_or_bring_back_a_withdrawn_series(
        tmp_path, register, monkeypatch):
    for name in ("PUBLIC", "LOCAL", "STORE"):
        monkeypatch.setenv(f"ATLAS_{name}", str(tmp_path / f"home-{name.lower()}"))
    store = build_store(tmp_path / "store", register)
    publish(tmp_path, register, store)
    before = all_bytes(tmp_path / "public")
    with pytest.raises(LegacyRefused, match="public-profile root"):
        legacy_release(out=tmp_path / "public", now=NOW)
    assert all_bytes(tmp_path / "public") == before

    local = tmp_path / "local"
    promoted = legacy_release(out=local, now=NOW)
    R.replace_json(local / "withdrawn.json", {"format": 1, "series": {"cpi": {
        "reason": "wrong", "withdrawn_at": "2026-05-13T18:00:00Z", "retired": []}}})
    with pytest.raises(LegacyRefused, match="cpi was withdrawn"):
        legacy_release(out=local, now=NOW + HOUR)
    assert current(local) == promoted.name


def test_a_release_that_cannot_be_read_does_not_stop_a_withdrawal(tmp_path, register):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    first = publish(tmp_path, register, store)
    damaged = root / "releases" / first.release_id / "series" / "fx_jobs.json"
    damaged.chmod(0o000)
    try:
        result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=root, store=store,
                          register=register, now=NOW + HOUR)
    finally:
        if damaged.exists():
            damaged.chmod(0o644)

    # No replacement could be built on a release that cannot be read: fail closed.
    assert result.outcome == "withdrawn" and result.exit_code == 1, result.lines
    assert current(root) is None and R.release_ids(root) == []
    assert not any(value in all_bytes(root) for value in JOBS)


def test_recovery_closes_a_cut_off_promotion_only_after_its_journal_line_is_written(
        tmp_path, register, monkeypatch):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    publish(tmp_path, register, store)
    assert killed_run(root, register, store, NOW + HOUR, "run._Run.finish = die") == 9
    second = current(root)

    def full(path, record):
        raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC), str(path))

    monkeypatch.setattr(S, "append_line", full)
    assert publish(tmp_path, register, store, now=NOW + 2 * HOUR).outcome == "failed"
    assert read_json(root / "STATUS.json")["outcome"] == "promoting"      # still owed its line
    monkeypatch.undo()

    publish(tmp_path, register, store, now=NOW + 3 * HOUR)
    assert [r.get("recovered") for r in S.read_release_runs(store) if r.get("release_id") == second] == [True]


def test_a_withdrawal_judges_the_sources_freshness_over_the_series_that_are_left(tmp_path, register):
    """On 15 July the jobs Series (ends March, three months allowed) is stale and the price
    Series (ends April) is not."""
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    july = datetime(2026, 7, 15, 15, 7, 11, tzinfo=UTC)
    first = publish(tmp_path, register, store, now=july)
    (source,) = manifest_of(tmp_path, first)["sources"]
    assert source["outcome"] == "stale" and "fx_jobs" in source["detail"] and "fx_price" not in source["detail"]

    # A reuse in between says the same thing once, in the same words.
    reused = publish(tmp_path, register, store, now=july + HOUR, reuse_data=True)
    assert manifest_of(tmp_path, reused)["sources"] == [source]

    result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=root, store=store,
                      register=register, now=july + 2 * HOUR)

    (source,) = manifest_of(tmp_path, result)["sources"]
    assert source == {"producer": ORIGIN, "via": "fixture", "fetched": "2026-05-12T12:30:01Z", "outcome": "ok"}


def test_a_reuse_keeps_saying_that_a_capture_was_never_replayed(tmp_path, register):
    store = build_store(tmp_path / "store", register, "1-initial", "2-revision")
    assert capture_main(["--store", str(store), "--register", str(register),
                         "--replay", str(THREE / "3-withdrawal")]) == 0
    publish(tmp_path, register, store)
    again = publish(tmp_path, register, store, now=NOW + HOUR, reuse_data=True)
    (source,) = manifest_of(tmp_path, again)["sources"]
    assert source["outcome"] == "stale" and "is not recorded yet" in source["detail"]


def test_a_damaged_manifest_left_by_a_killed_run_does_not_stop_a_withdrawal(tmp_path, register):
    store = build_store(tmp_path / "store", register)
    root = tmp_path / "public"
    first = publish(tmp_path, register, store)
    assert killed_run(root, register, store, NOW + HOUR, "run._Run.finish = die") == 9
    second = current(root)
    (root / "releases" / second / "manifest.json").write_text("{ not JSON")

    result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=root, store=store,
                      register=register, now=NOW + 2 * HOUR)

    assert result.outcome == "withdrawn" and result.exit_code == 1, result.lines
    assert current(root) is None and R.release_ids(root) == []
    assert sorted(p.name for p in (store / "retired").iterdir()) == [first.release_id, second]
    assert not any(value in all_bytes(root) for value in JOBS)


# --- a Release written before the contract said ml_use (ADR 0041) ----------------------------------


def test_a_reuse_of_a_release_from_before_ml_use_states_it_from_todays_register(tmp_path, register):
    import json

    store = build_store(tmp_path / "store", register)
    first = publish(tmp_path, register, store)
    # Make the current Release what contract 0.7.0 wrote: no ml_use anywhere in it.
    directory = tmp_path / "public" / "releases" / first.release_id
    for path in directory.rglob("*"):
        os.chmod(path, 0o755 if path.is_dir() else 0o644)
    manifest, catalog = read_json(directory / "manifest.json"), read_json(directory / "catalog.json")
    manifest["schema_version"] = "0.7.0"
    for entry in catalog["series"]:
        del entry["rights"]["ml_use"]
    for name, document in (("manifest.json", manifest), ("catalog.json", catalog)):
        (directory / name).write_text(json.dumps(document))
    for name in [p.name for p in (directory / "downloads").iterdir()]:
        (directory / "downloads" / name).unlink()   # 0.7.0's bulk tables had no ml_use column
    (directory / "downloads").rmdir()

    later = publish(tmp_path, register, store, now=NOW + HOUR, reuse_data=True)

    assert later.outcome == "promoted", later.lines
    assert manifest_of(tmp_path, later)["schema_version"] == "0.8.0"
    reused = tmp_path / "public" / "releases" / later.release_id
    assert all(entry["rights"]["ml_use"] is True for entry in read_json(reused / "catalog.json")["series"])
    assert all(r["ml_use"] is True for r in read_json(reused / "downloads" / "datapackage.json")["resources"])
