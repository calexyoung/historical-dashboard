"""The release writer and the content compiler together (PLAN 4.3, 6.1 and M19; ADR 0033): what
of the content reaches a public Release, what a later register does to a Release already
written, and that a content-only Release is written afresh. Values and Events are invented."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from atlas.content import events as E
from atlas.publish import release
from atlas.publish import root as R
from atlas.release import load_release, validate_release
from atlas.rights import RightsGate

from .capture_helpers import origin_row
from .release_helpers import MAKE, NOW, ROOT, SERIES, all_bytes, build_store, current, read_json, write_register

MANUAL = ROOT / "fixtures" / "manual" / "catalog" / "manual"
OFFICE = "Macro Atlas, from the public record"
COMMITTEE = "An Invented Dating Committee"
SOURCE = [{"url": "https://example.org/a", "archive_url": "https://example.org/archive/a"}]
PUBLIC = {"id": "2026-02-03-an-act-is-signed", "date": "2026-02-03", "date_precision": "day",
          "title": "An Act is signed", "category": "legislation", "status": "public", "topics": [],
          "related_series": ["fx_not_a_series_here"], "sources": SOURCE, "description": "The Act was signed."}
DRAFT = {"id": "2026-03-04-a-draft-with-a-seed", "date": "2026-03-04", "date_precision": "day",
         "title": "A draft title seeded 4417", "category": "financial", "status": "draft", "topics": [],
         "related_series": [], "sources": SOURCE, "description": "A draft description seeded 9902."}


def write_content(directory: Path, *events: dict) -> Path:
    (directory / "events").mkdir(parents=True, exist_ok=True)
    for event in events:
        (directory / "events" / f"{event['id']}.md").write_text(E.serialise(event), encoding="utf-8")
    return directory


def table(*, office: bool = True, committee: bool = True) -> dict:
    out = copy.deepcopy(MAKE.register())
    out["rows"].append(origin_row("office", OFFICE, [], signed=office))
    out["rows"].append(origin_row("committee", COMMITTEE, [], signed=committee))
    return out


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json", table())


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


def publish(tmp_path, store, register, content, *, profile="public", root=None, **more):
    root = root or tmp_path / profile
    result = release(profile=profile, root=root, store=store, register=register, series=SERIES, now=NOW,
                     content=content, manual=MANUAL, legacy=False if profile == "local" else None, **more)
    return result, root


def test_a_public_release_holds_the_public_events_and_no_byte_of_a_draft(tmp_path, store, register):
    result, root = publish(tmp_path, store, register, write_content(tmp_path / "content", PUBLIC, DRAFT))
    assert result.exit_code == 0, result.lines
    directory = root / "releases" / current(root)
    assert validate_release(directory) == []
    assert [e["id"] for e in read_json(directory / "content" / "events.json")["events"]] == [PUBLIC["id"]]
    everything = all_bytes(root)
    for seed in (b"4417", b"9902", DRAFT["id"].encode()):
        assert seed not in everything
    report = {row["check"]: row for row in read_json(directory / "manifest.json")["checks"]["report"]}
    assert report["content"]["detail"] == "1 Event; 1 draft left out"


def test_a_local_release_holds_the_draft_and_says_it_is_one(tmp_path, store, register):
    result, root = publish(tmp_path, store, register, write_content(tmp_path / "content", PUBLIC, DRAFT), profile="local")
    assert result.exit_code == 0, result.lines
    events = read_json(root / "releases" / current(root) / "content" / "events.json")["events"]
    assert [(e["id"], e["status"]) for e in events] == [(PUBLIC["id"], "public"), (DRAFT["id"], "draft")]


def test_a_public_event_that_hits_the_word_list_refuses_the_release_and_current_stays(tmp_path, store, register):
    content = write_content(tmp_path / "content", PUBLIC)
    assert publish(tmp_path, store, register, content)[0].exit_code == 0
    before = current(tmp_path / "public")
    write_content(content, {**PUBLIC, "id": "2026-02-05-another", "date": "2026-02-05",
                            "description": "Prices rose because the Act was signed."})
    result, root = publish(tmp_path, store, register, content)
    assert result.exit_code == 1 and current(root) == before
    assert any("because" in line for line in result.lines)


def test_hand_entered_layers_are_published_with_their_origin_and_only_while_it_is_signed(tmp_path, store, register):
    content = write_content(tmp_path / "content", PUBLIC)
    result, root = publish(tmp_path, store, register, content)
    assert result.exit_code == 0, result.lines
    first = current(root)
    annotations = read_json(root / "releases" / first / "content" / "annotations.json")["annotations"]
    assert {a["kind"] for a in annotations} == {"event", "governance", "recession"}
    files = load_release(root / "releases" / first)
    assert R.rights_problems(files, RightsGate(table())) == []

    # The row is un-signed afterwards. The Release already written is now a problem...
    later = RightsGate(table(office=False))
    problems = R.rights_problems(files, later)
    assert problems and all("governance-invented_office" in p and "not signed" in p for p in problems)
    # ...and the next one leaves the layer out, by name.
    write_register(register, table(office=False))
    result, root = publish(tmp_path, store, register, content)
    assert result.exit_code == 0, result.lines
    directory = root / "releases" / current(root)
    assert {a["kind"] for a in read_json(directory / "content" / "annotations.json")["annotations"]} == {"event", "recession"}
    assert b"A. Example" not in all_bytes(directory)
    report = {row["check"]: row for row in read_json(directory / "manifest.json")["checks"]["report"]}
    assert report["content: hand-entered layers"]["outcome"] == "warn"


def test_a_typed_in_layer_that_does_not_say_where_it_came_from_is_a_rights_problem(tmp_path, store, register):
    result, root = publish(tmp_path, store, register, write_content(tmp_path / "content", PUBLIC))
    files = dict(load_release(root / "releases" / current(root)))
    document = json.loads(files["content/annotations.json"])
    for annotation in document["annotations"]:
        annotation.pop("provenance", None)
    files["content/annotations.json"] = json.dumps(document).encode()
    problems = R.rights_problems(files, RightsGate(table()))
    assert len(problems) == 4 and all("does not say where it came from" in p for p in problems)


def test_a_content_only_release_is_written_afresh_from_the_files(tmp_path, store, register):
    content = write_content(tmp_path / "content", PUBLIC)
    _, root = publish(tmp_path, store, register, content)
    first = current(root)
    write_content(content, {**DRAFT, "status": "public", "title": "A second Act is signed", "description": ""})
    (content / "events" / f"{PUBLIC['id']}.md").unlink()
    result, root = publish(tmp_path, store, register, content, reuse_data=True)
    assert result.exit_code == 0, result.lines
    directory = root / "releases" / current(root)
    assert current(root) != first and validate_release(directory) == []
    assert [e["title"] for e in read_json(directory / "content" / "events.json")["events"]] == ["A second Act is signed"]
    assert read_json(directory / "manifest.json")["reused_data_from"] == first
    assert PUBLIC["id"].encode() not in all_bytes(directory)


def test_a_release_of_the_repositorys_own_content_holds_v1s_48_public_events_and_none_of_the_35_drafts(tmp_path, store):
    register = write_register(tmp_path / "plain.json")
    result = release(profile="public", root=tmp_path / "public", store=store, register=register, series=SERIES, now=NOW)
    assert result.exit_code == 0, result.lines
    directory = tmp_path / "public" / "releases" / current(tmp_path / "public")
    events = read_json(directory / "content" / "events.json")["events"]
    assert len(events) == 48 and all(event["status"] == "public" for event in events)
    assert b"Taper tantrum" not in all_bytes(directory)
