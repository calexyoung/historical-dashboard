"""``python -m atlas refresh``: the one job a timer runs (PLAN 4.4, 4.7 and M26; ADR 0040).

    python -m atlas refresh --profile public        capture, replay, release, in that order
    python -m atlas refresh --profile public --no-capture
                                                    publish what the store already holds

One process, one refresh at a time: it holds ``REFRESH.LOCK`` in the store from before the
capture until after the release, so a run started by hand cannot land between the steps of
the timer's. (Each step still takes the store's and the root's own ``LOCK``.)

What a failed step means:

* **The capture did not end clean** (a source did not answer, an answer was not whole, a key
  is not set, a selected row is not signed). The run goes on: what the store holds is still
  replayed and published, the Release marks what is stale, and the next run asks again.
* **The replay failed** (a kept Capture was altered or no longer parses as whole, the rights
  gate refused, the store is locked). The store's own record is then not known to be whole,
  so no Release is written and ``CURRENT`` is as it was.
* **The release was refused, rejected or failed.** Before its commit point ``CURRENT`` is as
  it was. After it (the journal or retention failed once ``CURRENT`` had moved) the new
  Release is the one being served, and the last line says so.

Exit status 0 means all three ended clean; 1 means at least one did not, and the lines above
the last say which. The rows to ask are chosen on the host with ``ATLAS_CAPTURE_ONLY`` (names
separated by spaces), which selects among rows and clears none.
"""
from __future__ import annotations

import argparse
import fcntl
import os
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .capture.cli import main as capture_main
from .publish import root as R
from .publish.cli import main as publish_main
from .vintage.cli import main as replay_main

REFRESH_LOCK = "REFRESH.LOCK"


class Busy(Exception):
    """Another refresh, or a backup, holds the store's ``REFRESH.LOCK``."""


@contextmanager
def holding(store: Path, wait: float = 0) -> Iterator[None]:
    """Hold ``REFRESH.LOCK`` in ``store``: the one lock a whole refresh and a whole backup
    share, so neither starts inside the other. ``wait`` is how many seconds to keep asking
    before giving up; the operating system frees the lock when its holder ends, however it
    ends."""
    deadline = time.monotonic() + max(0.0, wait)
    with open(Path(store) / REFRESH_LOCK, "a") as handle:
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Busy(str(Path(store) / REFRESH_LOCK)) from None
                time.sleep(min(1.0, max(0.05, deadline - time.monotonic())))
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _say(text: str) -> None:
    print(text, flush=True)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    parser = argparse.ArgumentParser(prog="atlas refresh", description=__doc__.split("\n\n")[0])
    parser.add_argument("--profile", required=True, choices=("public", "local"),
                        help="which kind of Release to write, and so which root")
    parser.add_argument("--store", help="the store (default $ATLAS_STORE, else var/store)")
    parser.add_argument("--out", help="the release root (default $ATLAS_PUBLIC or $ATLAS_LOCAL)")
    parser.add_argument("--register", help="a rights register file (default schema/rights-register.json)")
    parser.add_argument("--series", help="a catalog directory or a series table file (default catalog/series)")
    parser.add_argument("--content", help="the content directory (default content)")
    parser.add_argument("--manual", help="the hand-entered directory (default catalog/manual)")
    parser.add_argument("--only", action="append", metavar="NAME",
                        help="a register row or endpoint to capture; may be repeated "
                             "(default: the names in $ATLAS_CAPTURE_ONLY, else every endpoint)")
    parser.add_argument("--replay", metavar="DIR",
                        help="capture from recorded exchanges under DIR, not from the network")
    parser.add_argument("--no-capture", action="store_true",
                        help="ask no source: replay and release what the store holds")
    parser.add_argument("--no-legacy", action="store_true",
                        help="local profile: do not add v1's legacy Series")
    parser.add_argument("--wait", type=float, default=0, metavar="SECONDS",
                        help="how long to wait for a refresh or a backup already running "
                             "(default 0: refuse at once)")
    args = parser.parse_args(argv)
    if args.no_legacy and args.profile == "public":
        parser.error("--no-legacy goes with --profile local: a public release never holds v1's Series")

    store = Path(args.store) if args.store else R.home("store")
    root = Path(args.out) if args.out else R.home(args.profile)
    shared = ["--store", str(store)] + (["--register", args.register] if args.register else [])
    series = ["--series", args.series] if args.series else []
    store.mkdir(parents=True, exist_ok=True)
    try:
        with holding(store, args.wait):
            return _run(args, store, root, shared, series)
    except Busy:
        _say(f"REFUSED: another refresh, or a backup, holds {store / REFRESH_LOCK}; nothing was "
             "asked and nothing was changed")
        return 1


def _run(args: argparse.Namespace, store: Path, root: Path, shared: list[str], series: list[str]) -> int:
    captured = 0
    if not args.no_capture:
        only = args.only if args.only is not None else os.environ.get("ATLAS_CAPTURE_ONLY", "").split()
        _say("== capture")
        captured = capture_main([*shared, *(["--replay", args.replay] if args.replay else []),
                                 *(part for name in only for part in ("--only", name))])
        if captured:
            _say("refresh: the capture did not end clean; what the store holds is still "
                 "replayed and published, and the next run asks again")
    _say("== replay")
    if replay_main([*shared, *series]):
        _say(f"refresh: the replay failed, so the store's record is not known to be whole; "
             f"no Release is written and CURRENT is as it was ({R.current(root)})")
        return 1
    _say("== release")
    before = R.current(root)
    released = publish_main([
        "release", "--profile", args.profile, "--out", str(root), *shared, *series,
        *(["--content", args.content] if args.content else []),
        *(["--manual", args.manual] if args.manual else []),
        *(["--no-legacy"] if args.no_legacy else [])])
    if released and R.current(root) != before:
        # The writer's commit point is CURRENT: it moved, and something after it failed.
        _say(f"refresh: a Release was promoted (CURRENT is {R.current(root)}), and the run did not "
             "end clean after that; read the lines above")
    elif released:
        _say(f"refresh: no Release was promoted; CURRENT is as it was ({before})")
    else:
        _say(f"refresh: a Release was promoted; CURRENT is {R.current(root)}"
             + ("" if not captured else ", from a capture that did not end clean"))
    return 1 if captured or released else 0


if __name__ == "__main__":
    sys.exit(main())
