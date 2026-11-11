"""``python -m atlas.capture`` (and ``atlas capture``): the capture job's command (PLAN M7).

    python -m atlas.capture                      fetch every endpoint the register lists
    python -m atlas.capture --dry-run            list them and what the rights gate says; fetch nothing
    python -m atlas.capture --status             last complete capture and missed days per endpoint
    python -m atlas.capture --replay DIR         answer from recorded exchanges, not the network
    python -m atlas.capture --export-fixtures DIR   write the store's latest captures as exchanges
    python -m atlas.capture --verify             check every blob the fetch log names against its hash

Exit status 0 means every selected endpoint was captured whole. 1 means a refusal, a failed or
incomplete endpoint, or a store that is locked. A missed day is reported and is not a failure
of today's run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from ..rights import REGISTER_PATH
from . import store as S
from .run import RegisterError, refusals, run_capture, select

DEFAULT_STORE = Path(__file__).resolve().parents[2] / "var" / "store"
_ERRORS = ("REFUSED", "FAILED", "INCOMPLETE", "MISSING", "ALTERED")


def _say(line: str) -> None:
    """Print a line; on GitHub Actions, also as an annotation so it shows on the run's page."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        if line.startswith(_ERRORS):
            line = f"::error::{line}"
        elif line.startswith("MISSED") or "is not whole" in line:
            line = f"::warning::{line}"
    print(line)


def _dry_run(table: object, only: list[str] | None) -> int:
    endpoints = select(table, only)
    refused = refusals(table, endpoints)
    for endpoint in endpoints:
        what = f"{endpoint.id} (row {endpoint.source}, {endpoint.adapter} adapter)"
        if endpoint.id in refused:
            _say(f"REFUSED {what}: {refused[endpoint.id]}")
        else:
            _say(f"{what}: cleared for storage")
    if refused:
        _say(f"{len(refused)} of {len(endpoints)} endpoints are not cleared. A run would fetch nothing.")
    return 1 if refused else 0


def _status(store: Path, table: object, only: list[str] | None, now: datetime) -> int:
    endpoints = [endpoint.id for endpoint in select(table, only)]
    problems: list[str] = []
    runs, fetches = S.read_runs(store, problems), S.read_fetch_log(store, problems)
    for problem in problems:
        _say(problem)
    missed = S.missed_days(runs, fetches, endpoints, now)
    for endpoint in endpoints:
        last = [line["retrieved_at"] for line in fetches
                if line.get("endpoint") == endpoint and line.get("outcome") == "captured"]
        _say(f"{endpoint}: last complete capture {last[-1]}" if last
             else f"{endpoint}: no complete capture in {store}")
        if endpoint in missed:
            _say(f"MISSED {endpoint}: {', '.join(missed[endpoint])}")
    return 0


def _verify(store: Path) -> int:
    """Every blob the fetch log names is there and is the bytes its name promises. Run on both
    sides of a hand-off of the store to another host (ADR 0012)."""
    problems: list[str] = []
    fetches = S.read_fetch_log(store, problems)
    blobs = sorted({part["blob"] for line in fetches for part in line.get("parts", [])})
    bad = 0
    for blob in blobs:
        try:
            S.read_blob(store, blob)
        except FileNotFoundError:
            _say(f"MISSING {blob}")
            bad += 1
        except (ValueError, OSError, EOFError):
            _say(f"ALTERED {blob}")
            bad += 1
    for problem in problems:
        _say(problem)
    if bad or problems:
        _say(f"{len(fetches)} captures, {len(blobs)} blobs, {bad} missing or altered in {store}")
        return 1
    _say(f"{len(fetches)} captures, {len(blobs)} blobs, all present and unaltered in {store}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="atlas capture", description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", help="the capture store (default $ATLAS_STORE, else var/store)")
    parser.add_argument("--register", help="a rights register file (default schema/rights-register.json)")
    parser.add_argument("--only", action="append", metavar="NAME",
                        help="a register row or endpoint to select; may be repeated")
    parser.add_argument("--replay", metavar="DIR", help="answer from recorded exchanges under DIR")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="list endpoints and the gate's answer")
    mode.add_argument("--status", action="store_true", help="last capture and missed days per endpoint")
    mode.add_argument("--verify", action="store_true",
                      help="check every blob the fetch log names against its hash")
    mode.add_argument("--export-fixtures", metavar="DIR",
                      help="write the store's latest complete captures to DIR as recorded exchanges")
    parser.add_argument("--as-of", metavar="TIME",
                        help="with --status: count missed days up to this UTC time (2026-11-14T12:00:00Z)")
    args = parser.parse_args(argv)

    store = Path(args.store or os.environ.get("ATLAS_STORE") or DEFAULT_STORE)
    register = Path(args.register) if args.register else REGISTER_PATH
    try:
        data = register.read_bytes()
        table = json.loads(data)
    except (OSError, ValueError) as error:
        _say(f"REFUSED: the rights register at {register} cannot be read: {error}")
        return 1
    if args.verify:
        return _verify(store)
    try:
        if args.dry_run:
            return _dry_run(table, args.only)
        if args.status:
            now = S.unstamp(args.as_of) if args.as_of else datetime.now(UTC)
            return _status(store, table, args.only, now)
        if args.export_fixtures:
            from .replay import ExportRefused, export_exchanges

            try:
                written = export_exchanges(store, Path(args.export_fixtures), table,
                                           note=f"Exported from a capture store by atlas capture "
                                                f"--export-fixtures; register {table.get('version')}.")
            except ExportRefused as error:
                _say(f"REFUSED: {error}")
                return 1
            for endpoint in written:
                _say(f"wrote {endpoint}")
            return 0 if written else 1
        if args.as_of:
            parser.error("--as-of goes with --status only: a capture is stamped with the time it happened")
        # Refusals are settled before a transport exists, so a run that would be refused
        # needs neither the network nor the network library.
        endpoints = select(table, args.only)
        if refusals(table, endpoints):
            transport = None
        elif args.replay:
            from .replay import ReplayTransport

            transport = ReplayTransport(Path(args.replay))
        else:
            from .http import LiveTransport

            transport = LiveTransport()
    except RegisterError as error:
        _say(f"REFUSED: {error}. Nothing was fetched.")
        return 1
    result = run_capture(store, table, transport, only=args.only,
                         register_sha256=hashlib.sha256(data).hexdigest(),
                         user_agent=os.environ.get("ATLAS_CAPTURE_USER_AGENT") or None)
    for line in result.lines:
        _say(line)
    done = sum(outcome == "captured" for outcome in result.outcomes.values())
    if result.outcomes:
        _say(f"{done} of {len(result.outcomes)} endpoints captured whole into {store}")
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
