"""``atlas refresh`` (PLAN 4.4, 4.7 and M26): the one job a timer runs. Capture, replay and
release, in that order, by one process that lets no second refresh in.

Every capture here answers from M8's recorded fixture exchanges (invented values of a made-up
Origin). Nothing is asked of the network (conftest.py)."""
from __future__ import annotations

import fcntl
import gzip
import json
import threading
import time
from pathlib import Path

import pytest

from atlas import refresh as F
from atlas.capture.cli import main as capture_main
from atlas.cli import main as atlas_main

from .release_helpers import SERIES, THREE, current, read_json, write_register


@pytest.fixture
def job(tmp_path):
    register = write_register(tmp_path / "register.json")
    store, root = tmp_path / "store", tmp_path / "public"

    def run(*more: str, fetch: str | None = "1-initial") -> int:
        argv = ["refresh", "--profile", "public", "--store", str(store), "--out", str(root),
                "--register", str(register), "--series", str(SERIES),
                "--content", str(tmp_path / "content"), "--manual", str(tmp_path / "manual")]
        if fetch:
            argv += ["--replay", str(THREE / fetch)]
        return atlas_main([*argv, *more])

    run.store, run.root, run.register = store, root, register
    return run


def jobs_recorded(store: Path) -> list[str]:
    lines = [json.loads(line) for line in (store / "runs.ndjson").read_text().splitlines()]
    return [line.get("job", "capture") for line in lines if line.get("event") == "finished"]


def january(root: Path) -> float:
    series = read_json(root / "releases" / current(root) / "series" / "fx_jobs.json")
    return next(o["value"] for o in series["observations"] if o["period"] == "2026-01")


def test_one_command_captures_replays_and_promotes_a_release_in_that_order(job, capsys):
    assert job() == 0

    assert current(job.root) is not None
    assert january(job.root) == 150000
    assert jobs_recorded(job.store) == ["capture", "release"]
    out = capsys.readouterr().out
    assert out.index("== capture") < out.index("== replay") < out.index("== release")
    assert "refresh: a Release was promoted" in out


def test_the_next_run_publishes_what_the_source_revised_and_nothing_else_is_needed(job):
    assert job() == 0
    first = current(job.root)

    assert job(fetch="2-revision") == 0

    assert current(job.root) != first
    assert january(job.root) == 150010


def test_a_capture_that_did_not_end_clean_does_not_stop_what_did_arrive_and_the_run_ends_red(job, capsys):
    """A source that does not answer today is tomorrow's retry. What the store holds is
    still published; the run's status says it was not a clean day."""
    assert job() == 0
    capsys.readouterr()

    status = job("--only", "no-such-row", fetch="2-revision")

    out = capsys.readouterr().out
    assert status == 1
    assert "the capture did not end clean" in out
    assert "== release" in out                       # it went on
    assert current(job.root) is not None and january(job.root) == 150000


def test_when_the_replay_fails_no_release_is_written_and_current_is_as_it_was(job, capsys):
    """An altered blob: the store's own record is not whole, so nothing is published from it."""
    assert job() == 0
    first = current(job.root)
    assert capture_main(["--store", str(job.store), "--register", str(job.register),
                         "--replay", str(THREE / "2-revision")]) == 0
    newest = max((job.store / "raw").rglob("*.gz"), key=lambda path: path.stat().st_mtime_ns)
    newest.write_bytes(gzip.compress(b"not what the source served"))
    capsys.readouterr()

    status = job("--no-capture", fetch=None)

    out = capsys.readouterr().out
    assert status == 1
    assert "== release" not in out
    assert "no Release is written" in out
    assert current(job.root) == first and january(job.root) == 150000


def test_a_second_refresh_is_refused_while_one_runs_and_does_nothing(job, capsys):
    job.store.mkdir()
    with open(job.store / F.REFRESH_LOCK, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

        status = job()

    out = capsys.readouterr().out
    assert status == 1
    assert "another refresh, or a backup, holds" in out and "== capture" not in out
    assert not (job.store / "runs.ndjson").exists() and current(job.root) is None


def test_the_host_chooses_rows_with_one_variable_and_a_run_can_leave_capture_out(job, monkeypatch):
    seen: list[list[str]] = []
    monkeypatch.setattr(F, "capture_main", lambda argv: seen.append(argv) or 0)
    monkeypatch.setattr(F, "replay_main", lambda argv: 0)
    monkeypatch.setattr(F, "publish_main", lambda argv: 0)
    monkeypatch.setenv("ATLAS_CAPTURE_ONLY", "bls  fed-board")

    assert job(fetch=None) == 0
    assert seen[0][-4:] == ["--only", "bls", "--only", "fed-board"]

    assert job("--no-capture", fetch=None) == 0
    assert len(seen) == 1


def test_a_refresh_writes_only_the_profile_it_is_told(job):
    with pytest.raises(SystemExit):
        atlas_main(["refresh", "--store", str(job.store)])


def test_a_refresh_told_to_wait_runs_when_the_one_before_it_ends(job, capsys):
    """The timer's refresh and the nightly backup share this lock; the later one waits its
    turn instead of losing its run."""
    job.store.mkdir()
    with open(job.store / F.REFRESH_LOCK, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        threading.Timer(0.3, lambda: fcntl.flock(handle, fcntl.LOCK_UN)).start()
        started = time.monotonic()

        assert job("--wait", "20") == 0

    assert 0.25 < time.monotonic() - started < 15
    assert current(job.root) is not None and "== capture" in capsys.readouterr().out


def test_a_release_that_was_promoted_and_then_failed_is_not_reported_as_no_release(job, monkeypatch, capsys):
    """The writer's commit point is CURRENT. A failure after it (the journal, retention) ends
    the run red, and the Release is the one being served all the same."""
    assert job() == 0
    first = current(job.root)
    real = F.publish_main

    def promoted_then_failed(argv):
        assert real(argv) == 0
        return 1

    monkeypatch.setattr(F, "publish_main", promoted_then_failed)
    capsys.readouterr()

    assert job(fetch="2-revision") == 1

    out = capsys.readouterr().out
    assert current(job.root) != first
    assert f"a Release was promoted (CURRENT is {current(job.root)}), and the run did not end clean" in out
    assert "no Release was promoted" not in out

    monkeypatch.setattr(F, "publish_main", lambda argv: 1)
    assert job("--no-capture", fetch=None) == 1
    assert f"no Release was promoted; CURRENT is as it was ({current(job.root)})" in capsys.readouterr().out
