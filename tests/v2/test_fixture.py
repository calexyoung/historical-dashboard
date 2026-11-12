"""The committed fixture release is what its script writes, and holds nothing from v1's sources."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "fixtures" / "public"


def _tree(root: Path) -> dict:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_the_committed_fixture_is_what_the_script_writes(tmp_path):
    spec = importlib.util.spec_from_file_location("make_fixture", ROOT / "fixtures" / "make_fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.build(tmp_path)
    assert _tree(tmp_path) == _tree(FIXTURE_ROOT)


def test_current_names_a_release_that_exists():
    release_id = (FIXTURE_ROOT / "CURRENT").read_text().strip()
    assert (FIXTURE_ROOT / "releases" / release_id / "manifest.json").is_file()


def test_the_fixture_holds_only_synthetic_data():
    # PLAN 6.1: CI previews, screenshots and logs use only the fixture, so it must never carry
    # anything that came through FRED or Yahoo.
    release_id = (FIXTURE_ROOT / "CURRENT").read_text().strip()
    release = FIXTURE_ROOT / "releases" / release_id
    catalog = json.loads((release / "catalog.json").read_text())["series"]
    for entry in catalog:
        assert entry["source"]["origin"]["producer"] == "Macro Atlas fixture (synthetic)"
        assert entry["source"]["channel"]["via"] in ("fixture", "fixture_vendor")
        assert entry["representation"] == "native"
    text = "".join(p.read_text().lower() for p in release.rglob("*.json"))
    for word in ("fred", "yahoo", "stlouisfed", "legacy_monthly_rounded"):
        assert word not in text


def _module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_fixture_claim_is_a_claim_and_its_lock_is_the_lock_of_it():
    # M20: the fixture's one Claim is invented; its lock must still be a real lock of it.
    from atlas.content import claims as K

    make = _module("make_fixture", ROOT / "fixtures" / "make_fixture.py")
    claim, problems = K.read_claim(K.serialise(make.CLAIM).encode("utf-8"), f"{make.CLAIM_ID}.md")
    assert problems == [] and claim == make.CLAIM
    assert K.own_terms(claim) == {}
    path = ROOT / "fixtures" / "claims" / "locks" / make.LOCK_NAME
    lock, problems = K.read_lock(path.read_bytes(), path.name)
    assert problems == [] and K.stale(claim, [lock]) is None
    assert make.RECORD_FIELDS == K.RECORD_FIELDS and make.canonical(claim) == K.canonical(claim)
    assert K.new_york_day(lock["locked_at"]) == claim["checked_on"]


def test_the_fixture_lock_and_latest_rows_are_what_the_engine_answers_today():
    # The numbers in the fixture are the engine's, not typed in: if the engine's semantics
    # change, this says so, and `python fixtures/claims/make_claim.py` writes them again.
    generator = _module("make_claim", ROOT / "fixtures" / "claims" / "make_claim.py")
    lock, latest = generator.documents()
    make = generator.fixture_module()
    assert lock == (ROOT / "fixtures" / "claims" / "locks" / make.LOCK_NAME).read_bytes()
    assert latest == (ROOT / "fixtures" / "claims" / "latest.json").read_bytes()
    # What was public then is not what the Release holds: November was 109.5 preliminary, and is 109.3.
    first = json.loads(lock)["readings"][0]
    assert first["then"]["figures"][0]["value"] == 109.5 and first["now_when_checked"]["figures"][0]["value"] == 109.3


def test_the_fixture_bulk_files_hold_what_the_bulk_writer_gives():
    # M25: the committed bulk files are the real writer's, over the fixture's own Series. They
    # are compared by their rows: compressed bytes may differ from one machine's zlib to another's.
    from atlas.publish import bulk as B
    from atlas.release import load_release, validate_release

    make = _module("make_bulk", ROOT / "fixtures" / "bulk" / "make_bulk.py")
    fresh = make.documents()
    committed = {path.name: path.read_bytes() for path in (ROOT / "fixtures" / "bulk" / "downloads").iterdir()}
    assert sorted(fresh) == sorted(committed)
    for name in sorted(set(fresh) - {"datapackage.json"}):
        assert B.read_table(name, committed[name]) == B.read_table(name, fresh[name]), name

    def described(data: bytes) -> dict:
        package = json.loads(data)
        package["resources"] = [{k: v for k, v in r.items() if k not in ("bytes", "hash")} for r in package["resources"]]
        return package

    assert described(committed["datapackage.json"]) == described(fresh["datapackage.json"])
    release = FIXTURE_ROOT / "releases" / (FIXTURE_ROOT / "CURRENT").read_text().strip()
    assert validate_release(release) == []
    files = load_release(release)
    assert B.problems(files, make.gate(make.fixture_module())) == []
    # The Withheld Series is in the Catalog by name and in no bulk file.
    keys = {row[0] for name in committed if name != "datapackage.json" for row in B.read_table(name, committed[name])}
    assert "fx_exchange_index" not in keys and "fx_price_index" in keys
