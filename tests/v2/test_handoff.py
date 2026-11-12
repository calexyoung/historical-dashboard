"""``atlas handoff`` (PLAN 4.7 and M26; ADR 0012, ADR 0040): moving the interim Captures from
the capture host's repository into the server's store, once, with none lost and none doubled.
A Capture cannot be made again, so the copy is checked at both ends."""
from __future__ import annotations

import fcntl
import gzip
import json
import os

import pytest

from atlas.capture.cli import main as capture_main
from atlas.cli import main as atlas_main
from atlas.vintage.cli import main as replay_main
from atlas.vintage.store import VintageStore

from .release_helpers import SERIES, THREE, write_register


@pytest.fixture
def clone(tmp_path):
    """What the capture repository holds: raw bytes and the two logs, and git's own files."""
    register = write_register(tmp_path / "register.json")
    directory = tmp_path / "clone"
    for name in ("1-initial", "2-revision"):
        assert capture_main(["--store", str(directory), "--register", str(register), "--replay", str(THREE / name)]) == 0
    (directory / ".git").mkdir()
    (directory / ".git" / "config").write_text("[core]\n")
    (directory / "README.md").write_text("captures\n")
    return directory


def handoff(clone, store) -> int:
    return atlas_main(["handoff", "--from", str(clone), "--store", str(store)])


def test_the_captures_arrive_whole_and_the_store_replays_them_with_their_first_times(clone, tmp_path, capsys):
    store = tmp_path / "store"

    assert handoff(clone, store) == 0

    out = capsys.readouterr().out
    assert "2 captures, 2 blobs, all present and unaltered" in out
    assert "handoff: 2 captures and 2 blobs are in" in out
    for name in ("fetchlog.ndjson", "runs.ndjson"):
        assert (store / name).read_bytes() == (clone / name).read_bytes()
    assert sorted(p.relative_to(store) for p in (store / "raw").rglob("*.gz")) == sorted(
        p.relative_to(clone) for p in (clone / "raw").rglob("*.gz"))
    assert not (store / ".git").exists() and not (store / "README.md").exists()
    assert replay_main(["--store", str(store), "--register", str(tmp_path / "register.json"), "--series", str(SERIES)]) == 0
    first = json.loads((clone / "fetchlog.ndjson").read_text().splitlines()[0])["retrieved_at"]
    assert VintageStore(store).captures("fx_jobs")[0]["retrieved_at"] == first


def test_a_store_that_already_holds_captures_is_never_added_to(clone, tmp_path, capsys):
    store = tmp_path / "store"
    assert handoff(clone, store) == 0
    before = (store / "fetchlog.ndjson").read_bytes()
    capsys.readouterr()

    assert handoff(clone, store) == 1

    assert "already holds captures" in capsys.readouterr().out
    assert (store / "fetchlog.ndjson").read_bytes() == before


def test_a_clone_with_a_missing_or_altered_blob_is_not_handed_over(clone, tmp_path, capsys):
    blob = min((clone / "raw").rglob("*.gz"))
    blob.write_bytes(gzip.compress(b"something else"))

    assert handoff(clone, tmp_path / "store") == 1

    assert "ALTERED" in capsys.readouterr().out
    assert not (tmp_path / "store").exists()


def test_a_clone_that_is_still_being_written_is_not_handed_over(clone, tmp_path, capsys):
    """The workflow must be disabled first. A run that started and never finished, or a lock
    still held, means the source is not at rest."""
    with open(clone / "runs.ndjson", "a") as handle:
        handle.write(json.dumps({"format": 1, "event": "started", "run_id": "r-unfinished",
                                 "started_at": "2026-05-01T14:50:00Z"}) + "\n")

    assert handoff(clone, tmp_path / "store") == 1

    assert "did not finish" in capsys.readouterr().out
    assert not (tmp_path / "store").exists()


def test_a_clone_that_cannot_be_written_to_is_handed_over_all_the_same(clone, tmp_path):
    """On the server the clone is mounted read-only, and a fresh clone has no lock file (the
    capture repository ignores it): nothing of it is changed."""
    (clone / "LOCK").unlink()
    before = sorted(path.name for path in clone.iterdir())
    clone.chmod(0o555)
    try:
        assert handoff(clone, tmp_path / "store") == 0
    finally:
        clone.chmod(0o755)
    assert sorted(path.name for path in clone.iterdir()) == before
    assert (tmp_path / "store" / "fetchlog.ndjson").read_bytes() == (clone / "fetchlog.ndjson").read_bytes()


def test_a_read_only_clone_whose_lock_a_job_holds_is_still_refused(clone, tmp_path, capsys):
    """Read-only to this process is not at rest: a job writing it elsewhere holds its lock,
    and the lock is asked for through a descriptor that only reads."""
    (clone / "LOCK").chmod(0o444)
    clone.chmod(0o555)
    try:
        with open(clone / "LOCK") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)

            assert handoff(clone, tmp_path / "store") == 1
    finally:
        clone.chmod(0o755)
    assert "a run holds" in capsys.readouterr().out
    assert not (tmp_path / "store").exists()


def test_a_store_that_holds_anything_but_its_locks_is_not_empty(clone, tmp_path, capsys):
    """Not only Captures: a vintage store, a run log, a rejected report."""
    for name in ("obslog", "runs.ndjson", "rejected"):
        store = tmp_path / f"store-{name}"
        store.mkdir()
        (store / "LOCK").write_text("")
        (store / name).mkdir() if "." not in name else (store / name).write_text("{}\n")

        assert handoff(clone, store) == 1
        assert f"already holds captures or a vintage store ({name})" in capsys.readouterr().out
        assert sorted(path.name for path in store.iterdir()) == sorted(["LOCK", name])


def test_what_arrives_in_the_store_while_the_clone_is_being_checked_is_not_written_over(clone, tmp_path, monkeypatch, capsys):
    """The store is asked again once it is locked: a capture that finished meanwhile wins."""
    from atlas import handoff as H

    store = tmp_path / "store"
    real = H._checked

    def checked_and_meanwhile(directory):
        answer = real(directory)
        if directory == clone:
            store.mkdir()
            (store / "runs.ndjson").write_text('{"event": "finished", "run_id": "r-meanwhile"}\n')
        return answer

    monkeypatch.setattr(H, "_checked", checked_and_meanwhile)

    assert handoff(clone, store) == 1

    assert "already holds" in capsys.readouterr().out
    assert (store / "runs.ndjson").read_text() == '{"event": "finished", "run_id": "r-meanwhile"}\n'
    assert not (store / "raw").exists()


@pytest.mark.skipif(os.geteuid() == 0, reason="root opens any file")
def test_a_lock_that_is_there_and_cannot_be_opened_is_a_refusal_not_a_way_round(clone, tmp_path, capsys):
    (clone / "LOCK").chmod(0)
    clone.chmod(0o555)
    try:
        assert handoff(clone, tmp_path / "store") == 1
    finally:
        clone.chmod(0o755)
        (clone / "LOCK").chmod(0o644)
    assert "a run holds" in capsys.readouterr().out
    assert not (tmp_path / "store").exists()
