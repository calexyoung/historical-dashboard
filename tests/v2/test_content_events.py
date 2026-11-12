"""Events as files (PLAN 5 and M19): `content/events/{id}.md`, the word list, and the migration
of v1's 83 Events. The other side of each comparison is v1's own file (`atlas/events.yaml`) or a
list recorded before the migration (`checks/v1-event-ids.json`), never the code under test."""
import json
from pathlib import Path

import pytest
import yaml

from atlas.content import events as E
from atlas.content import wordlist as W

ROOT = Path(__file__).resolve().parents[2]
V1_EVENTS = yaml.safe_load((ROOT / "atlas" / "events.yaml").read_text(encoding="utf-8"))
RECORDED_IDS = json.loads((ROOT / "checks" / "v1-event-ids.json").read_text(encoding="utf-8"))["ids"]

EVENT = {
    "id": "2031-02-03-an-invented-act-is-signed",
    "date": "2031-02-03",
    "date_precision": "day",
    "title": "An invented Act is signed",
    "category": "legislation",
    "status": "draft",
    "topics": ["jobs"],
    "related_series": ["unrate"],
    "sources": [{"url": "https://example.org/act", "archive_url": "https://web.archive.org/web/2031/https://example.org/act"}],
}


def text_of(event: dict, body: str = "") -> str:
    return E.serialise({**event, "description": body})


def problems_of(text: str, name: str = "2031-02-03-an-invented-act-is-signed.md") -> list[str]:
    _, problems = E.read_event(text.encode("utf-8"), name)
    return problems


# --- one file ----------------------------------------------------------------------------------


def test_an_event_written_out_reads_back_the_same():
    body = "The Act was signed on 3 February 2031.\n\nIt has two titles."
    event, problems = E.read_event(text_of(EVENT, body).encode("utf-8"), f"{EVENT['id']}.md")
    assert problems == []
    assert event == {**EVENT, "description": body}


def test_a_title_with_quotes_dashes_and_a_colon_survives():
    title = "Draghi: 'whatever it takes' – \"all of it\" (0.25 → 5.25)"
    event, problems = E.read_event(text_of({**EVENT, "title": title}).encode("utf-8"), f"{EVENT['id']}.md")
    assert problems == [] and event["title"] == title


@pytest.mark.parametrize("change, said", [
    ({"finding": "misleading"}, "finding"),
    ({"category": "opinion"}, "category"),
    ({"status": "published"}, "status"),
    ({"sources": []}, "sources"),
    ({"sources": [{"url": "https://example.org/act"}]}, "sources/0"),
    ({"sources": [{"url": "http://example.org/act", "no_archive": "the page forbids archiving"}]}, "url"),
    ({"date": "2031-02-30"}, "not a day of the calendar"),
    ({"date": "2031-02"}, "date_precision"),
    ({"end": "2031-02-01"}, "ends before it starts"),
    ({"end": "2031-03"}, "the precision of its date"),
    ({"id": "2031-02-04-an-invented-act-is-signed"}, "does not start with its date"),
])
def test_what_is_not_an_event_is_refused_and_says_why(change, said):
    problems = problems_of(text_of({**EVENT, **change}), f"{change.get('id', EVENT['id'])}.md")
    assert problems and said in " ".join(problems)


def test_a_file_not_named_for_its_id_is_refused():
    assert "named" in " ".join(problems_of(text_of(EVENT), "something-else.md"))


def test_a_key_given_twice_or_a_bare_date_is_refused():
    text = text_of(EVENT)
    assert problems_of(text.replace('status: draft', 'status: draft\nstatus: public'))
    assert problems_of(text.replace('date: "2031-02-03"', "date: 2031-02-03"))  # YAML would make it a date object


def test_text_with_no_front_matter_is_refused():
    assert problems_of("An Act was signed.\n")


def test_an_event_that_spans_time_keeps_its_end_and_an_event_of_a_year_its_year():
    spanning = {**EVENT, "id": "2031-02-a-span", "date": "2031-02", "end": "2031-05", "date_precision": "month"}
    event, problems = E.read_event(text_of(spanning).encode(), "2031-02-a-span.md")
    assert problems == [] and (event["date"], event["end"]) == ("2031-02", "2031-05")
    yearly = {**EVENT, "id": "2031-a-year", "date": "2031", "date_precision": "year"}
    assert E.read_event(text_of(yearly).encode(), "2031-a-year.md")[1] == []


def test_the_days_an_event_covers():
    assert E.span({**EVENT}) == ("2031-02-03", "2031-02-03")
    assert E.span({**EVENT, "date": "2031-02", "date_precision": "month"}) == ("2031-02-01", "2031-02-28")
    assert E.span({**EVENT, "date": "2031", "end": "2032", "date_precision": "year"}) == ("2031-01-01", "2032-12-31")


# --- the word list ------------------------------------------------------------------------------


@pytest.mark.parametrize("text, terms", [
    ("The Act was signed on 3 February 2031.", []),
    ("Prices rose because the Act was signed.", ["because"]),
    ("The ruling caused a selloff.", ["caused", "selloff"]),
    ("The bank's collapse led to a rescue.", ["collapse", "led to", "rescue"]),
    ("A historic and unprecedented step.", ["historic", "unprecedented"]),
    ("Recorded on 3 February.", []),          # "record" inside another word is not the word
    ("The Because Corporation was founded.", ["because"]),  # no exemption by capital letter: a person decides
])
def test_causal_and_evaluative_terms_are_found_as_whole_words(text, terms):
    assert sorted(W.terms_in(text)) == sorted(terms)


def test_every_term_says_which_kind_it_is():
    assert set(W.TERMS.values()) == {"causal", "evaluative"}
    assert W.TERMS["because"] == "causal" and W.TERMS["historic"] == "evaluative"


def test_an_accepted_term_is_passed_over_and_no_other():
    event = {**EVENT, "title": "The American Rescue Plan is signed", "description": "It caused nothing here."}
    assert W.event_terms(event) == {"title": ["rescue"], "description": ["caused"]}
    assert W.event_terms({**event, "accepted_terms": ["rescue"]}) == {"description": ["caused"]}


# --- the migration of v1's Events ----------------------------------------------------------------


@pytest.fixture(scope="module")
def migrated() -> list[dict]:
    events, problems = E.load_events(ROOT / "content" / "events")
    assert problems == []
    return events


def test_every_v1_event_and_every_v1_field_comes_back_from_the_files(migrated):
    assert len(V1_EVENTS) == 83
    assert [E.as_v1(event) for event in migrated] == V1_EVENTS


def test_the_events_keep_the_ids_and_the_order_the_converter_gave_them(migrated):
    assert [f"event-{event['id']}" for event in migrated] == RECORDED_IDS


def test_no_description_was_written_for_v1s_events_and_no_day_made_up(migrated):
    assert all(event["description"] == "" for event in migrated)
    assert sum(1 for event in migrated if event["date_precision"] == "month") == sum(1 for e in V1_EVENTS if "day" not in e)


def test_each_citation_has_an_archived_copy_or_says_why_not(migrated):
    without = [event["id"] for event in migrated for source in event["sources"] if "archive_url" not in source]
    assert len(without) == 5  # the five addresses the archive held no copy of on the day of the migration
    for event in migrated:
        for source in event["sources"]:
            if "archive_url" in source:
                assert source["archive_url"].startswith("https://web.archive.org/web/2")
                assert source["archive_url"].endswith(source["url"])


def test_the_migration_script_writes_exactly_the_committed_files(tmp_path):
    import subprocess
    import sys
    done = subprocess.run([sys.executable, str(ROOT / "scripts" / "migrate_events.py"), "--out", str(tmp_path)],
                          cwd=ROOT, capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stderr
    written = {path.name: path.read_bytes() for path in tmp_path.glob("*.md")}
    committed = {path.name: path.read_bytes() for path in (ROOT / "content" / "events").glob("*.md")}
    assert written == committed and len(written) == 83


def test_a_v1_event_that_hits_the_word_list_is_a_draft_with_its_words_unchanged(migrated):
    for event in migrated:
        hit = bool(W.event_terms(event))
        assert event["status"] == ("draft" if hit else "public"), event["id"]


def test_the_migration_review_names_all_83_and_proposes_a_wording_for_each_one_listed(migrated):
    review = json.loads((ROOT / "content" / "events" / "migration-review.json").read_text(encoding="utf-8"))
    by_id = {row["id"]: row for row in review["events"]}
    assert list(by_id) == [event["id"] for event in migrated]
    for event in migrated:
        row = by_id[event["id"]]
        assert row["title"] == event["title"]
        assert set(row["reviewed_by"]) == {"word list", "Codex"}
        assert row["terms"] == W.terms_in(event["title"])
        listed = bool(row["terms"] or row.get("codex"))
        assert row["outcome"] == ("listed" if listed else "passed")
        assert (event["status"] == "draft") == listed
        if listed:
            assert row["proposed"].strip() and not W.terms_in(row["proposed"]) or row.get("keep")
