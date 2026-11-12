"""``python -m atlas handoff --from CLONE``: the capture hand-off (PLAN 4.7 and M26; ADR 0012).

The interim capture job runs on another host and commits what it fetches to a repository of
its own (``deploy/capture/``). When the server's timer takes over, those Captures move into
the server's store once. A Capture cannot be made again, so none may be lost and none doubled:

1. the source is at rest: no run of it is unfinished and nothing holds its lock (disable the
   workflow first; the runbook says how);
2. every blob its fetch log names is there and is the bytes its name promises;
3. the destination holds nothing yet but its lock files, asked again once it is locked.
   This is not a merge;
4. ``raw/``, ``fetchlog.ndjson`` and ``runs.ndjson`` are copied, and nothing else of the clone;
5. the destination is checked the same way and must count the same Captures and blobs.

``atlas replay`` then records them in the vintage store under their original retrieval times,
and the next ``atlas refresh`` reports any day missed in between as ``MISSED``.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import io
import os
import re
import shutil
import sys
from pathlib import Path

from .capture import store as S
from .capture.cli import _verify
from .publish import root as R
from .refresh import REFRESH_LOCK

_COPIED = ("raw", S.FETCH_LOG, S.RUNS)


def _checked(store: Path) -> tuple[int, list[str], tuple[str, ...]]:
    """``atlas capture --verify`` on a store: its status, its lines, and its two counts."""
    said = io.StringIO()
    with contextlib.redirect_stdout(said):
        status = _verify(store)
    lines = said.getvalue().splitlines()
    counts = re.match(r"(\d+) captures, (\d+) blobs", lines[-1] if lines else "")
    return status, lines, counts.groups() if counts else ()


@contextlib.contextmanager
def _at_rest(source: Path):
    """Hold the source's lock, as its own capture job would, so no job is writing it.

    A clone mounted read-only is still locked, through a descriptor that only reads. A
    source with no ``LOCK`` file that none can be made in has never had a job run in it from
    here (the capture repository ignores ``LOCK``, so a fresh clone has none); the check for
    an unfinished run is then what says it is at rest. A ``LOCK`` that is there and cannot
    be opened is a refusal: whether a job holds it cannot be known."""
    lock = source / "LOCK"
    try:
        handle = open(lock, "a")
    except OSError:
        if not os.path.lexists(lock):
            yield                                      # no lock file, and none can be made here
            return
        try:
            handle = open(lock)                        # a read-only mount: flock needs no write
        except OSError as error:
            raise S.StoreLocked(f"the source's LOCK is there and cannot be opened ({error})") from None
    with handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise S.StoreLocked("another capture run holds the source") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _holds_something(store: Path) -> str | None:
    """The first thing in a store that is not one of its lock files."""
    names = sorted(path.name for path in store.iterdir() if path.name not in ("LOCK", REFRESH_LOCK))
    return names[0] if names else None


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    parser = argparse.ArgumentParser(prog="atlas handoff", description=__doc__.split("\n\n")[0])
    parser.add_argument("--from", dest="source", required=True, metavar="CLONE",
                        help="a clone of the capture repository, with its workflow disabled")
    parser.add_argument("--store", help="the store to fill (default $ATLAS_STORE, else var/store)")
    args = parser.parse_args(argv)
    source = Path(args.source)
    store = Path(args.store) if args.store else R.home("store")

    def refuse(text: str) -> int:
        print(f"REFUSED: {text}; nothing was copied")
        return 1

    if not (source / S.FETCH_LOG).is_file():
        return refuse(f"{source} has no {S.FETCH_LOG}: it is not a capture store")
    if R.overlaps(source, store):
        return refuse(f"{source} and {store} overlap")
    if store.is_dir() and _holds_something(store):
        return refuse(f"{store} already holds captures or a vintage store ({_holds_something(store)}); a "
                      "hand-off fills an empty store once and never adds to one")
    made = False
    try:
        with _at_rest(source):
            problems: list[str] = []
            unfinished = S.unfinished_runs(S.read_runs(source, problems))
            if problems:
                # A line cut off part way may be the start of a run that never finished.
                return refuse(f"the run log of {source} is not whole ({problems[0]})")
            if unfinished:
                return refuse(f"run {unfinished[0].get('run_id')} of {source} did not finish. Disable "
                              "the capture workflow, let a run end clean, and pull again")
            status, lines, counted = _checked(source)
            print("\n".join(lines))
            if status:
                return refuse(f"{source} is not whole")
            made = not store.exists()
            store.mkdir(parents=True, exist_ok=True)
            with S.locked(store):
                # Asked again now that the store is held: nothing can have arrived since.
                found = _holds_something(store)
                if found:
                    return refuse(f"{store} already holds captures or a vintage store ({found}); a "
                                  "hand-off fills an empty store once and never adds to one")
                try:
                    # A source no endpoint ever answered has logs and no raw/ at all.
                    if (source / "raw").is_dir():
                        shutil.copytree(source / "raw", store / "raw")
                    for name in _COPIED[1:]:
                        if (source / name).exists():
                            shutil.copyfile(source / name, store / name)
                except OSError as error:
                    # The store held nothing when it was locked: what is there now is this
                    # run's half copy, and it goes, so the hand-off can be run again.
                    for name in _COPIED:
                        if (store / name).is_dir():
                            shutil.rmtree(store / name, ignore_errors=True)
                        else:
                            (store / name).unlink(missing_ok=True)
                    print(f"FAILED: the copy into {store} did not finish ({error}); what it had "
                          "copied was removed, and the store holds no Capture. Run the hand-off again")
                    return 1
                status, copied, arrived = _checked(store)
    except S.StoreLocked:
        if made and store.is_dir() and not _holds_something(store):
            shutil.rmtree(store, ignore_errors=True)
        return refuse(f"a run holds {source} or {store}")
    print("\n".join(copied))
    if status or not counted or arrived != counted:
        print(f"FAILED: {store} does not hold what {source} holds. Remove raw/, {S.FETCH_LOG} and "
              f"{S.RUNS} from {store} and run the hand-off again; do not start the timer")
        return 1
    print(f"handoff: {counted[0]} captures and {counted[1]} blobs are in {store}, the same as in {source}. Next: "
          "python -m atlas replay, then start the timer")
    return 0
