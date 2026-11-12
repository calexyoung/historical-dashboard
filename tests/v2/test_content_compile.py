"""The content compiler (PLAN M19; ADR 0033): Events and the hand-entered layers become a
Release's ``content/events.json`` and ``content/annotations.json``. Every Event, term and span
here is invented (fixtures/manual; the Events are written by the test)."""
import json
from pathlib import Path

import pytest

from atlas.content import events as E
from atlas.content.compile import ContentError, compile_content
from atlas.release import LEGACY
from atlas.rights import RightsGate

from .capture_helpers import origin_row, register

ROOT = Path(__file__).resolve().parents[2]
MANUAL = ROOT / "fixtures" / "manual" / "catalog" / "manual"
OFFICE = "Macro Atlas, from the public record"
COMMITTEE = "An Invented Dating Committee"

BASE = {"topics": [], "related_series": [], "description": "",
        "sources": [{"url": "https://example.org/a", "archive_url": "https://web.archive.org/web/2031/https://example.org/a"}]}
DAY = {**BASE, "id": "2031-02-03-an-act-is-signed", "date": "2031-02-03", "date_precision": "day",
       "title": "An Act is signed", "category": "legislation", "status": "public",
       "description": "The Act was signed on 3 February 2031."}
MONTH = {**BASE, "id": "2031-02-a-count-begins", "date": "2031-02", "date_precision": "month",
         "title": "A count begins", "category": "political", "status": "public"}
YEAR = {**BASE, "id": "2030-a-survey-year", "date": "2030", "date_precision": "year",
        "title": "A survey year", "category": "policy", "status": "public"}
SPAN = {**BASE, "id": "2031-03-10-a-storm", "date": "2031-03-10", "end": "2031-03-14", "date_precision": "day",
        "title": "A storm crosses the coast", "category": "disaster", "status": "public",
        "related_series": ["unrate"]}
DRAFT = {**BASE, "id": "2031-04-01-a-draft", "date": "2031-04-01", "date_precision": "day",
         "title": "Something not yet reviewed", "category": "financial", "status": "draft"}
SEEDED = "A seeded sentence that only the draft holds 7391."


def content(tmp_path: Path, *events: dict) -> Path:
    directory = tmp_path / "content"
    (directory / "events").mkdir(parents=True)
    for event in events:
        (directory / "events" / f"{event['id']}.md").write_text(E.serialise(event), encoding="utf-8")
    return directory


def gate(*signed: str) -> RightsGate:
    rows = [origin_row(f"row-{i}", origin, []) for i, origin in enumerate(signed)]
    return RightsGate(register(*rows))


def compiled(tmp_path, *events, profile="public", manual=None, signed=(), legacy=None):
    return compile_content(profile=profile, content=content(tmp_path, *events), manual=manual,
                           gate=gate(*signed), legacy_annotations=legacy)


def read(result, name: str) -> list[dict]:
    return json.loads(result.files[f"content/{name}.json"])[name]


# --- Events --------------------------------------------------------------------------------------


def test_a_public_release_holds_the_public_events_whole_and_in_order(tmp_path):
    result = compiled(tmp_path, DAY, MONTH, YEAR, SPAN)
    events = read(result, "events")
    assert [e["id"] for e in events] == [YEAR["id"], MONTH["id"], DAY["id"], SPAN["id"]]
    assert events[2] == DAY
    assert set(result.files) == {"content/events.json", "content/annotations.json"}


def test_each_event_is_projected_as_one_annotation_anchored_as_precisely_as_it_is_dated(tmp_path):
    by_id = {a["id"]: a for a in read(compiled(tmp_path, DAY, MONTH, YEAR, SPAN), "annotations")}
    assert by_id[f"event-{DAY['id']}"] == {
        "id": f"event-{DAY['id']}", "kind": "event", "anchor": {"type": "date", "date": "2031-02-03"},
        "label": "An Act is signed", "ref": f"content/events/{DAY['id']}.md", "source": DAY["sources"][0],
        "category": "legislation"}
    assert by_id[f"event-{MONTH['id']}"]["anchor"] == {"type": "period", "period": "2031-02"}  # no day is made up
    assert by_id[f"event-{YEAR['id']}"]["anchor"] == {"type": "period", "period": "2030"}
    assert by_id[f"event-{SPAN['id']}"]["anchor"] == {"type": "span", "start": "2031-03-10", "end": "2031-03-14"}
    assert "series" not in by_id[f"event-{SPAN['id']}"]  # related is not "belongs to"


def test_a_span_of_months_runs_from_the_first_day_to_the_last_and_says_its_precision(tmp_path):
    months = {**MONTH, "id": "2031-02-a-long-count", "end": "2031-04"}
    (annotation,) = read(compiled(tmp_path, months), "annotations")
    assert annotation["anchor"] == {"type": "span", "start": "2031-02-01", "end": "2031-04-30"}
    assert annotation["attributes"] == {"date_precision": "month"}


def test_a_draft_is_in_no_file_of_a_public_release_and_is_whole_in_a_local_one(tmp_path):
    draft = {**DRAFT, "description": SEEDED}
    public = compiled(tmp_path / "a", DAY, draft)
    assert [e["id"] for e in read(public, "events")] == [DAY["id"]]
    for body in public.files.values():
        assert b"7391" not in body and DRAFT["id"].encode() not in body
    local = compiled(tmp_path / "b", DAY, draft, profile="local")
    assert [(e["id"], e["status"]) for e in read(local, "events")] == [(DAY["id"], "public"), (DRAFT["id"], "draft")]
    assert f"event-{DRAFT['id']}" in {a["id"] for a in read(local, "annotations")}


def test_the_report_counts_what_was_left_out(tmp_path):
    result = compiled(tmp_path, DAY, DRAFT)
    (line,) = [row for row in result.report if row["check"] == "content"]
    assert line["outcome"] == "pass" and "1 Event" in line["detail"] and "1 draft left out" in line["detail"]


def test_a_writer_that_cannot_see_the_content_says_so_in_the_report(tmp_path):
    result = compile_content(profile="public", content=tmp_path / "nowhere", manual=None, gate=gate())
    assert read(result, "events") == [] and read(result, "annotations") == []
    (line,) = result.report
    assert line["outcome"] == "warn" and "no Event is in this Release" in line["detail"]


def test_a_file_that_is_not_an_event_stops_the_compiler_and_is_named(tmp_path):
    directory = content(tmp_path, DAY)
    (directory / "events" / "2031-05-05-broken.md").write_text("not an event\n", encoding="utf-8")
    with pytest.raises(ContentError, match="2031-05-05-broken.md"):
        compile_content(profile="local", content=directory, manual=None, gate=gate())


def test_a_public_event_that_hits_the_word_list_stops_a_public_release(tmp_path):
    loaded = {**DAY, "description": "Prices rose because the Act was signed."}
    with pytest.raises(ContentError, match="because"):
        compiled(tmp_path / "a", loaded)
    assert read(compiled(tmp_path / "b", {**loaded, "status": "draft"}), "events") == []


# --- terms of government and recessions, from hand-entered files -------------------------------------


def test_terms_become_governance_spans_that_say_where_they_came_from(tmp_path):
    spans = [a for a in read(compiled(tmp_path, manual=MANUAL, signed=(OFFICE, COMMITTEE)), "annotations")
             if a["kind"] == "governance"]
    assert [(a["id"], a["label"], a["anchor"]["start"], a["anchor"]["end"], a["category"], a["attributes"]) for a in spans] == [
        ("governance-invented_office-2017-02-01", "A. Example", "2017-02-01", "2021-01-31", "invented_office", {"party": "R"}),
        ("governance-invented_office-2021-02-01", "B. Sample", "2021-02-01", None, "invented_office", {"party": "D"}),
    ]
    assert spans[0]["source"] == {"name": "An Invented Office, Past keepers (invented)", "url": "https://office.invalid/history"}
    assert spans[0]["provenance"] == {"producer": OFFICE, "dataset": "Terms of government", "via": "hand_entered",
                                      "representation": "native"}


def test_dated_spans_become_recessions(tmp_path):
    spans = [a for a in read(compiled(tmp_path, manual=MANUAL, signed=(OFFICE, COMMITTEE)), "annotations")
             if a["kind"] == "recession"]
    assert [(a["id"], a["label"], a["anchor"]) for a in spans] == [
        ("recession-2018-03", "Invented recession", {"type": "span", "start": "2018-03-01", "end": "2018-11-30"}),
        ("recession-2022-07", "Invented recession", {"type": "span", "start": "2022-07-01", "end": "2023-03-31"}),
    ]
    assert spans[0]["provenance"]["producer"] == COMMITTEE


def test_a_public_release_leaves_out_a_layer_whose_origin_is_not_signed_and_says_so(tmp_path):
    result = compiled(tmp_path, manual=MANUAL, signed=(COMMITTEE,))
    kinds = {a["kind"] for a in read(result, "annotations")}
    assert kinds == {"recession"}
    (line,) = [row for row in result.report if row["check"] == "content: hand-entered layers"]
    assert line["outcome"] == "warn" and "invented-office" in line["detail"] and "not in the rights register" in line["detail"]
    assert b"A. Example" not in b"".join(result.files.values())


def test_a_local_release_asks_for_no_signature(tmp_path):
    kinds = {a["kind"] for a in read(compiled(tmp_path, profile="local", manual=MANUAL), "annotations")}
    assert kinds == {"governance", "recession"}


# --- v1's bands and recessions, on a local release only ---------------------------------------------


def v1_annotation(kind: str, category: str | None, start: str) -> dict:
    out = {"id": f"{kind}-{category or 'x'}-{start[:7]}", "kind": kind,
           "anchor": {"type": "span", "start": start, "end": "2009-01-31"}, "label": "v1", "ref": None, "source": None,
           "provenance": {"producer": "v1", "dataset": "v1", "via": "hand_entered", "representation": LEGACY}}
    return {**out, **({"category": category} if category else {})}


V1 = [v1_annotation("governance", "pres", "2001-01-01"), v1_annotation("governance", "invented_office", "2001-01-01"),
      v1_annotation("recession", None, "2008-01-01")]


def test_v1s_layers_are_never_part_of_a_public_release(tmp_path):
    with pytest.raises(ContentError, match="never part of a public"):
        compiled(tmp_path, legacy=V1)


def test_a_local_release_keeps_v1s_layers_where_no_hand_entered_file_has_the_set(tmp_path):
    kept = read(compiled(tmp_path, profile="local", legacy=V1), "annotations")
    assert [a["id"] for a in kept] == [a["id"] for a in V1]
    assert all(a["provenance"]["representation"] == LEGACY for a in kept)


def test_a_set_is_hand_entered_whole_or_v1s_whole_never_part_of_each(tmp_path):
    kept = read(compiled(tmp_path, profile="local", manual=MANUAL, legacy=V1), "annotations")
    assert [a["id"] for a in kept if a["provenance"]["representation"] == LEGACY] == ["governance-pres-2001-01"]
    assert {a["category"] for a in kept if a["kind"] == "governance"} == {"pres", "invented_office"}
    assert all(a["provenance"]["representation"] == "native" for a in kept if a["kind"] == "recession")


def test_an_event_from_v1s_projection_is_refused_events_come_from_files(tmp_path):
    event = {**v1_annotation("event", "policy", "2001-01-01"), "kind": "event"}
    with pytest.raises(ContentError, match="Events come from content/events"):
        compiled(tmp_path, profile="local", legacy=[event])
