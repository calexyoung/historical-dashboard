"""The headline Series and the search index of a Release (PLAN M22; ADR 0036): written by every
writer on every path (a fresh Release, a content-only one, a withdrawal, the legacy converter),
projections of the Release's own Catalog and content, and holding no value of any Series, a
Withheld one's least of all. Values, Events and Series here are invented, except where v1's
committed output is converted in a temporary directory; none of it is printed."""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest

from atlas import legacy
from atlas.catalog import check as C
from atlas.content import highlights as H
from atlas.publish import release, withdraw
from atlas.release import SEGMENTS, load_release, search_document, validate_release

from .release_helpers import NOW, ROOT, SERIES, all_bytes, build_store, current, fixture_table, read_json, write_register
from .test_publish_content import PUBLIC, DRAFT, write_content
from .test_publish_failures import JOBS

HOUR = timedelta(hours=1)


def declare(content: Path, **segments: list[str]) -> Path:
    content.mkdir(parents=True, exist_ok=True)
    (content / H.FILE).write_text(json.dumps({"segments": segments}), encoding="utf-8")
    return content


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


@pytest.fixture
def content(tmp_path) -> Path:
    return declare(write_content(tmp_path / "content", PUBLIC, DRAFT), economy_jobs=["fx_jobs", "fx_price", "fx_not_held"])


def publish(tmp_path, store, register, content, now=NOW, **more):
    root = tmp_path / "public"
    result = release(profile="public", root=root, store=store, register=register, series=SERIES, now=now,
                     content=content, **more)
    assert result.exit_code == 0, result.lines
    return root / "releases" / current(root)


def segments(directory: Path) -> dict[str, list[str]]:
    return {row["segment"]: row["series"] for row in read_json(directory / "content" / "highlights.json")["segments"]}


def entries(directory: Path) -> dict[tuple[str, str], dict]:
    return {(e["kind"], e["id"]): e for e in read_json(directory / "search.json")["entries"]}


def test_a_release_names_its_headline_series_by_segment_and_leaves_out_what_it_does_not_hold(tmp_path, store, register, content):
    directory = publish(tmp_path, store, register, content)
    assert validate_release(directory) == []
    held = segments(directory)
    assert list(held) == list(SEGMENTS)
    assert held["economy_jobs"] == ["fx_jobs", "fx_price"] and all(not keys for name, keys in held.items() if name != "economy_jobs")
    report = {row["check"]: row for row in read_json(directory / "manifest.json")["checks"]["report"]}
    assert report["content: headline series"]["outcome"] == "pass"
    assert "fx_not_held (not in this release)" in report["content: headline series"]["detail"]


def test_the_search_index_names_every_series_event_and_claim_of_the_release_and_no_draft(tmp_path, store, register, content):
    directory = publish(tmp_path, store, register, content)
    index = entries(directory)
    assert set(index) == {("series", "fx_jobs"), ("series", "fx_price"), ("event", PUBLIC["id"])}
    assert index[("series", "fx_price")]["title"] == "Fixture price index"
    assert index[("event", PUBLIC["id"])]["text"] == "The Act was signed."
    files = load_release(directory)
    assert json.loads(files["search.json"]) == search_document(
        json.loads(files["catalog.json"]), json.loads(files["manifest.json"])["withheld"],
        json.loads(files["content/events.json"]), json.loads(files["content/claims.json"]))
    for seed in (b"4417", b"9902", DRAFT["id"].encode()):          # the draft Event's seeds
        assert seed not in files["search.json"]


def test_the_search_index_of_a_public_release_holds_no_value_of_a_withheld_series(tmp_path, store, register, content):
    # The row is narrowed to the prices dataset: fx_jobs is held in the store and Withheld.
    write_register(register, fixture_table(datasets=["fixture prices"]))
    directory = publish(tmp_path, store, register, content)
    assert validate_release(directory) == []
    assert [row["key"] for row in read_json(directory / "manifest.json")["withheld"]] == ["fx_jobs"]
    index = entries(directory)
    assert index[("series", "fx_jobs")]["withheld"] is True and "withheld" not in index[("series", "fx_price")]
    # Named in both files, and not one of its values is in either, or anywhere in the Release.
    assert segments(directory)["economy_jobs"] == ["fx_jobs", "fx_price"]
    for path in ("search.json", "content/highlights.json"):
        body = (directory / path).read_bytes()
        assert b"fx_jobs" in body
        assert not any(value in body for value in JOBS)
    assert not any(value in all_bytes(directory) for value in JOBS)


def test_a_content_only_release_writes_both_files_afresh(tmp_path, store, register, content):
    first = publish(tmp_path, store, register, content)
    declare(content, economy_jobs=["fx_price"])
    (content / "events" / f"{PUBLIC['id']}.md").unlink()
    second = publish(tmp_path, store, register, content, now=NOW + HOUR, reuse_data=True)
    assert second != first and validate_release(second) == []
    assert segments(second)["economy_jobs"] == ["fx_price"]
    assert set(entries(second)) == {("series", "fx_jobs"), ("series", "fx_price")}


def test_a_withdrawal_marks_the_series_withheld_in_the_index_and_keeps_no_value(tmp_path, store, register, content):
    publish(tmp_path, store, register, content)
    root = tmp_path / "public"
    result = withdraw(key="fx_jobs", reason="wrong", profile="public", root=root, store=store, register=register,
                      now=NOW + HOUR, content=content)
    assert result.exit_code == 0, result.lines
    directory = root / "releases" / current(root)
    assert validate_release(directory) == []
    assert entries(directory)[("series", "fx_jobs")]["withheld"] is True
    assert not any(value in all_bytes(root) for value in JOBS)


def test_a_declaration_that_cannot_be_read_refuses_the_release(tmp_path, store, register, content):
    (content / H.FILE).write_text('{"segments": {"economy": ["fx_price"]}}', encoding="utf-8")
    result = release(profile="public", root=tmp_path / "public", store=store, register=register, series=SERIES,
                     now=NOW, content=content)
    assert result.exit_code == 1 and current(tmp_path / "public") is None
    assert any("economy is not a Segment" in line for line in result.lines)


def test_no_declaration_is_no_headline_series(tmp_path, store, register):
    directory = publish(tmp_path, store, register, write_content(tmp_path / "bare", PUBLIC))
    assert all(not keys for keys in segments(directory).values())


def test_the_legacy_converter_writes_both_files_from_the_repositorys_declaration():
    release_id, files = legacy.build_release(ROOT, NOW.replace(month=12))
    held = {row["segment"]: row["series"] for row in json.loads(files["content/highlights.json"])["segments"]}
    catalog = {entry["key"]: entry for entry in json.loads(files["catalog.json"])["series"]}
    assert held["economy_jobs"][0] == "unrate" and held["markets_money"][0] == "fedfunds"
    assert all(catalog[key]["segment"] == segment for segment, keys in held.items() for key in keys)
    index = json.loads(files["search.json"])["entries"]
    assert len(index) == len(catalog) + len(json.loads(files["content/events.json"])["events"]) + len(
        json.loads(files["content/claims.json"])["claims"])
    # Only the fields the contract names: none is made from an Observation.
    assert all(set(entry) <= {"kind", "id", "title", "text", "keywords", "withheld"} for entry in index)


# --- the declaration itself ---------------------------------------------------------------------------


def test_the_declaration_is_read_strictly():
    good, problems = H.read(b'{"segments": {"markets_money": ["a_key"], "economy_jobs": []}}')
    assert problems == [] and good == {"markets_money": ["a_key"], "economy_jobs": []}
    for body, said in (
            (b"not json", "not JSON"),
            (b'{"series": []}', "is not"),
            (b'{"segments": {"markets": ["a"]}}', "is not a Segment"),
            (b'{"segments": {"markets_money": ["Not A Key"]}}', "not a list of Series keys"),
            (b'{"segments": {"markets_money": ["a"], "economy_jobs": ["a"]}}', "more than once"),
            (b'{"segments": {"markets_money": ["a"], "markets_money": ["b"]}}', "not JSON")):
        _declared, problems = H.read(body)
        assert problems and said in problems[0], body


def test_atlas_check_holds_the_declaration_to_the_catalog(tmp_path):
    def layer(**declared):
        return C.check(content=declare(tmp_path / "content", **declared), notes=tmp_path / "notes").layers[-1]

    assert layer(economy_jobs=["unrate"], markets_money=["fedfunds"]).problems == []
    said = [p.message for p in layer(economy_jobs=["fedfunds", "fx_no_such_series"], markets_money=["ted"]).problems]
    assert any("fedfunds is listed under economy_jobs and the catalog puts it in markets_money" in s for s in said)
    assert any("fx_no_such_series, which is not in the catalog" in s for s in said)
    assert any("ted is retired" in s for s in said)


def test_the_repositorys_own_declaration_passes_atlas_check_and_names_all_six_segments():
    declared, problems, body = H.load(ROOT / "content")
    assert body is not None and problems == [] and set(declared) == set(SEGMENTS)
