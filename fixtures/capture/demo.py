"""See the six source adapters work on the committed fixtures, in a temporary directory:

    python fixtures/capture/demo.py            # print what happens
    python fixtures/capture/demo.py --out DIR  # keep the store and the release root in DIR

It runs the real commands over the recorded exchanges in this directory (invented values in
the sources' real shapes; nothing is asked of the network): ``atlas capture --replay`` for the
26 endpoints the rights register lists, ``atlas replay`` into a vintage store, and a
public-profile release of every Series the BLS, Treasury, Federal Reserve Board, IMF, BEA and EIA
adapters read, with the Derived series the engine computes from them (the Node step needs Node 22.18 or
later).

The register these are decided under is a copy of the committed one with those six rows
signed *in the temporary directory only*. That is why the commands run at all, and why the
release can never be written into $ATLAS_PUBLIC. Under the committed register, where no row is
signed, the same first command fetches nothing; the demo shows that too. The release is given
no spot values to meet: the real one (cpi_yoy for June 2022 is 9.1) is a published figure, and
invented values do not meet it.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))

from atlas.capture.cli import main as capture
from atlas.publish.run import release
from atlas.rights import load_register
from atlas.vintage.cli import main as replay

ROWS = ("bls", "treasury-fiscal-data", "fed-board", "imf", "bea", "eia")
SHOW = ("debt", "receipts", "gs10", "fedfunds", "eurusd", "fedassets", "net_worth", "labor_share",
        "jp_cpi", "us_cpi", "tryusd", "ez_fx", "gdp", "saving", "trade_q", "wti", "gas", "elec_gen")


def said(command, arguments) -> tuple[int, list[str]]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        status = command(arguments)
    return status, out.getvalue().splitlines()


def run(directory: Path, keep: bool = False) -> int:
    store, root = directory / "store", directory / "public"
    table = load_register()
    for row in table["rows"]:
        if row["id"] in ROWS:
            row["decision"] = {"display": True, "redistribute": True, "store": True, "ml_use": True,
                               "signed_by": "Alex", "signed_on": "2026-11-11"}
    # The gate takes only a decision that names Alex, so the demo's copy names him, as the
    # tests' registers do. It is not his decision, and the file says so where it is read first.
    table["about"] = ("A DEMO COPY written by fixtures/capture/demo.py. The decisions on the bls, "
                      "treasury-fiscal-data, fed-board, imf, bea and eia rows are not Alex's. " + table["about"])
    register = directory / "register-signed-for-the-demo.json"
    register.write_text(json.dumps(table))
    spots = directory / "no-spots.json"
    spots.write_text(json.dumps({"format": 1, "about": "none: the values are invented", "spots": []}))

    status, lines = said(capture, ["--store", str(directory / "refused"), "--replay", str(HERE)])
    print(f"1. Under the committed register: atlas capture exits {status}. {lines[-1]}")

    status, lines = said(capture, ["--store", str(store), "--register", str(register), "--replay", str(HERE)])
    print(f"\n2. With the six rows signed for the demo: {lines[-1].split(' into ')[0]}.")
    if status:
        return status
    status, lines = said(replay, ["--store", str(store), "--register", str(register)])
    recorded = [line for line in lines if ": first capture" in line]
    print(f"\n3. atlas replay recorded {len(recorded)} Series. Some of them:")
    for line in recorded:
        if line.split()[0] in SHOW:
            print(f"   {line}")
    if status:
        return status
    result = release(profile="public", root=root, store=store, register=register, spot=spots)
    print(f"\n4. atlas release --profile public: {result.lines[-2].strip() if len(result.lines) > 1 else result.lines[-1]}")
    if result.exit_code:
        print("\n".join(result.lines))
        return result.exit_code
    current = root / "releases" / (root / "CURRENT").read_text().strip()
    manifest = json.loads((current / "manifest.json").read_text())
    print("   Checks: " + "; ".join(f"{c['check']}: {c['outcome']}" for c in manifest["checks"]["report"]))
    for key in SHOW:
        series = json.loads((current / "series" / f"{key}.json").read_text())
        last = next(o for o in reversed(series["observations"]) if o["value"] is not None)
        print(f"   {key:12} {series['freq']:15} {series['period_start']} to {series['period_end']}"
              f"   last {last['period']} = {last['value']} (invented)")
    print(f"\nThe release is in {current}" if keep else
          "\nThe store and the release were in a temporary directory and are gone; --out DIR keeps them.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, help="keep the store and the release root here")
    args = parser.parse_args(argv)
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        return run(args.out, keep=True)
    with tempfile.TemporaryDirectory() as scratch:
        return run(Path(scratch))


if __name__ == "__main__":
    sys.exit(main())
