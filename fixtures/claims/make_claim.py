"""Writes the fixture Claim's lock and latest rows (fixtures/claims/), from the engine's own
answers on the fixture release's Series (PLAN M20; ADR 0034).

    python fixtures/claims/make_claim.py && python fixtures/make_fixture.py

The Claim is the literal in fixtures/make_fixture.py: an invented official's invented words
about an invented index. Run this again when the engine's semantics change; the committed
files are held to what the engine answers by tests/v2/test_fixture.py.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from atlas.content import claims as K
from atlas.publish import engine

HERE = Path(__file__).resolve().parent
#: The instant the fixture Claim was "checked": half an hour after the fixture release, the
#: evening of 31 December 2025 in New York.
LOCKED_AT = "2026-01-01T00:30:00Z"


def fixture_module():
    spec = importlib.util.spec_from_file_location("make_fixture", ROOT / "fixtures" / "make_fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def documents() -> tuple[bytes, bytes]:
    """The lock's bytes and the latest rows' bytes, computed afresh."""
    make = fixture_module()
    claim = make.CLAIM
    with tempfile.TemporaryDirectory() as work:
        # The fixture's data files alone: what the engine reads. Nothing here is moved or changed.
        release = make.build(Path(work) / "root", claims=False)
        spec = {name: claim[name] for name in ("said_on", "said_at", "checked_on", "readings") if name in claim}
        answer = engine.claim_evidence(release, make.RELEASE_ID, spec)
        if not answer["ok"]:
            raise SystemExit(answer["message"])
        lock = K.sealed({
            "format": 1, "claim_id": claim["id"], "version": 1, "locked_at": LOCKED_AT, "reason": None, "supersedes": None,
            "record": K.record(claim), "record_sha256": K.record_sha256(claim),
            "release": {"release_id": make.RELEASE_ID, "created": make.CREATED, "profile": "public"},
            "semantics_version": answer["semantics_version"], "rights_used": answer["rights_used"],
            "readings": answer["readings"]})
        body = K.lock_bytes(lock)
        files = {path.relative_to(release).as_posix(): path.read_bytes() for path in release.rglob("*") if path.is_file()}
        path = f"locks/{make.LOCK_NAME}"
        outcome = engine.run(Path(work) / "staging", {**files, path: body}, [], spot=HERE / "no-spots.json", claims=[path])
    return body, outcome.latest


if __name__ == "__main__":
    lock, latest = documents()
    (HERE / "locks").mkdir(exist_ok=True)
    name = fixture_module().LOCK_NAME
    (HERE / "locks" / name).write_bytes(lock)
    (HERE / "latest.json").write_bytes(latest)
    print(f"wrote {HERE / 'locks' / name} and {HERE / 'latest.json'}")
