"""See the release writer work on the vintage fixture, in a temporary directory:

    python fixtures/release/demo.py            # print what happens
    python fixtures/release/demo.py --out DIR  # keep the store and the release root in DIR

It runs the real capture kit over M8's three recorded fetches (invented values of a made-up
Origin; nothing is asked of the network), replays them into a vintage store, and then runs the
real commands: a public-profile release, a second one that withholds a Series, a rollback, and
the production preflight, which refuses the root because its values are invented and the
committed rights register signs nothing. The register the releases are decided under is the
fixture's own test table, which is why they may be written at all, and why they can never be
written into $ATLAS_PUBLIC.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import io
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VINTAGE = ROOT / "fixtures" / "vintage"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(VINTAGE))

from make_fixtures import FETCHES, register

from atlas.capture.cli import main as capture
from atlas.cli import main as atlas
from atlas.vintage.cli import main as replay


def quietly(command, arguments) -> int:
    with contextlib.redirect_stdout(io.StringIO()):
        return command(arguments)


def run(directory: Path, *, quiet: bool = False) -> int:
    store, root = directory / "store", directory / "public"
    table, narrowed = directory / "register.json", directory / "register-prices-only.json"
    table.write_text(json.dumps(register()))
    prices_only = copy.deepcopy(register())
    prices_only["rows"][0]["datasets"] = ["fixture prices"]
    narrowed.write_text(json.dumps(prices_only))
    for name, _began, _series in FETCHES:
        if quietly(capture, ["--store", str(store), "--register", str(table),
                             "--replay", str(VINTAGE / "three-fetch" / name)]):
            return 1
    if quietly(replay, ["--store", str(store), "--register", str(table),
                        "--series", str(VINTAGE / "series.json")]):
        return 1
    common = ["--profile", "public", "--out", str(root), "--store", str(store)]
    series = ["--series", str(VINTAGE / "series.json")]
    say = (lambda text: None) if quiet else print
    step = quietly if quiet else (lambda command, arguments: command(arguments))

    say("=== atlas release --profile public (both Series' datasets are signed in the test register) ===")
    if step(atlas, ["release", *common, "--register", str(table), *series]):
        return 1
    first = (root / "CURRENT").read_text().strip()
    if quiet:
        return 0
    manifest = json.loads((root / "releases" / first / "manifest.json").read_text())
    print(f"  series: {', '.join(manifest['series'])}; register signed: "
          f"{manifest['rights_register']['signed']}; sources: {manifest['sources']}")
    price = json.loads((root / "releases" / first / "series" / "fx_price.json").read_text())
    print("  fx_price:", [(o["period"], o["value"], o["status"]) for o in price["observations"]])

    print("\n=== the same store under a register that covers only the prices dataset ===")
    atlas(["release", *common, "--register", str(narrowed), *series])
    print("\n=== atlas rollback to the first release (refused: that register does not allow it) ===")
    atlas(["rollback", first, *common, "--register", str(narrowed)])
    print("\n=== atlas doctor (the root's health) ===")
    atlas(["doctor", "--root", str(root), "--store", str(store)])
    print("\n=== atlas doctor --surface production (the preflight, against the committed register) ===")
    atlas(["doctor", "--surface", "production", "--root", str(root)])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", help="keep everything in this (empty or new) directory")
    parser.add_argument("--quiet", action="store_true", help="write the first release and say nothing")
    args = parser.parse_args()
    if args.out:
        Path(args.out).mkdir(parents=True, exist_ok=True)
        return run(Path(args.out), quiet=args.quiet)
    with tempfile.TemporaryDirectory() as tmp:
        return run(Path(tmp))


if __name__ == "__main__":
    sys.exit(main())
