"""See a Claim go from a file to locked evidence, and a Revision show up as drift, in a
temporary directory (PLAN M20; ADR 0034; docs/method/claims.md):

    python fixtures/release/claim_demo.py            # print what happens
    python fixtures/release/claim_demo.py --out DIR  # keep the store, the root and the content in DIR

Everything is invented: the Series and their values are M8's three recorded fetches of a
made-up Origin, and the claimant, the venue and the words are made up here. Nothing is asked
of the network. It runs the real commands on a local-profile root: a release after the first
fetch; ``atlas claims compute`` (the engine computes the rows: Node 22.18 or later); a second
fetch that revises January; a release, which recomputes only the *latest* row and reports the
drift; and ``atlas claims relock``.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
VINTAGE = ROOT / "fixtures" / "vintage"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(VINTAGE))

from make_fixtures import register

from atlas.capture.cli import main as capture
from atlas.cli import main as atlas
from atlas.content import claims as K
from atlas.vintage.cli import main as replay

CLAIM_ID = "2026-03-11-an-invented-official-on-invented-jobs"


def quietly(command, arguments) -> int:
    with contextlib.redirect_stdout(io.StringIO()):
        return command(arguments)


def claim(checked_on: str) -> dict:
    return {
        "id": CLAIM_ID,
        "claimant": {"name": "An Invented Official", "role": "Secretary of Examples (invented)", "party": "none"},
        "said_on": "2026-03-11", "venue": "A press conference that did not happen",
        "sources": [
            {"name": "Invented recording", "url": "https://video.example.org/briefing",
             "archive_url": "https://example.org/archive/briefing", "locator": "at 12:40", "kind": "recording"},
            {"name": "Invented transcript", "url": "https://example.org/transcript",
             "archive_url": "https://example.org/archive/transcript", "locator": "paragraph 9", "kind": "transcript"}],
        "readings": [
            {"id": "jobs-in-january", "series": "fx_jobs", "transform": "lin", "measure": "value_at", "period": "2026-01"},
            {"id": "rise-to-february", "series": "fx_jobs", "transform": "lin", "measure": "change",
             "window": {"from": "2026-01-01", "to": "2026-02-28"}}],
        "readings_not_measured": ["Invented jobs per point of the invented price index."],
        "selection_note": "Written by the demo to show the commands.",
        "checked_on": checked_on, "corrections": [], "topics": [], "status": "draft",
        "quote": "There were 150 thousand invented jobs in January, and more in February.",
    }


def figures(row: dict) -> str:
    if "unavailable" in row:
        return f"unavailable ({row['unavailable']['reason']})"
    return ", ".join(f"{f['name']} {f['value']:g}" + (f" [{f['period']}, {f['status']}]" if "period" in f else "")
                     for f in row["figures"] if f["value"] is not None)


def rows(root: Path, version: int) -> None:
    lock = json.loads((root / "locks" / K.lock_name(CLAIM_ID, version)).read_text())
    release = root / "releases" / (root / "CURRENT").read_text().strip()
    latest = {}
    if (release / "evidence" / "latest.json").exists():
        (entry,) = json.loads((release / "evidence" / "latest.json").read_text())["claims"]
        latest = {reading["id"]: reading for reading in entry["readings"]}
    for reading in lock["readings"]:
        print(f"  {reading['id']} ({reading['series']}, {reading['measure']})")
        print(f"    then              {figures(reading['then'])}   basis: {reading['then']['basis']}, "
              f"cutoff {reading['then']['cutoff']['instant']}")
        print(f"    now when checked  {figures(reading['now_when_checked'])}   (lock v{lock['version']}, "
              f"release {lock['release']['release_id']})")
        now = latest.get(reading["id"])
        if now:
            print(f"    latest            {figures(now['latest'])}   (release {release.name})")
            for drift in now["drift"]:
                print(f"      drift: {drift['kind']} {drift['figure']} {drift['field']}: {drift['locked']} -> {drift['now']}")


def run(directory: Path) -> int:
    store, root, content = directory / "store", directory / "local", directory / "content"
    table = directory / "register.json"
    table.write_text(json.dumps(register()))
    common = ["--profile", "local", "--out", str(root), "--store", str(store), "--register", str(table)]
    release = ["release", *common, "--no-legacy", "--series", str(VINTAGE / "series.json"), "--content", str(content),
               "--manual", str(directory / "no-manual")]
    today = K.new_york_day(datetime.now(UTC))

    def fetch(name: str) -> bool:
        return not (quietly(capture, ["--store", str(store), "--register", str(table), "--replay", str(VINTAGE / "three-fetch" / name)])
                    or quietly(replay, ["--store", str(store), "--register", str(table), "--series", str(VINTAGE / "series.json")]))

    print("=== the first fetch (10 March 2026): jobs are 150000 for January, preliminary ===")
    if not fetch("1-initial") or quietly(atlas, release):
        return 1
    (content / "claims").mkdir(parents=True)
    (content / "claims" / f"{CLAIM_ID}.md").write_text(K.serialise(claim(today)), encoding="utf-8")
    print(f"\n=== a draft Claim: {content / 'claims' / (CLAIM_ID + '.md')} ===")
    print((content / "claims" / f"{CLAIM_ID}.md").read_text())
    print("=== atlas claims compute (the engine computes then and now when checked; the lock freezes them) ===")
    if atlas(["claims", "compute", CLAIM_ID, *common, "--content", str(content)]):
        return 1
    rows(root, 1)
    print("\n=== the second fetch (10 April 2026) revises January to 150010, final; atlas release ===")
    if not fetch("2-revision") or atlas(release):
        return 1
    print("\n=== the lock is the bytes it was; only the latest row moved ===")
    rows(root, 1)
    print("\n=== atlas claims relock --reason (a new version beside the old; v1 is never edited) ===")
    if atlas(["claims", "relock", CLAIM_ID, *common, "--content", str(content), "--reason", "January was revised."]):
        return 1
    quietly(atlas, [*release, "--reuse-data"])
    rows(root, 2)
    print("\n=== atlas claims list ===")
    return atlas(["claims", "list", *common, "--content", str(content)])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", help="keep everything in this (empty or new) directory")
    args = parser.parse_args()
    if args.out:
        Path(args.out).mkdir(parents=True, exist_ok=True)
        return run(Path(args.out))
    with tempfile.TemporaryDirectory() as tmp:
        return run(Path(tmp))


if __name__ == "__main__":
    sys.exit(main())
