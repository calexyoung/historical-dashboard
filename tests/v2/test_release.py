"""The release contract, Python side: the fixture validates and each rule has a failing case.

The cases live in checks/release-cases.json and are also run by Vitest, so the two validators
agree on what a valid Release is (PLAN section 9, 'Release contract').
"""
import copy
import hashlib
import json
from pathlib import Path

import pytest

from atlas.release import load_release, search_document, validate_files, validate_release

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "fixtures" / "public"
RELEASE_ID = (FIXTURE_ROOT / "CURRENT").read_text().strip()
FIXTURE = FIXTURE_ROOT / "releases" / RELEASE_ID
CASES = json.loads((ROOT / "checks" / "release-cases.json").read_text())["cases"]


def _edit(doc, path, value=None, delete=False):
    target = doc
    for step in path[:-1]:
        target = target[step]
    if delete:
        del target[path[-1]]
    else:
        target[path[-1]] = value


def apply_case(case, files, release_id):
    """Apply a case's steps to a copy of the fixture; returns (release_id, files)."""
    files = dict(files)
    for step in case["steps"]:
        op = step["op"]
        if op in ("set", "delete"):
            doc = json.loads(files[step["file"]])
            _edit(doc, step["path"], copy.deepcopy(step.get("value")), delete=op == "delete")
            files[step["file"]] = json.dumps(doc).encode()
        elif op == "remove_file":
            del files[step["file"]]
        elif op == "copy_file":
            files[step["to"]] = files[step["from"]]
        elif op == "move_file":
            files[step["to"]] = files.pop(step["from"])
        elif op == "raw":
            files[step["file"]] = step["text"].encode()
        elif op == "rename_release":
            release_id = step["id"]
        elif op == "project_search":
            # search.json written again as the projection: for a case about another rule that
            # changes what the index is made from.
            read = lambda path: json.loads(files[path]) if path in files else None
            files["search.json"] = json.dumps(search_document(
                read("catalog.json"), read("manifest.json")["withheld"], read("content/events.json"),
                read("content/claims.json"), read("content/topics.json"))).encode()
        else:
            raise AssertionError(f"unknown step {op}")
    if case.get("rehash", True) and "manifest.json" in files:
        manifest = json.loads(files["manifest.json"])
        for key, row in manifest.get("series", {}).items():
            for folder in ("series", "derived"):
                data = files.get(f"{folder}/{key}.json")
                if data is not None:
                    row["sha256"] = hashlib.sha256(data).hexdigest()
            history = files.get(f"vintages/{key}.json")
            if history is not None and "vintages_sha256" in row:
                row["vintages_sha256"] = hashlib.sha256(history).hexdigest()
        files["manifest.json"] = json.dumps(manifest).encode()
    return release_id, files


def test_the_fixture_release_is_valid():
    assert validate_release(FIXTURE) == []


def test_the_fixture_holds_the_shapes_track_a_needs():
    # M0 acceptance: a sparse quarterly series, an annual series and a held (step) series.
    catalog = {e["key"]: e for e in json.loads((FIXTURE / "catalog.json").read_text())["series"]}
    assert catalog["fx_output_quarterly"]["freq"] == "quarterly"
    assert catalog["fx_poverty_rate_annual"]["freq"] == "annual"
    assert catalog["fx_vote_margin"]["continuity"] == "held"
    quarterly = json.loads((FIXTURE / "series" / "fx_output_quarterly.json").read_text())
    gaps = [o["period"] for o in quarterly["observations"] if o["status"] == "missing"]
    assert gaps == ["2023-Q3"], "the gap is an explicit observation, not an omitted period"
    assert len(quarterly["observations"]) == 16  # one per quarter, never spread over months
    manifest = json.loads((FIXTURE / "manifest.json").read_text())
    assert manifest["profile"] == "public"
    assert [w["key"] for w in manifest["withheld"]] == ["fx_exchange_index"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_shared_cases(case):
    release_id, files = apply_case(case, load_release(FIXTURE), RELEASE_ID)
    issues = validate_files(release_id, files)
    assert sorted({i.code for i in issues}) == sorted(case["expect"]), [str(i) for i in issues]


def test_an_issue_says_where_and_what():
    _, files = apply_case(
        {"steps": [{"op": "delete", "file": "series/fx_price_index.json", "path": ["observations", 5]}]},
        load_release(FIXTURE),
        RELEASE_ID,
    )
    (issue,) = validate_files(RELEASE_ID, files)
    assert issue.code == "implicit_gap"
    assert issue.path == "series/fx_price_index.json"
    assert "2024-06" in issue.message


def test_a_directory_that_is_not_a_release_is_reported_not_raised(tmp_path):
    empty = tmp_path / RELEASE_ID
    empty.mkdir()
    assert {i.code for i in validate_release(empty)} == {"missing_file"}
    assert {i.code for i in validate_release(tmp_path / "nowhere")} == {"missing_file"}
