"""The publisher's failure cases (PLAN section 9, "Publisher"; M9 acceptance): each one leaves
CURRENT naming the last good Release, says what happened, and the next run puts things right."""
from __future__ import annotations

import errno
import json
import os
import subprocess
import sys
import textwrap
from datetime import timedelta
from pathlib import Path

import pytest

from atlas.capture import store as S
from atlas.capture.adapters import BlsAdapter
from atlas.capture.run import run_capture
from atlas.publish import pin, release, rollback, unpin, withdraw
from atlas.publish import root as R
from atlas.release import validate_release
from atlas.vintage.cli import main as replay_main

from .capture_helpers import Scripted
from .release_helpers import (
    MAKE,
    NOW,
    ROOT,
    SERIES,
    all_bytes,
    build_store,
    current,
    fixture_table,
    read_json,
    write_register,
)

HOUR = timedelta(hours=1)
DAY = timedelta(days=1)


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


@pytest.fixture
def root(tmp_path) -> Path:
    return tmp_path / "public"


def publish(root, register, store, now=NOW, **more):
    return release(profile="public", root=root, store=store, register=register, series=SERIES,
                   now=now, **more)


def others(root, register, store):
    return {"profile": "public", "root": root, "store": store, "register": register}


def status(root):
    return read_json(root / "STATUS.json")


def runs(store):
    return S.read_release_runs(store)


# --- overlapping runs ----------------------------------------------------------------------------


def test_a_second_run_on_the_same_root_exits_at_once_and_changes_nothing(root, register, store):
    first = publish(root, register, store)
    with R.locked(root):
        second = publish(root, register, store, now=NOW + HOUR)
    assert second.outcome == "refused" and second.exit_code == 1
    assert "another run holds" in second.lines[0]
    assert current(root) == first.release_id and R.release_ids(root) == [first.release_id]


def test_a_run_waits_for_nobody_when_capture_or_replay_holds_the_store(root, register, store):
    with S.locked(store):
        result = publish(root, register, store)
    assert result.outcome == "refused" and "another run holds the store" in result.lines[0]
    assert current(root) is None


# --- a kill ---------------------------------------------------------------------------------------


def killed_run(root, register, store, now, patch: str) -> int:
    """A release run in another process that dies, with no cleanup, at the patched point."""
    script = textwrap.dedent(f"""
        import os, sys
        from datetime import datetime
        from pathlib import Path
        sys.path.insert(0, {str(ROOT)!r})
        import atlas.staging, atlas.publish.run as run
        die = lambda *a, **k: os._exit(9)
        {patch}
        run.release(profile="public", root=Path({str(root)!r}), store=Path({str(store)!r}),
                    register=Path({str(register)!r}), series=Path({str(SERIES)!r}),
                    now=datetime.fromisoformat({now.isoformat()!r}))
    """)
    return subprocess.run([sys.executable, "-c", script], check=False, capture_output=True).returncode


def test_a_kill_between_staging_and_promotion_leaves_current_alone_and_the_next_run_cleans_up(
        root, register, store):
    first = publish(root, register, store)

    assert killed_run(root, register, store, NOW + HOUR, "run.promote = die") == 9

    assert current(root) == first.release_id
    assert [p.name for p in (root / ".staging").iterdir()]  # what the killed run left
    assert status(root)["outcome"] == "promoting"
    assert validate_release(root / "releases" / first.release_id) == []

    third = publish(root, register, store, now=NOW + 2 * HOUR)
    assert third.outcome == "promoted" and current(root) == third.release_id
    assert not (root / ".staging").exists()
    assert any("did not finish" in line for line in third.lines)
    assert R.release_ids(root) == [first.release_id, third.release_id]


def test_a_kill_during_promotion_leaves_a_release_nothing_names_and_the_next_run_trashes_it(
        root, register, store):
    first = publish(root, register, store)

    # The directory has been renamed into releases/; CURRENT has not been replaced.
    assert killed_run(root, register, store, NOW + HOUR, "atlas.staging._write_current = die") == 9

    assert current(root) == first.release_id
    orphan = [i for i in R.release_ids(root) if i != first.release_id]
    assert len(orphan) == 1

    third = publish(root, register, store, now=NOW + 2 * HOUR)
    assert third.outcome == "promoted"
    assert R.release_ids(root) == [first.release_id, third.release_id]
    assert R.release_ids(root, "trash") == orphan
    assert any("without naming it in CURRENT" in line for line in third.lines)


def test_a_kill_after_current_was_replaced_is_a_promotion_and_the_next_run_records_it(
        root, register, store):
    first = publish(root, register, store)
    assert killed_run(root, register, store, NOW + HOUR, "run._Run.finish = die") == 9

    second = current(root)
    assert second != first.release_id and status(root)["outcome"] == "promoting"

    third = publish(root, register, store, now=NOW + 2 * HOUR)
    assert any(f"it had promoted {second}" in line for line in third.lines)
    assert R.release_ids(root) == [first.release_id, second, third.release_id]
    assert R.release_ids(root, "trash") == []


def test_an_interrupt_in_this_process_leaves_current_alone(root, register, store, monkeypatch):
    first = publish(root, register, store)

    def interrupt(*args, **kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr("atlas.publish.run.promote", interrupt)
    with pytest.raises(KeyboardInterrupt):
        publish(root, register, store, now=NOW + HOUR)
    monkeypatch.undo()
    assert current(root) == first.release_id
    assert publish(root, register, store, now=NOW + 2 * HOUR).outcome == "promoted"  # the locks went


# --- disk full -------------------------------------------------------------------------------------


def test_a_full_disk_while_staging_fails_the_run_and_leaves_current_alone(root, register, store):
    first = publish(root, register, store)
    written = []

    def full(path, data):
        if written:
            raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC), str(path))
        written.append(path)
        path.write_bytes(data)

    result = publish(root, register, store, now=NOW + HOUR, write=full)

    assert result.outcome == "failed" and result.exit_code == 1
    assert "No space left on device" in "\n".join(result.lines)
    assert current(root) == first.release_id
    assert not (root / ".staging").exists() and R.release_ids(root) == [first.release_id]
    assert status(root)["outcome"] == "failed" and status(root)["current"] == first.release_id
    assert "No space left" in status(root)["reason"]


def test_a_full_disk_after_the_commit_point_is_still_a_promotion_and_says_so(
        root, register, store, monkeypatch):
    real = R.write_status

    def full(root, **fields):
        if fields.get("outcome") == "promoted":
            raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC))
        real(root, **fields)

    monkeypatch.setattr(R, "write_status", full)
    result = publish(root, register, store)

    assert result.outcome == "promoted" and result.exit_code == 1
    assert current(root) == result.release_id
    assert any("record could not be written" in line for line in result.lines)


# --- a provider that answers badly ----------------------------------------------------------------


def bad_answer(store, body, start):
    transport = Scripted({BlsAdapter.URL: [(200, body, [["Content-Type", "application/json"]])]}, start=start)
    run_capture(store, MAKE.register(), transport, sleep=lambda seconds: None)


@pytest.mark.parametrize("body", [b"", b"<html><body>Service unavailable</body></html>"],
                         ids=["an empty body", "a page of HTML"])
def test_a_bad_answer_never_reaches_a_release_and_the_source_is_marked_failed(
        root, register, store, body):
    bad_answer(store, body, "2026-05-13T12:30:00")
    replay_main(["--store", str(store), "--register", str(register), "--series", str(SERIES)])

    result = publish(root, register, store)

    assert result.outcome == "promoted", result.lines
    directory = root / "releases" / result.release_id
    price = read_json(directory / "series" / "fx_price.json")
    assert [o["value"] for o in price["observations"]] == [100.0, None, 100.9, 101.3]  # the last good state
    (source,) = read_json(directory / "manifest.json")["sources"]
    assert source["outcome"] == "failed" and "fx-bls-shape" in source["detail"]
    assert source["fetched"] == "2026-05-12T12:30:01Z"  # the last complete Capture, not the bad one


def test_a_provider_that_keeps_serving_old_data_makes_the_release_stale_not_fresh(
        root, register, store):
    # Months later the source still answers, whole, with nothing newer than April.
    transport = Scripted({BlsAdapter.URL: [(200, MAKE.body(MAKE.FETCHES[2][2]),
                                            [["Content-Type", "application/json"]])]},
                         start="2026-11-02T13:30:00")
    run_capture(store, MAKE.register(), transport, sleep=lambda seconds: None)
    assert replay_main(["--store", str(store), "--register", str(register), "--series", str(SERIES)]) == 0

    result = publish(root, register, store, now=NOW + 180 * DAY)

    assert result.outcome == "promoted"
    manifest = read_json(root / "releases" / result.release_id / "manifest.json")
    (source,) = manifest["sources"]
    assert source["outcome"] == "stale" and source["fetched"] == "2026-11-02T13:30:01Z"
    stale = next(c for c in manifest["checks"]["report"] if c["check"] == "staleness")
    assert stale["outcome"] == "warn" and "fx_price" in stale["detail"]
    assert manifest["checks"]["passed"] is True


def test_a_value_outside_the_catalogs_range_rejects_the_release_and_keeps_the_report(
        tmp_path, root, register, store):
    first = publish(root, register, store)
    table = read_json(SERIES)
    table["series"][0]["catalog"]["range"] = [0, 100.5]
    narrow = tmp_path / "series.json"
    narrow.write_text(json.dumps(table))

    result = release(profile="public", root=root, store=store, register=register, series=narrow,
                     now=NOW + HOUR)

    assert result.outcome == "rejected" and result.exit_code == 1
    assert [c["check"] for c in result.failed_checks] == ["values within the catalog's range"]
    assert current(root) == first.release_id and R.release_ids(root) == [first.release_id]
    assert status(root)["outcome"] == "rejected"
    assert status(root)["failed_checks"][0]["check"] == "values within the catalog's range"
    report = read_json(store / "rejected" / f"{result.release_id}.json")
    assert report["release_id"] == result.release_id


# --- rollback --------------------------------------------------------------------------------------


def test_rollback_rewrites_current_and_keeps_every_release(root, register, store):
    first = publish(root, register, store)
    second = publish(root, register, store, now=NOW + HOUR)

    result = rollback(release_id=first.release_id, now=NOW + 2 * HOUR, **others(root, register, store))

    assert result.outcome == "rolled_back" and result.exit_code == 0
    assert current(root) == first.release_id
    assert R.release_ids(root) == [first.release_id, second.release_id]
    assert status(root)["outcome"] == "rolled_back"
    assert [(r["command"], r["event"], r.get("outcome")) for r in runs(store)][-1] == (
        "rollback", "finished", "rolled_back")


def test_rollback_to_a_release_that_is_not_there_is_refused(root, register, store):
    first = publish(root, register, store)
    result = rollback(release_id="20200101T000000Z-abcdef0", **others(root, register, store))
    assert result.outcome == "refused" and current(root) == first.release_id


# --- retention -------------------------------------------------------------------------------------


def test_pruning_renames_into_trash_so_a_reader_holding_an_older_release_reads_on(
        root, register, store):
    first = publish(root, register, store, keep=2)
    held = open(root / "releases" / first.release_id / "series" / "fx_price.json", "rb")  # noqa: SIM115
    expected = (root / "releases" / first.release_id / "manifest.json").read_bytes()

    second = publish(root, register, store, now=NOW + HOUR, keep=2)
    third = publish(root, register, store, now=NOW + 2 * HOUR, keep=2)

    assert R.release_ids(root) == [second.release_id, third.release_id]
    assert R.release_ids(root, "trash") == [first.release_id]
    with held:
        assert b'"fx_price"' in held.read()                       # an open file reads on
    assert (root / "trash" / first.release_id / "manifest.json").read_bytes() == expected

    # Not yet a day: still there. A day on: gone.
    publish(root, register, store, now=NOW + 20 * HOUR, keep=5)
    assert R.release_ids(root, "trash") == [first.release_id]
    publish(root, register, store, now=NOW + 2 * HOUR + DAY, keep=5)
    assert R.release_ids(root, "trash") == [] and not list((root / "trash").iterdir())


def test_a_pinned_release_survives_retention_until_it_is_unpinned(root, register, store):
    first = publish(root, register, store, keep=1)
    assert pin(release_id=first.release_id, reason="named by a claim lock",
               **others(root, register, store)).outcome == "pinned"

    second = publish(root, register, store, now=NOW + HOUR, keep=1)
    third = publish(root, register, store, now=NOW + 2 * HOUR, keep=1)
    assert R.release_ids(root) == [first.release_id, third.release_id]
    assert R.release_ids(root, "trash") == [second.release_id]
    assert read_json(root / "pins.json")["pins"][0]["reason"] == "named by a claim lock"

    assert unpin(release_id=first.release_id, **others(root, register, store)).outcome == "unpinned"
    publish(root, register, store, now=NOW + 3 * HOUR, keep=1)
    assert first.release_id not in R.release_ids(root)


def test_a_release_that_is_not_in_the_root_cannot_be_pinned(root, register, store):
    publish(root, register, store)
    result = pin(release_id="20200101T000000Z-abcdef0", reason="x", **others(root, register, store))
    assert result.outcome == "refused" and not (root / "pins.json").exists()


# --- withdrawal ------------------------------------------------------------------------------------

JOBS = (b"150010", b"150120", b"150300")


def three_releases(tmp_path, root, register, store):
    """A holds both Series, B only prices (its register row covered nothing else), C both."""
    a = publish(root, register, store)
    narrowed = write_register(tmp_path / "narrowed.json", fixture_table(datasets=["fixture prices"]))
    b = publish(root, narrowed, store, now=NOW + HOUR)
    c = publish(root, register, store, now=NOW + 2 * HOUR)
    assert [r.outcome for r in (a, b, c)] == ["promoted"] * 3
    return a, b, c


def test_withdrawal_publishes_a_release_without_the_series_and_retires_the_right_releases(
        tmp_path, root, register, store):
    a, b, c = three_releases(tmp_path, root, register, store)

    result = withdraw(key="fx_jobs", reason="the permission was read wrongly", now=NOW + 3 * HOUR,
                      **others(root, register, store))

    assert result.outcome == "withdrawn" and result.exit_code == 0, result.lines
    assert current(root) == result.release_id
    assert R.release_ids(root) == [b.release_id, result.release_id]     # B never held it
    assert sorted(p.name for p in (store / "retired").iterdir()) == [a.release_id, c.release_id]
    manifest = read_json(root / "releases" / result.release_id / "manifest.json")
    assert manifest["withheld"] == [{"key": "fx_jobs", "reason":
                                     "withdrawn on 2026-05-13: the permission was read wrongly"}]
    assert sorted(manifest["series"]) == ["fx_price"] and manifest["reused_data_from"] == c.release_id
    assert validate_release(root / "releases" / result.release_id) == []
    everything = all_bytes(root)
    assert not any(value in everything for value in JOBS)
    record = read_json(root / "withdrawn.json")["series"]["fx_jobs"]
    assert record["retired"] == [a.release_id, c.release_id]


def test_a_withdrawn_series_stays_out_of_every_later_release_whatever_the_register_says(
        tmp_path, root, register, store):
    three_releases(tmp_path, root, register, store)
    withdraw(key="fx_jobs", reason="wrong permission", now=NOW + 3 * HOUR, **others(root, register, store))

    later = publish(root, register, store, now=NOW + 4 * HOUR)

    assert later.outcome == "promoted"
    manifest = read_json(root / "releases" / later.release_id / "manifest.json")
    assert sorted(manifest["series"]) == ["fx_price"]
    assert manifest["withheld"][0]["reason"].startswith("withdrawn on 2026-05-13")
    assert not any(value in all_bytes(root) for value in JOBS)


def test_a_withdrawal_that_was_cut_off_is_finished_by_running_it_again(tmp_path, root, register, store):
    a, b, c = three_releases(tmp_path, root, register, store)
    # Cut off after the withdrawal was written down and before anything else happened.
    R.replace_json(root / "withdrawn.json", {"format": 1, "series": {"fx_jobs": {
        "reason": "wrong permission", "withdrawn_at": "2026-05-13T18:00:00Z", "retired": []}}})

    # Until it is finished nothing may point at a release that holds the Series.
    assert rollback(release_id=a.release_id, **others(root, register, store)).outcome == "refused"
    assert pin(release_id=c.release_id, reason="x", **others(root, register, store)).outcome == "refused"
    assert publish(root, register, store, now=NOW + 3 * HOUR, reuse_data=True).outcome == "refused"

    result = withdraw(key="fx_jobs", reason="again", now=NOW + 4 * HOUR, **others(root, register, store))
    assert result.outcome == "withdrawn"
    assert R.release_ids(root) == [b.release_id, result.release_id]
    assert read_json(root / "withdrawn.json")["series"]["fx_jobs"]["reason"] == "wrong permission"


def test_a_withdrawal_takes_releases_out_of_the_trash_too(tmp_path, root, register, store):
    a = publish(root, register, store, keep=1)
    b = publish(root, register, store, now=NOW + HOUR, keep=1)
    assert R.release_ids(root, "trash") == [a.release_id]

    result = withdraw(key="fx_jobs", reason="wrong", now=NOW + 2 * HOUR, **others(root, register, store))

    assert R.release_ids(root, "trash") == [] and not list((root / "trash").iterdir())
    assert sorted(p.name for p in (store / "retired").iterdir()) == [a.release_id, b.release_id]
    assert R.release_ids(root) == [result.release_id]


def test_if_no_replacement_can_be_written_the_withdrawn_series_is_not_left_being_served(
        root, register, store):
    first = publish(root, register, store)

    def full(path, data):
        raise OSError(errno.ENOSPC, os.strerror(errno.ENOSPC))

    result = withdraw(key="fx_jobs", reason="wrong", now=NOW + HOUR, write=full,
                      **others(root, register, store))

    assert result.exit_code == 1
    assert current(root) is None and R.release_ids(root) == []
    assert (store / "retired" / first.release_id).is_dir()
    assert not any(value in all_bytes(root) for value in JOBS)
