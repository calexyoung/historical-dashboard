"""``atlas-core verify`` (PLAN M11, 4.2, 4.4 step 4; ADR 0002, ADR 0003): the Node step of the
publisher. It computes Derived series into a staged Release and writes nowhere else.

Run here as the publisher runs it: plain ``node`` on ``packages/core/bin/atlas-core.mjs``, with
no ``node_modules``. The staged Release is the committed fixture's own Catalog and Series
(invented values), whose Derived series ``make_fixture.py`` wrote with the plain formula."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "packages" / "core" / "bin" / "atlas-core.mjs"
FIXTURE = ROOT / "fixtures" / "public" / "releases" / "20260101T000000Z-0000000"
YOY = "fx_price_index_yoy"


def staged(directory: Path, keys=(YOY,), catalog=None) -> Path:
    """What Python hands the step: the Catalog, the stored Series and the list to compute."""
    directory.mkdir(parents=True)
    shutil.copytree(FIXTURE / "series", directory / "series")
    document = catalog or json.loads((FIXTURE / "catalog.json").read_text())
    (directory / "catalog.json").write_text(json.dumps(document))
    (directory / "engine-request.json").write_text(json.dumps({"format": 1, "materialise": list(keys)}))
    return directory


def verify(directory: Path, *more: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(CLI), "verify", "--release", str(directory), *more],
                          capture_output=True, text=True, cwd=cwd or directory, timeout=120, check=False)


def tree(directory: Path) -> dict[str, str]:
    """Every file and link under a directory, with what it holds."""
    found = {}
    for path in sorted(directory.rglob("*")):
        name = path.relative_to(directory).as_posix()
        if path.is_symlink():
            found[name] = f"link to {os.readlink(path)}"
        elif path.is_file():
            found[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return found


def report(directory: Path) -> dict:
    return json.loads((directory / "engine-report.json").read_text())


def recipe_entry(catalog: dict, key: str, recipe: dict, **more) -> dict:
    """A recipe entry shaped like the fixture's own Derived series."""
    template = next(e for e in catalog["series"] if e["key"] == YOY)
    entry = {**json.loads(json.dumps(template)), "key": key, "recipe": recipe, **more}
    catalog["series"].append(entry)
    return entry


def test_it_computes_the_fixtures_derived_series_exactly_as_the_plain_formula_does(tmp_path):
    directory = staged(tmp_path / "staged")

    done = verify(directory)

    assert done.returncode == 0, done.stderr
    written = json.loads((directory / "derived" / f"{YOY}.json").read_text())
    assert written == json.loads((FIXTURE / "derived" / f"{YOY}.json").read_text())
    said = report(directory)
    assert said["semantics_version"] == "0.7.0"
    assert said["derived"][YOY]["sha256"] == hashlib.sha256((directory / "derived" / f"{YOY}.json").read_bytes()).hexdigest()
    assert said["derived"][YOY]["rights_status"] == "public_domain"
    assert said["empty"] == []
    assert all(check["outcome"] != "fail" for check in said["checks"])


def test_it_writes_only_inside_the_staged_release(tmp_path):
    directory = staged(tmp_path / "root" / ".staging" / "engine-1")
    for other in ("root/releases/20260101T000000Z-0000000/manifest.json", "store/obslog/x.parquet", "elsewhere/note.txt"):
        path = tmp_path / other
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("as it was")
    before = tree(tmp_path)

    done = verify(directory, cwd=tmp_path / "elsewhere")

    assert done.returncode == 0, done.stderr
    after = tree(tmp_path)
    new = sorted(set(after) - set(before))
    assert new == ["root/.staging/engine-1/derived/fx_price_index_yoy.json", "root/.staging/engine-1/engine-report.json"]
    assert {name: after[name] for name in before} == before


def test_it_computes_only_what_it_is_asked_for(tmp_path):
    """A local Release also holds v1's Derived series, which stay as v1 computed them."""
    catalog = json.loads((FIXTURE / "catalog.json").read_text())
    recipe_entry(catalog, "fx_not_asked", {"op": "pct_change", "inputs": ["fx_price_index"], "order": "aggregate_then_compute", "params": {"lag": 1}})
    directory = staged(tmp_path / "staged", catalog=catalog)

    assert verify(directory).returncode == 0
    assert sorted(p.name for p in (directory / "derived").iterdir()) == [f"{YOY}.json"]


def test_a_cyclic_recipe_fails_with_the_cycle_named(tmp_path):
    catalog = json.loads((FIXTURE / "catalog.json").read_text())
    recipe_entry(catalog, "fx_a", {"op": "pct_change", "inputs": ["fx_b"], "order": "aggregate_then_compute", "params": {"lag": 1}})
    recipe_entry(catalog, "fx_b", {"op": "ratio", "inputs": ["fx_price_index", "fx_a"], "order": "aggregate_then_compute"})
    directory = staged(tmp_path / "staged", keys=("fx_a",), catalog=catalog)

    done = verify(directory)

    assert done.returncode == 1
    assert "fx_a → fx_b → fx_a" in done.stderr
    failed = [check for check in report(directory)["checks"] if check["outcome"] == "fail"]
    assert len(failed) == 1 and "fx_a → fx_b → fx_a" in failed[0]["detail"]
    assert not (directory / "derived" / "fx_a.json").exists()


def test_a_recipe_with_no_value_is_reported_empty_not_written(tmp_path):
    catalog = json.loads((FIXTURE / "catalog.json").read_text())
    recipe_entry(catalog, "fx_long", {"op": "pct_change", "inputs": ["fx_price_index"], "order": "aggregate_then_compute", "params": {"lag": 600}})
    directory = staged(tmp_path / "staged", keys=("fx_long", YOY), catalog=catalog)

    done = verify(directory)

    assert done.returncode == 0, done.stderr
    assert [row["key"] for row in report(directory)["empty"]] == ["fx_long"]
    assert sorted(p.name for p in (directory / "derived").iterdir()) == [f"{YOY}.json"]


def test_the_catalog_must_give_a_derived_series_the_most_restrictive_rights_of_its_inputs(tmp_path):
    catalog = json.loads((FIXTURE / "catalog.json").read_text())
    recipe_entry(catalog, "fx_poverty_change", {"op": "pct_change", "inputs": ["fx_poverty_rate_annual"], "order": "aggregate_then_compute", "params": {"lag": 1}}, freq="annual")
    directory = staged(tmp_path / "staged", keys=("fx_poverty_change",), catalog=catalog)

    done = verify(directory)

    assert done.returncode == 1
    assert "citation_required" in done.stderr and "fx_poverty_change" in done.stderr


def test_it_refuses_to_write_through_a_link_or_over_a_file(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    linked = staged(tmp_path / "linked")
    (linked / "derived").symlink_to(outside, target_is_directory=True)
    assert verify(linked).returncode == 1
    assert list(outside.iterdir()) == []

    occupied = staged(tmp_path / "occupied")
    (occupied / "derived").mkdir()
    target = tmp_path / "target.json"
    target.write_text("as it was")
    (occupied / "derived" / f"{YOY}.json").symlink_to(target)
    assert verify(occupied).returncode == 1
    assert target.read_text() == "as it was"

    reported = staged(tmp_path / "reported")
    (reported / "engine-report.json").symlink_to(target)
    assert verify(reported).returncode == 1
    assert target.read_text() == "as it was"


def spot_file(path: Path, *spots) -> Path:
    path.write_text(json.dumps({"format": 1, "spots": [
        {"key": key, "period": period, "value": value, "tolerance": tolerance, "source": "the fixture's own table"}
        for key, period, value, tolerance in spots]}))
    return path


def test_spot_values_are_checked_against_independent_figures(tmp_path):
    # fixtures/make_fixture.py: January 2025 is 105.0 against 100.0 a year before.
    right = spot_file(tmp_path / "right.json", (YOY, "2025-01", 5.0, 0.001), ("fx_absent", "2025-01", 1.0, 0.1), (YOY, "1999-01", 1.0, 0.1))
    directory = staged(tmp_path / "right")
    done = verify(directory, "--spot", str(right))
    assert done.returncode == 0, done.stderr
    outcomes = sorted((c["check"], c["outcome"]) for c in report(directory)["checks"] if c["check"].startswith("spot"))
    assert outcomes == [("spot value: fx_absent 2025-01", "not_checked"), ("spot value: fx_price_index_yoy 1999-01", "not_checked"),
                        ("spot value: fx_price_index_yoy 2025-01", "pass")]

    wrong = spot_file(tmp_path / "wrong.json", (YOY, "2025-01", 5.2, 0.05))
    done = verify(staged(tmp_path / "wrong"), "--spot", str(wrong))
    assert done.returncode == 1
    assert "fx_price_index_yoy 2025-01" in done.stderr and "5.2" in done.stderr


@pytest.mark.parametrize("arguments", [[], ["verify"], ["verify", "--release"], ["publish", "--release", "x"],
                                       ["verify", "--release", "/nonexistent/atlas-core-test"]])
def test_a_command_it_cannot_follow_changes_nothing(arguments):
    done = subprocess.run(["node", str(CLI), *arguments], capture_output=True, text=True, timeout=120, check=False)
    assert done.returncode == 2
    assert "atlas-core verify --release" in done.stderr


def test_the_committed_spot_file_names_the_published_cpi_figure():
    spots = json.loads((ROOT / "checks" / "spot.json").read_text())["spots"]
    cpi = next(s for s in spots if (s["key"], s["period"]) == ("cpi_yoy", "2022-06"))
    assert cpi["value"] == 9.1 and cpi["tolerance"] <= 0.05 and cpi["url"].startswith("https://www.bls.gov/")
