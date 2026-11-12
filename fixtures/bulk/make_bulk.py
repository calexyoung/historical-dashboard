"""Writes the fixture release's bulk files (fixtures/bulk/downloads/), with the real bulk writer
over the fixture's own data files (PLAN M25; ADR 0039).

    python fixtures/bulk/make_bulk.py && python fixtures/make_fixture.py

Every value is the fixture's, and invented. The gate here is test data: one row for the made-up
Origin, decided for the purpose, so that the fixture has files a page and a test can serve. It
says nothing of what Alex has decided for any source. Run this again when the fixture's Series
or the bulk writer change; tests/v2/test_fixture.py holds the committed files to what the
writer gives, by their rows (compressed bytes may differ from one machine's zlib to another's).
"""
from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from atlas.publish import bulk as B
from atlas.release import load_release
from atlas.rights import RightsGate

HERE = Path(__file__).resolve().parent
OUT = HERE / "downloads"


def fixture_module():
    spec = importlib.util.spec_from_file_location("make_fixture", ROOT / "fixtures" / "make_fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def gate(make) -> RightsGate:
    """The fixture's Origin, permitted everything, and its second route cleared: invented
    values under an invented decision."""
    granted = {"display": True, "redistribute": True, "store": True, "ml_use": True,
               "signed_by": "Alex", "signed_on": "2026-01-01"}
    return RightsGate({
        "format": 1, "version": "fixture", "cleared_intermediaries": [],
        "rows": [{"id": "fixture", "kind": "origin", "origins": [make.SYNTHETIC_ORIGIN], "datasets": "*",
                  "decision": granted}]})


def documents() -> dict[str, bytes]:
    """The bulk files, by name, made afresh."""
    make = fixture_module()
    with tempfile.TemporaryDirectory() as work:
        release = make.build(Path(work) / "root", bulk=False)
        bulk = B.build(load_release(release), gate(make))
    files = {path[len(B.FOLDER) + 1:]: data for path, data in bulk.files.items()}
    files["datapackage.json"] = bulk.datapackage(make.RELEASE_ID, make.CREATED, {"version": "fixture", "sha256": None})
    return files


if __name__ == "__main__":
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for name, data in sorted(documents().items()):
        (OUT / name).write_bytes(data)
        print(OUT / name)
