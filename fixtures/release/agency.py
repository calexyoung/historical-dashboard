"""A public-profile Release of the capture fixtures, in a directory of the caller's:

    python fixtures/release/agency.py --out DIR

It runs the real capture kit over every recorded exchange in ``fixtures/capture`` (invented
values; nothing is asked of the network), replays them into a vintage store and runs the real
release writer with ``--profile public``. The register it is decided under is a copy of the
committed table in which every row that lists something to capture carries a decision. That
decision is test data and says nothing of what Alex has decided: the committed register signs
no row, which is why this Release needs ``--out`` and can never be written into $ATLAS_PUBLIC
(docs/method/release-writer.md).

DIR then holds ``public/`` (the release root), ``store/`` and ``register.json`` (the test
register, for a test that must hand the same table to a rights gate). M18's Explorer tests use
it: daily, weekly, monthly and quarterly agency Series under v1's keys, with their vintages.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from atlas.capture.cli import main as capture
from atlas.capture.run import endpoints_from_register
from atlas.publish.run import release
from atlas.rights import load_register
from atlas.vintage.cli import main as replay

#: The fixtures' own "now": a day after their last recorded fetch.
NOW = datetime(2026, 11, 12, 15, 0, 0, tzinfo=UTC)
DECISION = {"display": True, "redistribute": True, "store": True, "ml_use": True,
            "signed_by": "Alex", "signed_on": "2026-11-11"}


def test_register() -> dict:
    table = load_register()
    capturing = {endpoint.source for endpoint in endpoints_from_register(table)}
    for row in table["rows"]:
        if row["id"] in capturing:
            row["decision"] = dict(DECISION)
    table["version"] = f"{table['version']}+test-decisions"
    return table


def build(out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    register, store, spot = out / "register.json", out / "store", out / "no-spots.json"
    register.write_text(json.dumps(test_register()))
    spot.write_text(json.dumps({"format": 1, "about": "none", "spots": []}))
    with contextlib.redirect_stdout(io.StringIO()):
        for command, arguments in ((capture, ["--store", str(store), "--register", str(register),
                                              "--replay", str(ROOT / "fixtures" / "capture")]),
                                   (replay, ["--store", str(store), "--register", str(register)])):
            if command(arguments) != 0:
                print(f"{command.__module__} failed", file=sys.stderr)
                return 1
    result = release(profile="public", root=out / "public", store=store, register=register, now=NOW, spot=spot)
    print(result.lines[-1] if result.lines else result.outcome)
    return result.exit_code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True, help="a directory outside any release root")
    sys.exit(build(Path(parser.parse_args().out)))
