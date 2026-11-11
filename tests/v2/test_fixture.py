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
