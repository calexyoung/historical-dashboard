"""See the vintage store work on the three-fetch fixture, in a temporary directory:

    python fixtures/vintage/demo.py

It runs the real capture kit over the three recorded fetches (invented values; nothing is asked
of the network), replays them into a vintage store after each one, and prints what the store
then holds. The register it runs under is the fixture's own test table for a made-up Origin.
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))

from make_fixtures import FETCHES, register

from atlas.capture.cli import main as capture
from atlas.vintage.cli import main as replay


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        store, table = Path(tmp) / "store", Path(tmp) / "register.json"
        table.write_text(json.dumps(register()))
        common = ["--store", str(store), "--register", str(table)]
        for name, _began, _series in FETCHES:
            print(f"\n=== fetch {name} ===")
            with contextlib.redirect_stdout(io.StringIO()):  # the capture kit's own report
                status = capture([*common, "--replay", str(HERE / "three-fetch" / name)])
            if status or replay([*common, "--series", str(HERE / "series.json")]):
                return 1
        for key in ("fx_price", "fx_jobs"):
            print()
            replay(["--store", str(store), "--show", key])
        print()
        return replay(["--store", str(store), "--show", "fx_price", "--as-of", "2026-04-15T00:00:00Z"])


if __name__ == "__main__":
    sys.exit(main())
