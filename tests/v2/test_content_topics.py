"""Topics as files (PLAN 5 and M23; ADR 0037): the file format, what a Topic may name, and
what the content compiler puts in a Release. Every Topic, Series and Event here is invented and
written into a temporary directory."""
import json
from pathlib import Path

import pytest

from atlas import cli
from atlas.catalog import check as C
from atlas.content import events as E
from atlas.content import topics as T
from atlas.content.compile import ContentError, compile_content
from atlas.release import search_document
from atlas.rights import RightsGate

from .capture_helpers import register

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "schema" / "topic.schema.json").read_text())
RELEASE_SCHEMA = json.loads((ROOT / "schema" / "release.schema.json").read_text())

AGENCY = {"producer": "An Invented Bureau", "dataset": "Invented Price Survey"}


def stored(key: str, dataset: str = AGENCY["dataset"], producer: str = AGENCY["producer"], **more) -> dict:
    return {"key": key, "name": key, "status": "active", "segment": "economy_jobs",
            "source": {"origin": {"producer": producer, "dataset": dataset}}, **more}


CATALOG = {
    "prices": stored("prices"),
    "prices_yoy": {"key": "prices_yoy", "name": "prices_yoy", "status": "active", "segment": "economy_jobs",
                   "recipe": {"op": "pct_change", "inputs": ["prices"]}},
    "rents": stored("rents"),
    "jobs_count": stored("jobs_count", dataset="Invented Payroll Survey"),
    "elsewhere": stored("elsewhere", producer="Another Invented Office"),
    "gone": stored("gone", status="retired"),
    **{f"{c}_infl": stored(f"{c}_infl", producer="An Invented Fund") for c in ("aa", "bb", "cc", "dd", "zone")},
}
COVERAGE = {"five": {"columns": [{"id": "inflation", "name": "Inflation (y/y)"}, {"id": "rates", "name": "Rates"}],
                     "rows": [{"country": "AAA", "cells": {"inflation": {"series": "aa_infl"}}},
                              {"country": "BBB", "cells": {"inflation": {"series": "bb_infl"}}},
                              {"country": "CCC", "cells": {"inflation": {"series": "cc_infl"}, "rates": {"none": "Not yet."}}},
                              {"country": "DDD", "cells": {"inflation": {"series": "dd_infl"}}},
                              {"country": "ZZ", "cells": {"inflation": {"series": "zone_infl"}}}]}}
EVENT = {"id": "2031-02-03-an-act-is-signed", "date": "2031-02-03", "date_precision": "day", "title": "An Act is signed",
         "category": "legislation", "status": "public", "topics": [], "related_series": [], "description": "",
         "sources": [{"url": "https://example.org/a", "archive_url": "https://example.org/archive/a"}]}
DRAFT_EVENT = {**EVENT, "id": "2031-04-01-a-draft-with-a-seeded-name-7391", "date": "2031-04-01", "status": "draft",
               "title": "Something not yet reviewed"}
TOPIC = {
    "slug": "prices", "title": "Prices", "segment": "economy_jobs", "status": "public",
    "definition": {"quote": "The invented index measures the change in prices paid by invented households.",
                   "source": {"name": "An Invented Bureau, Handbook", "url": "https://example.org/handbook",
                              "archive_url": "https://example.org/archive/handbook"}},
    "main": "prices_yoy", "series": ["prices_yoy", "prices", "rents"],
    "companions": [{"series": "rents", "relation": "component"}, {"series": "prices", "relation": "input"}],
    "range": {"series": "aa_infl", "coverage": "five", "indicator": "inflation", "label": "Five"},
    "events": [EVENT["id"]],
}


def write(tmp_path: Path, *topics: dict, events=(EVENT,), text: dict | None = None) -> Path:
    content = tmp_path / "content"
    (content / "topics").mkdir(parents=True, exist_ok=True)
    (content / "events").mkdir(parents=True, exist_ok=True)
    for event in events:
        (content / "events" / f"{event['id']}.md").write_text(E.serialise(event), encoding="utf-8")
    for topic in topics:
        (content / "topics" / f"{topic['slug']}.md").write_text(T.serialise(topic), encoding="utf-8")
    for name, body in (text or {}).items():
        (content / "topics" / name).write_text(body, encoding="utf-8")
    return content


def read(record: dict, name: str | None = None, body: str | None = None):
    return T.read_topic((body if body is not None else T.serialise(record)).encode(), name or f"{record['slug']}.md")


def line_of(record: dict, needle: str) -> int:
    return next(i for i, line in enumerate(T.serialise(record).splitlines(), 1) if needle in line)


def refs(record: dict, **more) -> list:
    topic, problems = read(record)
    assert problems == []
    return T.references(topic, **{"catalog": CATALOG, "events": {EVENT["id"]}, "coverage": COVERAGE, **more})


# --- the file ----------------------------------------------------------------------------------------


def test_a_topic_file_reads_back_as_it_was_written():
    topic, problems = read(TOPIC)
    assert problems == [] and topic.record == TOPIC and topic.slug == "prices"


def test_the_schema_has_no_field_for_prose_of_the_sites_own():
    """M23's criterion: every sentence on a Topic page is a label, a template sentence or a
    quoted and cited definition. The only field of a Topic that holds a sentence is the quote,
    and it cannot stand without its citation; every other string is a label (which may not be a
    sentence), a key, a slug, an id or one of a closed list."""
    assert SCHEMA["additionalProperties"] is False
    assert set(SCHEMA["properties"]) == {"slug", "title", "segment", "status", "definition", "main", "series",
                                         "companions", "range", "events"}
    definition = SCHEMA["properties"]["definition"]
    assert definition["additionalProperties"] is False and set(definition["required"]) == {"quote", "source"}
    assert SCHEMA["properties"]["title"] == {"$ref": "#/$defs/label"}
    assert SCHEMA["properties"]["range"]["properties"]["label"]["$ref"] == "#/$defs/label"
    assert SCHEMA["properties"]["companions"]["items"]["additionalProperties"] is False
    assert SCHEMA["$defs"]["relation"]["enum"] == list(T.RELATIONS)
    for word in ("explanation", "finding", "published_accounts", "description", "note", "summary", "cause"):
        assert word not in SCHEMA["properties"] and word not in definition["properties"]
    # Every string a Topic can hold, nested ones too, is a pattern, a closed list, a label, a
    # one-line name of a cited page, or the quote.
    citation = SCHEMA["$defs"]["citation"]
    assert citation["additionalProperties"] is False and set(citation["properties"]) == {"name", "url", "archive_url", "no_archive"}
    assert citation["properties"]["no_archive"]["enum"] == ["no_copy_found", "archiving_refused", "page_removed"]
    assert citation["properties"]["name"]["maxLength"] == 120
    free = []

    def strings(node: dict, path: str) -> None:
        node = SCHEMA["$defs"][node["$ref"].rsplit("/", 1)[1]] if "$ref" in node else node
        if node.get("type") == "object":
            for name, child in node["properties"].items():
                strings(child, f"{path}/{name}")
        elif node.get("type") == "array":
            strings(node["items"], path)
        elif "enum" not in node and not (node.get("pattern") and not node["pattern"].startswith("^\\S(")):
            free.append(path)

    strings(SCHEMA, "")
    assert free == ["/definition/quote"]
    # The Release's own form of a Topic is as closed.
    held = RELEASE_SCHEMA["$defs"]["topic"]
    assert held["additionalProperties"] is False
    assert set(held["properties"]) == set(SCHEMA["properties"])
    assert held["properties"]["companions"]["items"]["properties"]["relation"] == {"$ref": "#/$defs/topicRelation"}
    assert RELEASE_SCHEMA["$defs"]["topicRelation"]["enum"] == list(T.RELATIONS)


@pytest.mark.parametrize("change, said", [
    ({"explanation": "Prices rose because of an invented cause."}, "Additional properties"),
    ({"title": "Prices went up. A lot."}, "title"),
    ({"title": "Why did prices rise?"}, "title"),
    ({"definition": {"quote": TOPIC["definition"]["quote"]}}, "source"),
    ({"definition": {**TOPIC["definition"], "source": {"name": "A", "url": "https://example.org/x"}}}, "definition/source"),
    ({"companions": [{"series": "rents", "relation": "drives"}]}, "relation"),
    ({"companions": [{"series": "rents", "relation": "component", "note": "Rents pushed prices up."}]}, "Additional properties"),
    ({"status": "published"}, "status"),
    # No nested door either: the reason there is no archived copy is one of a closed list.
    ({"definition": {**TOPIC["definition"], "source": {"name": "A", "url": "https://example.org/x",
                                                       "no_archive": "No copy exists. Prices rose because of policy."}}}, "no_archive"),
    ({"definition": {**TOPIC["definition"], "source": {**TOPIC["definition"]["source"], "name": "A name\nand a second line."}}}, "name"),
    ({"definition": {**TOPIC["definition"], "source": {**TOPIC["definition"]["source"], "name": "A name\rand a second line"}}}, "name"),
    ({"definition": {**TOPIC["definition"], "quote": "The invented index\rmeasures the change in invented prices."}}, "quote"),
])
def test_a_field_the_schema_does_not_have_is_refused(change, said):
    topic, problems = T.read_topic((json.dumps({**TOPIC, **change})).join(["---\n", "\n---\n"]).encode(), "prices.md")
    assert topic is None and any(said in message for _, message in problems), problems


def test_text_under_the_front_matter_is_refused_with_its_line():
    text = T.serialise(TOPIC) + "\nPrices rose because rents rose.\n"
    topic, problems = read(TOPIC, body=text)
    assert topic is None
    assert problems == [(len(T.serialise(TOPIC).splitlines()) + 1, problems[0][1])]
    assert "no text of its own" in problems[0][1]


def test_what_a_schema_cannot_say():
    assert "not named for its slug" in read(TOPIC, name="other.md")[1][0][1]
    line, message = read({**TOPIC, "main": "elsewhere"})[1][0]
    assert "not one of its member Series" in message and line == line_of({**TOPIC, "main": "elsewhere"}, "main:")
    again = {**TOPIC, "companions": [{"series": "rents", "relation": "component"}, {"series": "rents", "relation": "same_survey"}]}
    assert [m for _, m in read(again)[1]] == ["the Companion rents is listed twice"]
    itself = {**TOPIC, "companions": [{"series": "prices_yoy", "relation": "component"}]}
    assert "not the main Series itself" in read(itself)[1][0][1]


# --- what it names -----------------------------------------------------------------------------------


def test_a_topic_that_names_only_what_is_there_has_no_problem():
    assert refs(TOPIC) == []


def test_a_dangling_reference_is_found_on_its_line():
    wrong = {**TOPIC, "series": ["prices_yoy", "prices", "no_such_series"]}
    assert refs(wrong) == [(line_of(wrong, '"no_such_series"'), "it names the Series no_such_series, which is not in the catalog")]
    wrong = {**TOPIC, "companions": [{"series": "no_such_series", "relation": "component"}]}
    assert refs(wrong)[0][0] == line_of(wrong, "- series:")
    wrong = {**TOPIC, "events": [EVENT["id"], "2031-05-05-no-such-event"]}
    assert refs(wrong) == [(line_of(wrong, "no-such-event"),
                            "it names the Event 2031-05-05-no-such-event, and there is no content/events/2031-05-05-no-such-event.md")]
    wrong = {**TOPIC, "range": {**TOPIC["range"], "coverage": "nineteen"}}
    assert refs(wrong) == [(line_of(wrong, "coverage:"), "there is no coverage matrix nineteen (catalog/coverage/nineteen.json)")]
    wrong = {**TOPIC, "range": {**TOPIC["range"], "indicator": "growth"}}
    assert refs(wrong) == [(line_of(wrong, "indicator:"), "the coverage matrix five has no column growth")]
    wrong = {**TOPIC, "range": {**TOPIC["range"], "indicator": "rates"}}
    assert "a range needs at least three" in refs(wrong)[0][1]
    wrong = {**TOPIC, "series": [*TOPIC["series"], "gone"]}
    assert "retired" in refs(wrong)[0][1]
    retired = {**CATALOG, "bb_infl": {**CATALOG["bb_infl"], "status": "retired"}}
    assert refs(TOPIC, catalog=retired) == [(line_of(TOPIC, "indicator:"), "its member bb_infl is retired: a range is of Series that are still kept")]


def test_a_relation_the_catalog_contradicts_is_a_problem():
    def relation(series: str, name: str) -> list:
        return refs({**TOPIC, "companions": [{"series": series, "relation": name}]})

    assert relation("rents", "component") == [] and relation("rents", "same_survey") == []
    assert relation("prices", "input") == []
    stored = {**TOPIC, "main": "prices", "series": ["prices"]}

    def release(series: str) -> list:
        return refs({**stored, "companions": [{"series": series, "relation": "same_release"}]})

    assert release("jobs_count") == []
    assert "is not computed from rents" in relation("rents", "input")[0][1]
    assert "one dataset of one agency" in relation("jobs_count", "same_survey")[0][1]
    assert "one dataset of one agency" in relation("jobs_count", "excludes_components")[0][1]
    assert "not one agency's" in release("elsewhere")[0][1]
    # A Series computed here is in nobody's release.
    derived = {**TOPIC, "main": "prices", "series": ["prices", "prices_yoy"], "companions": [{"series": "prices_yoy", "relation": "same_release"}]}
    assert "prices_yoy is computed by Macro Atlas" in refs(derived)[0][1]
    wrong = {**stored, "companions": [{"series": "elsewhere", "relation": "same_release"}]}
    assert release("elsewhere")[0][0] == line_of(wrong, "relation:")


def test_the_members_of_a_range_are_one_series_per_country_and_no_group_row():
    column, found = T.members(TOPIC["range"], COVERAGE)
    assert column["name"] == "Inflation (y/y)"
    assert found == [{"key": "aa_infl", "country": "AAA"}, {"key": "bb_infl", "country": "BBB"},
                     {"key": "cc_infl", "country": "CCC"}, {"key": "dd_infl", "country": "DDD"}]


# --- the compiler ------------------------------------------------------------------------------------


def gate() -> RightsGate:
    return RightsGate(register())


def compile_(content: Path, profile: str = "public"):
    return compile_content(profile=profile, content=content, gate=gate(), catalog=CATALOG, coverage=COVERAGE)


def topics_of(result) -> list[dict]:
    return json.loads(result.files["content/topics.json"])["topics"]


def test_a_release_holds_the_topic_with_its_members_resolved(tmp_path):
    result = compile_(write(tmp_path, TOPIC))
    assert topics_of(result) == [{**TOPIC, "range": {
        "series": "aa_infl", "label": "Five", "indicator": {"id": "inflation", "name": "Inflation (y/y)"},
        "members": [{"key": "aa_infl", "country": "AAA"}, {"key": "bb_infl", "country": "BBB"},
                    {"key": "cc_infl", "country": "CCC"}, {"key": "dd_infl", "country": "DDD"}]}}]
    assert ("topics/prices.md", T.serialise(TOPIC).encode()) in result.read
    assert {"check": "content: topics", "outcome": "pass", "detail": "1 Topic"} in result.report


def test_no_topics_directory_is_a_release_with_no_topic(tmp_path):
    content = tmp_path / "content"
    (content / "events").mkdir(parents=True)
    result = compile_content(profile="public", content=content, gate=gate())
    assert topics_of(result) == []


def test_compile_fails_on_a_dangling_reference_with_file_and_line(tmp_path):
    wrong = {**TOPIC, "companions": [{"series": "rents", "relation": "component"}, {"series": "no_such_series", "relation": "component"}]}
    content = write(tmp_path, wrong)
    with pytest.raises(ContentError) as refused:
        compile_(content)
    line = line_of(wrong, '"no_such_series"')
    assert f"{content / 'topics' / 'prices.md'}:{line}: it names the Series no_such_series, which is not in the catalog" in str(refused.value)
    # A local-profile Release is refused as well: a dangling reference is wrong on any Surface.
    with pytest.raises(ContentError, match=f"prices.md:{line}: "):
        compile_(content, "local")


def test_a_file_that_is_not_a_topic_refuses_the_release_with_file_and_line(tmp_path):
    content = write(tmp_path, text={"prices.md": T.serialise(TOPIC) + "\nA sentence of the site's own.\n"})
    with pytest.raises(ContentError, match=r"prices\.md:\d+: text is written under the front matter"):
        compile_(content)


def test_a_public_release_holds_no_draft_topic_and_no_id_of_a_draft_event(tmp_path):
    draft = {**TOPIC, "slug": "wages", "title": "Wages with a seeded name 7391", "status": "draft", "events": []}
    listed = {**TOPIC, "events": [EVENT["id"], DRAFT_EVENT["id"]]}
    content = write(tmp_path, listed, draft, events=(EVENT, DRAFT_EVENT))
    public = compile_(content)
    assert [t["slug"] for t in topics_of(public)] == ["prices"]
    assert topics_of(public)[0]["events"] == [EVENT["id"]]
    assert all(b"7391" not in body for body in public.files.values())
    said = next(row for row in public.report if row["check"] == "content: topics")
    assert said == {"check": "content: topics", "outcome": "pass", "detail": "1 Topic; 1 draft left out; 1 draft Event left off prices"}
    local = compile_(content, "local")
    assert [(t["slug"], t["status"]) for t in topics_of(local)] == [("prices", "public"), ("wages", "draft")]
    assert topics_of(local)[0]["events"] == [EVENT["id"], DRAFT_EVENT["id"]]


def test_a_public_topics_own_words_are_held_to_the_word_list(tmp_path):
    loaded = {**TOPIC, "title": "The price crisis", "definition": {**TOPIC["definition"], "source": {**TOPIC["definition"]["source"], "name": "A Bureau, a historic page"}}}
    content = write(tmp_path, loaded)
    with pytest.raises(ContentError, match=r"prices\.md:\d+: its title has crisis; .*prices\.md:\d+: its source name has historic"):
        compile_(content)
    assert topics_of(compile_(content, "local"))[0]["title"] == "The price crisis"
    # The quote is the agency's and is not held to the list.
    quoted = {**TOPIC, "definition": {**TOPIC["definition"], "quote": "The index rose because of a historic surge in invented prices."}}
    assert topics_of(compile_(write(tmp_path / "b", quoted)))[0]["definition"]["quote"].startswith("The index rose because")


def test_the_search_index_has_an_entry_for_each_topic_after_the_claims():
    held = {"topics": [{**TOPIC, "events": []}]}
    index = search_document({"series": []}, [], {"events": []}, {"claims": []}, held)
    assert index == {"entries": [{"kind": "topic", "id": "prices", "title": "Prices", "text": TOPIC["definition"]["quote"],
                                  "keywords": ["An Invented Bureau, Handbook", "prices_yoy"]}]}
    assert search_document({"series": []}, [], {"events": []}, {"claims": []}) == {"entries": []}


# --- atlas check and atlas add ------------------------------------------------------------------------


def run(capsys, *argv: str) -> tuple[int, str]:
    status = cli.main(list(argv))
    out = capsys.readouterr()
    return status, out.out + out.err


def content_layer(content: Path):
    report = C.check(content=content, notes=content.parent / "notes")
    return report, report.layers[-1]


REAL = {**TOPIC, "main": "cpi_yoy", "series": ["cpi_yoy", "cpi_nsa", "rent_yoy"],
        "companions": [{"series": "rent_yoy", "relation": "component"}, {"series": "cpi_nsa", "relation": "input"}],
        "range": {"series": "us_infl", "coverage": "g20", "indicator": "inflation", "label": "G20"}, "events": []}


def test_atlas_check_holds_a_topic_to_the_catalog_and_names_file_and_line(tmp_path):
    content = write(tmp_path, REAL, events=())
    report, layer = content_layer(content)
    assert report.ok and layer.problems == []
    wrong = {**REAL, "series": [*REAL["series"], "no_such_series"]}
    content = write(tmp_path / "b", wrong, events=())
    report, layer = content_layer(content)
    assert not report.ok
    assert [(p.path, p.message) for p in layer.problems] == [
        (f"{content / 'topics' / 'prices.md'}:{line_of(wrong, 'no_such_series')}", "it names the Series no_such_series, which is not in the catalog")]
    assert f"prices.md:{line_of(wrong, 'no_such_series')}" in C.render(report)


def test_atlas_check_refuses_anything_else_under_content_topics(tmp_path):
    content = write(tmp_path, REAL, events=(), text={"notes.txt": "x"})
    _, layer = content_layer(content)
    assert ["is not a Topic" in p.message for p in layer.problems] == [True]


def test_an_event_or_a_claim_names_topics_that_are_files(tmp_path):
    public = {**EVENT, "topics": ["prices", "no-such-topic"]}
    draft = {**DRAFT_EVENT, "topics": ["no-such-topic"]}
    content = write(tmp_path, {**REAL, "status": "draft"}, events=(public, draft))
    report, layer = content_layer(content)
    assert [p.message for p in layer.problems] == ["it names the Topic no-such-topic, and there is no content/topics/no-such-topic.md"]
    assert any("is a draft and names the Topic no-such-topic" in note for note in report.notes)
    assert any("names the Topic prices, which is a draft" in note for note in report.notes)


def test_add_topic_writes_a_draft_that_passes_atlas_check(tmp_path, capsys):
    content = tmp_path / "content"
    status, out = run(capsys, "add", "topic", "prices", "--title", "Prices", "--segment", "economy_jobs",
                      "--main", "cpi_yoy", "--series", "cpi_nsa", "--quote", TOPIC["definition"]["quote"],
                      "--source-name", "An Invented Bureau, Handbook", "--source", "https://example.org/handbook",
                      "--archive-url", "https://example.org/archive/handbook", "--content", str(content))
    assert status == 0, out
    topic, problems = T.read_topic((content / "topics" / "prices.md").read_bytes(), "prices.md")
    assert problems == [] and topic.record["status"] == "draft" and topic.record["series"] == ["cpi_yoy", "cpi_nsa"]
    assert "draft" in out and "python -m atlas check" in out
    assert content_layer(content)[0].ok
    status, out = run(capsys, "add", "topic", "prices", "--title", "Prices", "--segment", "economy_jobs",
                      "--main", "cpi_yoy", "--quote", TOPIC["definition"]["quote"], "--source-name", "A",
                      "--source", "https://example.org/handbook", "--no-archive", "archiving_refused",
                      "--content", str(content))
    assert status == 1 and "already exists" in out
    status, out = run(capsys, "add", "topic", "rents", "--title", "Rents", "--segment", "economy_jobs",
                      "--main", "no_such_series", "--quote", TOPIC["definition"]["quote"], "--source-name", "A",
                      "--source", "https://example.org/handbook", "--no-archive", "archiving_refused",
                      "--content", str(content))
    assert status == 1 and "no_such_series is not a Series of the catalog" in out


# --- the repository's own Topics -----------------------------------------------------------------------


def test_the_repository_has_the_two_topics_and_they_name_what_is_there():
    topics, problems = T.load_topics()
    assert problems == []
    assert [t.slug for t in topics] == ["inflation", "jobs"]
    for topic in topics:
        assert T.own_terms(topic) == []
        assert topic.record["definition"]["source"]["url"].startswith("https://www.bls.gov/")
        assert len(topic.record["companions"]) >= 2
    inflation = topics[0].record
    assert inflation["range"] == {"series": "us_infl", "coverage": "g20", "indicator": "inflation", "label": "G20"}
