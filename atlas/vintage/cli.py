"""``python -m atlas replay``: build the vintage store from kept Captures (PLAN M8).

    python -m atlas replay                       record every Capture the store does not hold yet
    python -m atlas replay --captures DIR        read Captures from another directory
    python -m atlas replay --show KEY            print the observation log of one Series
    python -m atlas replay --show KEY --as-of 2026-04-15T00:00:00Z
                                                 print what Macro Atlas held for it at that instant

Exit status 0 means every Capture that can be recorded is recorded. 1 means a refusal by the
rights gate, a Capture whose bytes were altered or no longer parse as whole, or a locked store.
A replay writes only retrieval times: running it later gives the same store.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from ..capture import store as S
from ..capture.cli import DEFAULT_STORE
from ..rights import REGISTER_PATH
from .replay import SeriesTableError, load_series, replay
from .store import VintageStore


def _show(store: Path, key: str, as_of: str | None) -> int:
    vintages = VintageStore(store)
    if key not in vintages.series_keys():
        print(f"{store} holds no Series called {key}")
        return 1
    if as_of:
        observations = vintages.vintage(key, S.unstamp(as_of))
        print(f"{key} as held by Macro Atlas at {as_of} (Atlas-observed: public no later than "
              "the time recorded, not when first reported)")
        if not observations:
            print("  nothing: no Capture had been recorded by then")
        for row in observations:
            print(f"  {row['period']:<10} {row['value'] or '':>14}  {row['status']:<12} "
                  f"held from {row['recorded_from']}")
        return 0
    print(f"{key}: {len(vintages.captures(key))} capture(s) recorded, "
          f"{len(vintages.vintage(key))} current Observation(s)")
    print(f"  {'period':<10} {'value':>14}  {'status':<12} {'recorded_from':<20}  recorded_to")
    for row in vintages.rows(key):
        value, status = ("", "withdrawn") if row["deleted"] else (row["value"] or "", row["status"])
        print(f"  {row['period']:<10} {value:>14}  {status:<12} {row['recorded_from']:<20}  "
              f"{row['recorded_to'] or 'current'}")
    for version in vintages.metadata_history(key):
        print(f"  metadata from {version['recorded_from']}: {version['metadata'].get('unit')}, "
              f"{version['metadata'].get('seasonal_adjustment')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="atlas replay", description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", help="the vintage store (default $ATLAS_STORE, else var/store)")
    parser.add_argument("--captures", help="the capture store to read (default: the same directory)")
    parser.add_argument("--register", help="a rights register file (default schema/rights-register.json)")
    parser.add_argument("--series", help="a series table (default atlas/vintage/series.json)")
    parser.add_argument("--show", metavar="KEY", help="print the observation log of one Series")
    parser.add_argument("--as-of", metavar="TIME", help="with --show: the Vintage at this UTC instant")
    args = parser.parse_args(argv)

    store = Path(args.store or os.environ.get("ATLAS_STORE") or DEFAULT_STORE)
    if args.as_of:
        if not args.show:
            parser.error("--as-of goes with --show: a replay writes retrieval times only")
        try:
            S.unstamp(args.as_of)
        except ValueError:
            parser.error("--as-of takes a UTC instant like 2026-04-15T00:00:00Z")
    if args.show:
        return _show(store, args.show, args.as_of)
    register = Path(args.register) if args.register else REGISTER_PATH
    try:
        table = json.loads(register.read_bytes())
    except (OSError, ValueError) as error:
        print(f"REFUSED: the rights register at {register} cannot be read: {error}")
        return 1
    try:
        series = load_series(Path(args.series) if args.series else None)
    except SeriesTableError as error:
        print(f"REFUSED: {error}")
        return 1
    result = replay(Path(args.captures) if args.captures else store, store, table, series)
    for line in result.lines:
        print(line)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
