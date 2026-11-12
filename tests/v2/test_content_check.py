"""`atlas add event|note` and the content layer of `atlas check` (PLAN 5 and M19; ADR 0033).
Every Event and note here is invented and written into a temporary directory."""
from pathlib import Path

import pytest

from atlas import cli
from atlas.catalog import check as C
from atlas.content import events as E

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ["--source", "https://example.org/act", "--archive-url", "https://example.org/archive/act"]


def run(capsys, *argv: str) -> tuple[int, str]:
    status = cli.main(list(argv))
    said = capsys.readouterr()
    return status, said.out + said.err


def content_layer(content: Path, notes: Path | None = None):
    report = C.check(content=content, notes=notes if notes is not None else content.parent / "notes")
    assert [layer.name for layer in report.layers] == ["schema", "references", "semantics", "rights", "content"]
    return report, report.layers[-1]


def add_event(capsys, content: Path, *more: str, title: str = "An invented Act is signed", date: str = "2031-02-03"):
    return run(capsys, "add", "event", date, title, "--category", "legislation", "--content", str(content), *more)


# --- atlas add event --------------------------------------------------------------------------------


def test_add_event_writes_a_draft_that_passes_atlas_check(tmp_path, capsys):
    content = tmp_path / "content"
    status, said = add_event(capsys, content, *SOURCE, "--series", "unrate", "--topic", "jobs",
                             "--description", "The Act was signed on 3 February 2031.")
    assert status == 0, said
    path = content / "events" / "2031-02-03-an-invented-act-is-signed.md"
    event, problems = E.read_event(path.read_bytes(), path.name)
    assert problems == []
    assert event["status"] == "draft" and event["related_series"] == ["unrate"] and event["topics"] == ["jobs"]
    assert event["description"] == "The Act was signed on 3 February 2031."
    assert "draft" in said and "python -m atlas check" in said
    report, layer = content_layer(content)
    assert report.ok and layer.problems == []


def test_add_event_takes_a_month_a_year_and_a_span(tmp_path, capsys):
    content = tmp_path / "content"
    assert add_event(capsys, content, *SOURCE, date="2031-02", title="A count begins")[0] == 0
    assert add_event(capsys, content, *SOURCE, date="2031", title="A survey year")[0] == 0
    assert add_event(capsys, content, *SOURCE, "--end", "2031-03-14", date="2031-03-10", title="A storm")[0] == 0
    events, problems = E.load_events(content / "events")
    assert problems == []
    assert [(e["date"], e.get("end"), e["date_precision"]) for e in events] == [
        ("2031", None, "year"), ("2031-02", None, "month"), ("2031-03-10", "2031-03-14", "day")]
    assert content_layer(content)[0].ok


def test_add_event_needs_an_archived_copy_or_the_reason_there_is_none(tmp_path, capsys):
    content = tmp_path / "content"
    status, said = add_event(capsys, content, "--source", "https://example.org/act")
    assert status == 1 and "--archive-url" in said and "--no-archive" in said
    assert not (content / "events").exists() or not list((content / "events").iterdir())
    status, _ = add_event(capsys, content, "--source", "https://example.org/act",
                          "--no-archive", "The page forbids archiving (robots.txt).")
    assert status == 0
    (event,), _ = E.load_events(content / "events")
    assert event["sources"] == [{"url": "https://example.org/act", "no_archive": "The page forbids archiving (robots.txt)."}]
    assert content_layer(content)[0].ok


def test_add_event_never_overwrites_and_never_writes_what_is_not_an_event(tmp_path, capsys):
    content = tmp_path / "content"
    assert add_event(capsys, content, *SOURCE)[0] == 0
    before = (content / "events" / "2031-02-03-an-invented-act-is-signed.md").read_bytes()
    status, said = add_event(capsys, content, *SOURCE, "--description", "Other words.")
    assert status == 1 and "already exists" in said
    assert (content / "events" / "2031-02-03-an-invented-act-is-signed.md").read_bytes() == before
    status, said = add_event(capsys, content, *SOURCE, date="2031-02-30", title="No such day")
    assert status == 1 and "calendar" in said
    assert len(list((content / "events").glob("*.md"))) == 1


def test_add_event_cannot_make_a_public_event_or_accept_a_term(tmp_path, capsys):
    for option in ("--status", "--accept-term"):
        with pytest.raises(SystemExit):
            cli.main(["add", "event", "2031-02-03", "A title", "--category", "policy", *SOURCE, option, "public",
                      "--content", str(tmp_path / "content")])
    capsys.readouterr()


def test_add_event_says_which_of_its_words_are_on_the_list_and_the_draft_still_passes(tmp_path, capsys):
    content = tmp_path / "content"
    status, said = add_event(capsys, content, *SOURCE, title="Markets crash because of an Act")
    assert status == 0 and "because" in said and "crash" in said
    report, _layer = content_layer(content)
    assert report.ok
    assert any("because" in note and "draft" in note for note in report.notes)


# --- the content layer --------------------------------------------------------------------------------


def write(content: Path, event: dict) -> Path:
    (content / "events").mkdir(parents=True, exist_ok=True)
    path = content / "events" / f"{event['id']}.md"
    path.write_text(E.serialise(event), encoding="utf-8")
    return path


EVENT = {"id": "2031-02-03-an-act", "date": "2031-02-03", "date_precision": "day", "title": "An Act is signed",
         "category": "legislation", "status": "public", "topics": [], "related_series": [],
         "sources": [{"url": "https://example.org/a", "archive_url": "https://example.org/archive/a"}], "description": ""}


def said_by(layer) -> str:
    return " | ".join(str(problem) for problem in layer.problems)


def test_a_public_event_whose_text_hits_the_word_list_fails_the_check(tmp_path):
    write(tmp_path / "content", {**EVENT, "description": "Prices rose because the Act was signed."})
    report, layer = content_layer(tmp_path / "content")
    assert not report.ok and "because" in said_by(layer) and "2031-02-03-an-act.md" in said_by(layer)


def test_a_term_alex_accepted_for_an_event_passes(tmp_path):
    event = {**EVENT, "title": "The Invented Rescue Act is signed"}
    write(tmp_path / "content", event)
    assert "rescue" in said_by(content_layer(tmp_path / "content")[1])
    write(tmp_path / "content", {**event, "accepted_terms": ["rescue"]})
    assert content_layer(tmp_path / "content")[0].ok


def test_an_event_about_a_series_the_catalog_does_not_have_fails_the_check(tmp_path):
    write(tmp_path / "content", {**EVENT, "related_series": ["unrate", "no_such_series"]})
    report, layer = content_layer(tmp_path / "content")
    assert not report.ok and "no_such_series" in said_by(layer) and "unrate" not in said_by(layer)


def test_a_file_that_is_not_an_event_fails_the_check_and_is_named(tmp_path):
    content = tmp_path / "content"
    write(content, EVENT)
    (content / "events" / "2031-05-05-broken.md").write_text("no front matter\n", encoding="utf-8")
    (content / "events" / "stray.txt").write_text("x", encoding="utf-8")
    said = said_by(content_layer(content)[1])
    assert "2031-05-05-broken.md" in said and "stray.txt" in said


def test_the_repositorys_own_content_passes_and_its_drafts_are_noted_not_failed():
    report = C.check()
    assert report.ok
    assert sum("is a draft" in note for note in report.notes) == 26  # the word list's own hits
    rendered = C.render(report)
    assert "content: ok" in rendered and "NOTE" in rendered


# --- atlas add note -----------------------------------------------------------------------------------


def test_add_note_writes_one_users_draft_outside_content_and_it_passes_the_check(tmp_path, capsys):
    notes = tmp_path / "notes"
    status, said = run(capsys, "add", "note", "--user", "alex", "--about", "series:unrate", "--date", "2031-02-04",
                       "--notes", str(notes), "Worth a second look after the benchmark revision.")
    assert status == 0, said
    (path,) = (notes / "alex").glob("*.md")
    assert path.name == "2031-02-04-worth-a-second-look-after-the-benchmark-revision.md"
    text = path.read_text(encoding="utf-8")
    assert 'user: "alex"' in text and "status: draft" in text and "Worth a second look" in text
    assert "never part of a public" in said
    (tmp_path / "content" / "events").mkdir(parents=True)
    report, layer = content_layer(tmp_path / "content", notes)
    assert report.ok, said_by(layer)


@pytest.mark.parametrize("about, said", [
    ("series:no_such_series", "no_such_series"),
    ("event:2031-02-03-x", "claim, series or topic"),
    ("unrate", "claim, series or topic"),
])
def test_add_note_refuses_a_note_about_nothing_it_knows(tmp_path, capsys, about, said):
    status, out = run(capsys, "add", "note", "--user", "alex", "--about", about, "--notes", str(tmp_path / "notes"), "Text.")
    assert status == 1 and said in out
    assert not (tmp_path / "notes").exists()


def test_a_note_in_another_users_folder_or_with_a_field_of_its_own_fails_the_check(tmp_path, capsys):
    notes = tmp_path / "notes"
    assert run(capsys, "add", "note", "--user", "alex", "--about", "topic:inflation", "--date", "2031-02-04",
               "--notes", str(notes), "A remark.")[0] == 0
    (path,) = (notes / "alex").glob("*.md")
    (notes / "sam").mkdir()
    (notes / "sam" / path.name).write_bytes(path.read_bytes())
    path.write_text(path.read_text(encoding="utf-8").replace("status: draft", "status: draft\nfinding: \"false\""), encoding="utf-8")
    (tmp_path / "content" / "events").mkdir(parents=True)
    said = said_by(content_layer(tmp_path / "content", notes)[1])
    assert "sam" in said and "finding" in said


def test_no_note_reaches_a_release(tmp_path, capsys):
    """The compiler has no door for notes: it reads content/events and the hand-entered layers."""
    from atlas.content.compile import compile_content
    notes = tmp_path / "content" / "notes"   # even one put under content/ by mistake
    assert run(capsys, "add", "note", "--user", "alex", "--about", "topic:inflation", "--notes", str(notes),
               "A remark seeded 5521.")[0] == 0
    (tmp_path / "content" / "events").mkdir(parents=True)
    for profile in ("local",):
        compiled = compile_content(profile=profile, content=tmp_path / "content", manual=None)
        assert b"5521" not in b"".join(compiled.files.values())
