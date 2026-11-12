"""Claims as files, Claim locks, `atlas add claim` and the claim record rules of `atlas check`
(PLAN 5 and M20; ADR 0011, ADR 0034). Every Claim here is invented and written into a
temporary directory; no real person's words are in this file."""
import json
from pathlib import Path

import pytest

from atlas import cli
from atlas.catalog import check as C
from atlas.catalog.load import load_catalog
from atlas.content import claims as K
from atlas.content.check import check_content
from atlas.rights import RightsGate

from .claim_helpers import ARCHIVE, ORIGIN, claim, lock, write_claim, write_lock
from .release_helpers import MAKE, fixture_table

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "checks" / "claim-cases.json").read_text(encoding="utf-8"))
NAME = f"{claim()['id']}.md"
#: The fixture register signs the one made-up Origin for display and redistribution.
GATE = RightsGate(MAKE.register())


def read(record: dict, name: str | None = None):
    return K.read_claim(K.serialise(record).encode("utf-8"), name or f"{record['id']}.md")


def layer(content: Path, gate: RightsGate | None = GATE):
    return check_content(load_catalog(), content, content.parent / "notes", gate=gate)


def run(capsys, *argv: str) -> tuple[int, str]:
    status = cli.main(list(argv))
    said = capsys.readouterr()
    return status, said.out + said.err


# --- the file ---------------------------------------------------------------------------------------


def test_a_claim_is_read_back_as_it_was_written():
    record = claim(said_at="2031-03-04T15:30:00Z", corrections=[{"date": "2031-03-09", "reason": "The venue was misnamed."}])
    read_back, problems = read(record)
    assert problems == [] and read_back == record
    text = K.serialise(record)
    assert text.startswith("---\nid: ") and text.rstrip().endswith("The jobless rate was 4.1 percent in January.")


@pytest.mark.parametrize("field", ["finding", "rating", "label", "verdict", "context", "accuracy", "score"])
def test_the_schema_has_no_field_for_a_finding_a_rating_or_a_label(field):
    for where in ("claim", "reading", "source", "claimant"):
        record = claim()
        target = {"claim": record, "reading": record["readings"][0], "source": record["sources"][0],
                  "claimant": record["claimant"]}[where]
        target[field] = "accurate"
        read_back, problems = read(record)
        assert read_back is None and any(field in problem for problem in problems), (where, problems)


def test_a_claim_with_one_source_or_no_archive_url_is_not_a_claim():
    one = claim()
    one["sources"] = one["sources"][:1]
    assert read(one)[0] is None and "sources" in read(one)[1][0]
    for missing in ("archive_url", "locator", "kind"):
        bare = claim()
        del bare["sources"][1][missing]
        read_back, problems = read(bare)
        assert read_back is None and any(missing in problem for problem in problems), missing
    twice = claim()
    twice["sources"][1] = dict(twice["sources"][0])
    assert read(twice)[0] is None and "two different records" in read(twice)[1][0]
    same_copy = claim()
    same_copy["sources"][1]["archive_url"] = same_copy["sources"][0]["archive_url"]
    assert read(same_copy)[0] is None


def test_a_claim_needs_a_selection_note_a_quote_and_real_days():
    assert read(claim(selection_note=""))[0] is None
    assert read(claim(quote=""))[0] is None
    assert read(claim(checked_on="2031-02-30"))[0] is None
    assert "before" in read(claim(checked_on="2031-03-01"))[1][0]          # checked before it was said
    assert "does not start with" in read(claim(said_on="2031-03-05"))[1][0]
    assert "named for its id" in read(claim(), "other.md")[1][0]
    without_log = claim()
    del without_log["corrections"]
    assert read(without_log)[0] is None                                     # the correction log is always there


def test_a_time_falls_on_the_day_it_names_in_new_york():
    assert read(claim(said_at="2031-03-04T23:30:00Z"))[1] == []             # 18:30 in New York, the same day
    assert read(claim(said_at="2031-03-05T03:00:00Z"))[1] == []             # 22:00 on the 4th in New York
    read_back, problems = read(claim(said_at="2031-03-05T06:00:00Z"))       # 01:00 on the 5th
    assert read_back is None and "New York" in problems[0]


def test_two_readings_do_not_share_an_id():
    record = claim()
    record["readings"].append(dict(record["readings"][0]))
    assert "share the id" in read(record)[1][0]


@pytest.mark.parametrize("reading", CASES["accepted"], ids=lambda r: r["measure"])
def test_reading_shapes_the_engine_accepts_are_accepted(reading):
    assert K.reading_problem(reading, "monthly") is None


@pytest.mark.parametrize("case", CASES["refused"], ids=lambda c: c["why"])
def test_reading_shapes_the_engine_refuses_are_refused(case):
    assert isinstance(K.reading_problem(case["reading"], "monthly"), str)


def test_the_record_hash_covers_the_statement_and_its_readings_and_not_its_status():
    base = K.record_sha256(claim())
    assert K.record_sha256(claim(status="public", topics=[], corrections=[{"date": "2031-04-01", "reason": "x"}])) == base
    for change in ({"quote": "Other words."}, {"venue": "Elsewhere"}, {"checked_on": "2031-03-07"},
                   {"selection_note": "Another reason."}, {"readings_not_measured": []}):
        assert K.record_sha256(claim(**change)) != base, change
    moved = claim()
    moved["readings"][0]["period"] = "2031-02"
    assert K.record_sha256(moved) != base


# --- the claim record rules of atlas check ------------------------------------------------------------


def test_a_draft_claim_passes_the_content_layer(tmp_path):
    write_claim(tmp_path / "content")
    problems, _notes = layer(tmp_path / "content")
    assert problems == []


def test_the_whole_check_fails_on_a_claim_with_one_source(tmp_path):
    path = write_claim(tmp_path / "content")
    text = path.read_text()
    start = text.index('  - name: "Invented transcript"')
    path.write_text(text[:start] + text[text.index("readings:"):])
    report = C.check(content=tmp_path / "content", notes=tmp_path / "notes")
    assert not report.ok and report.layers[-1].name == "content"
    assert "sources" in str(report.layers[-1].problems[0])


def test_a_reading_names_a_series_of_the_catalog_and_a_period_of_its_frequency(tmp_path):
    record = claim()
    record["readings"] = [{"id": "a", "series": "no_such_series", "transform": "lin", "measure": "value_at", "period": "2031-01"},
                          {"id": "b", "series": "unrate", "transform": "lin", "measure": "value_at", "period": "2031-Q1"}]
    write_claim(tmp_path / "content", record)
    problems, _ = layer(tmp_path / "content")
    assert ["no_such_series" in str(problems[0]), "2031-Q1" in str(problems[1])] == [True, True]


def test_nothing_else_is_kept_under_content_claims(tmp_path):
    write_claim(tmp_path / "content")
    (tmp_path / "content" / "claims" / "notes.txt").write_text("x")
    (tmp_path / "content" / "claims" / "locks").mkdir()
    (tmp_path / "content" / "claims" / "locks" / "stray.json").write_text("{}")
    problems, _ = layer(tmp_path / "content")
    assert len(problems) == 2


def test_a_public_claim_needs_a_reading_a_lock_and_text_clear_of_the_word_list(tmp_path):
    content = tmp_path / "content"
    public = claim(status="public", selection_note="Recorded because of the historic collapse it describes.")
    write_claim(content, public)
    said = " ".join(str(problem) for problem in layer(content)[0])
    assert "has no lock" in said and "because" in said and "historic" in said
    # The quote is the claimant's own words and is never held to the list.
    write_claim(content, claim(status="public", quote="A historic collapse, because of them."))
    write_lock(content / "claims" / "locks", lock(claim(status="public", quote="A historic collapse, because of them.")))
    assert layer(content)[0] == []
    empty = claim(status="public", readings=[])
    write_claim(content, empty)
    assert "no reading" in " ".join(str(problem) for problem in layer(content)[0])


def test_a_draft_whose_note_has_a_listed_word_gets_a_note_not_an_error(tmp_path):
    write_claim(tmp_path / "content", claim(selection_note="Recorded because it was widely repeated."))
    problems, notes = layer(tmp_path / "content")
    assert problems == [] and any("because" in note and "draft" in note for note in notes)


# --- locks ---------------------------------------------------------------------------------------------


def test_a_lock_is_read_back_and_a_claim_with_its_lock_passes(tmp_path):
    content = tmp_path / "content"
    write_claim(content)
    path = write_lock(content / "claims" / "locks", lock())
    document, problems = K.read_lock(path.read_bytes(), path.name)
    assert problems == [] and document["version"] == 1 and path.name == f"{claim()['id']}.v1.lock.json"
    assert layer(content)[0] == []


def test_editing_a_number_in_a_lock_fails_the_check(tmp_path):
    content = tmp_path / "content"
    write_claim(content)
    path = write_lock(content / "claims" / "locks", lock())
    path.write_text(path.read_text().replace("4.1", "3.9"))
    problems, _ = layer(content)
    assert len(problems) == 1 and "was edited" in str(problems[0]) and "never edited" in str(problems[0])


def test_editing_a_locked_reading_fails_the_check(tmp_path):
    content = tmp_path / "content"
    write_lock(content / "claims" / "locks", lock())
    moved = claim()
    moved["readings"][0]["period"] = "2031-02"
    write_claim(content, moved)
    problems, _ = layer(content)
    assert len(problems) == 1 and "changed since it was locked" in str(problems[0]) and "relock" in str(problems[0])
    # Its status, topics and correction log are not frozen.
    write_claim(content, claim(topics=["prices"], corrections=[{"date": "2031-04-02", "reason": "A topic was added."}]))
    assert layer(content)[0] == []


def test_a_relock_adds_a_version_and_the_newest_is_the_one_the_claim_is_held_to(tmp_path):
    content = tmp_path / "content"
    locks = content / "claims" / "locks"
    write_lock(locks, lock())
    later = claim(checked_on="2031-04-01")
    write_claim(content, later)
    assert "changed since it was locked" in str(layer(content)[0][0])
    write_lock(locks, lock(later, version=2, reason="The January figure was revised."))
    assert layer(content)[0] == []
    (locks / K.lock_name(claim()["id"], 1)).unlink()
    assert "version 1 is missing" in str(layer(content)[0][0])


def test_a_relock_gives_its_reason_and_names_what_it_follows(tmp_path):
    body = dict(lock(version=2, reason="Revised."))
    for change in ({"reason": None}, {"supersedes": None}, {"supersedes": 5}):
        document = K.sealed({**{k: v for k, v in body.items() if k != "lock_sha256"}, **change})
        assert K.read_lock(K.lock_bytes(document), K.lock_name(document["claim_id"], 2))[0] is None, change


def test_a_lock_belongs_to_a_claim_and_is_named_for_it(tmp_path):
    content = tmp_path / "content"
    write_claim(content)
    write_lock(content / "claims" / "locks", lock(claim(id="2031-03-04-another-claim")))
    assert "no Claim" in str(layer(content)[0][0])
    document = lock()
    assert "named" in K.read_lock(K.lock_bytes(document), "2031-03-04-x.v1.lock.json")[1][0]


@pytest.mark.parametrize("field", ["finding", "rating", "label", "verdict"])
def test_a_lock_has_no_field_for_a_finding_either(field):
    for where in ("lock", "reading", "row", "figure"):
        document = {k: v for k, v in lock().items() if k != "lock_sha256"}
        reading = document["readings"][0]
        {"lock": document, "reading": reading, "row": reading["then"], "figure": reading["then"]["figures"][0]}[where][field] = "accurate"
        read_back, problems = K.read_lock(K.lock_bytes(K.sealed(document)), K.lock_name(document["claim_id"], 1))
        assert read_back is None and any(field in problem for problem in problems), where


def test_a_figure_is_a_number_never_true_or_false():
    document = {k: v for k, v in lock().items() if k != "lock_sha256"}
    document["readings"][0]["then"]["figures"][0]["value"] = True
    assert K.read_lock(K.lock_bytes(K.sealed(document)), K.lock_name(document["claim_id"], 1))[0] is None


def test_a_lock_in_the_repository_needs_display_and_redistribution_of_everything_it_came_through(tmp_path):
    content = tmp_path / "content"
    write_claim(content)
    write_lock(content / "claims" / "locks", lock())
    assert layer(content)[0] == []
    unsigned = RightsGate(fixture_table(decision=None))
    assert "rights register" in str(layer(content, unsigned)[0][0])
    display_only = RightsGate(fixture_table(decision={**MAKE.register()["rows"][0]["decision"], "redistribute": False}))
    assert "redistribut" in str(layer(content, display_only)[0][0])
    # The committed register does not sign the fixture's row, so this lock could not be committed under it.
    assert layer(content, gate=None)[0] != []


def test_a_lock_computed_on_a_local_release_is_never_committed(tmp_path):
    content = tmp_path / "content"
    write_claim(content)
    write_lock(content / "claims" / "locks", lock(profile="local"))
    assert "local-profile" in str(layer(content)[0][0])


# --- atlas add claim -------------------------------------------------------------------------------------

ADD = ["--name", "An Invented Official", "--role", "Secretary of Examples", "--party", "none",
       "--venue", "A press conference that did not happen", "--quote", "The jobless rate was 4.1 percent in January.",
       "--selection-note", "Kept as a test of the file format.", "--checked-on", "2031-03-06"]
TWO = ["--source", "https://video.example.org/briefing", "--kind", "recording", "--archive-url", ARCHIVE + "a", "--locator", "at 12:40",
       "--source", "https://example.org/transcript", "--kind", "transcript", "--archive-url", ARCHIVE + "b", "--locator", "paragraph 9"]


def add(capsys, content: Path, *more: str, sources=TWO):
    return run(capsys, "add", "claim", "2031-03-04", "An invented official on the jobless rate", *ADD, *sources,
               "--content", str(content), *more)


def test_add_claim_writes_a_draft_that_passes_atlas_check(tmp_path, capsys):
    content = tmp_path / "content"
    status, said = add(capsys, content, "--series", "unrate", "--measure", "change", "--from", "2030-01-01", "--to", "2031-01-31",
                       "--alt-window", "2029-01-01:2031-01-31", "--not-measured", "The rate among people aged 16 to 24.", "--topic", "jobs")
    assert status == 0, said
    (record,), problems = K.load_claims(content / "claims")
    assert problems == [] and record["status"] == "draft" and record["id"] == "2031-03-04-an-invented-official-on-the-jobless-rate"
    assert record["readings"] == [{"id": "r1", "series": "unrate", "transform": "lin", "measure": "change",
                                   "window": {"from": "2030-01-01", "to": "2031-01-31"},
                                   "alternative_windows": [{"from": "2029-01-01", "to": "2031-01-31"}]}]
    assert "draft" in said and "atlas claims compute" in said
    report = C.check(content=content, notes=tmp_path / "notes")
    assert report.ok, C.render(report)


def test_add_claim_dates_the_check_by_new_york_not_by_the_machine(tmp_path):
    from argparse import Namespace
    from datetime import UTC, datetime

    from atlas.content import add as X

    args = Namespace(said_on="2031-03-04", title="An evening claim", name="A", role="B", party="none", venue="C",
                     quote="Q.", said_at=None, source=TWO[1::8], source_kind=["recording", "transcript"],
                     archive_url=[ARCHIVE + "a", ARCHIVE + "b"], locator=["x", "y"], selection_note="Kept as a test.",
                     checked_on=None, not_measured=None, topic=None, series=None, measure=None, content=str(tmp_path / "content"))
    # 01:30 UTC on the 6th is the evening of the 5th in New York.
    X.add_claim(args, load_catalog(), now=datetime(2031, 3, 6, 1, 30, tzinfo=UTC))
    (record,), _ = K.load_claims(tmp_path / "content" / "claims")
    assert record["checked_on"] == "2031-03-05"


def test_add_claim_needs_two_archived_sources(tmp_path, capsys):
    content = tmp_path / "content"
    status, said = add(capsys, content, sources=TWO[:8])
    assert status == 1 and "two" in said and not (content / "claims").exists()
    status, said = add(capsys, content, sources=[*TWO[:8], "--source", "https://example.org/transcript", "--kind", "transcript", "--locator", "p. 9"])
    assert status == 1 and "--archive-url" in said and not (content / "claims").exists()


def test_add_claim_never_overwrites_never_makes_one_public_and_takes_no_finding(tmp_path, capsys):
    content = tmp_path / "content"
    assert add(capsys, content)[0] == 0
    path = next((content / "claims").glob("*.md"))
    before = path.read_bytes()
    status, said = add(capsys, content, "--topic", "prices")
    assert status == 1 and "already exists" in said and path.read_bytes() == before
    for option in ("--status", "--finding", "--rating", "--label"):
        with pytest.raises(SystemExit):
            add(capsys, tmp_path / "other", option, "public")
    capsys.readouterr()


def test_add_claim_refuses_a_series_the_catalog_does_not_have_and_a_reading_that_is_not_one(tmp_path, capsys):
    content = tmp_path / "content"
    status, said = add(capsys, content, "--series", "no_such_series", "--measure", "value_at", "--period", "2031-01")
    assert status == 1 and "no_such_series" in said
    status, said = add(capsys, content, "--series", "unrate", "--measure", "value_at")
    assert status == 1 and "period" in said
    assert not (content / "claims").exists()


def test_the_origin_of_these_tests_is_the_made_up_one():
    assert lock()["rights_used"][0]["origin"] == ORIGIN
