"""The content layer of ``atlas check`` (PLAN 5 and M19; ADR 0033).

It runs after the Catalog's four layers and holds Macro Atlas's own content to its rules:

- every file under ``content/events`` is an Event (``schema/event.schema.json``, real dates,
  named for its id), or the one record of the migration review; nothing else is kept there;
- every citation has an archived copy or says why not (the schema will not take one without);
- an Event's ``related_series`` are Series of the Catalog;
- the text of a ``public`` Event has no word of the list (``wordlist.py``) that the Event does
  not carry as accepted. A draft that has one is a note, not an error: a draft is in no
  public-profile Release, and saying so is how its wording gets decided;
- every file under ``notes/`` is one user's note, in that user's folder.

Reads files; fetches and writes nothing.
"""
from __future__ import annotations

from pathlib import Path

from ..catalog.load import Problem
from . import events as E
from . import notes as N
from . import wordlist as W
from .compile import CONTENT_DIR

LAYER = "content"
#: Files under content/events that are not Events.
RECORDS = ("migration-review.json",)


def check_content(series: set[str], content: Path | None = None,
                  notes: Path | None = None) -> tuple[list[Problem], list[str]]:
    """The problems of the content layer, and the notes (what a person should know that is
    not wrong). ``series`` is every key of the Catalog."""
    content = CONTENT_DIR if content is None else Path(content)
    events_dir = content / "events"
    problems: list[Problem] = []
    remarks: list[str] = []

    def problem(path: Path, message: str) -> None:
        problems.append(Problem(LAYER, str(path), message))

    if events_dir.is_dir():
        for path in sorted(events_dir.iterdir()):
            if path.is_dir() or (path.suffix != ".md" and path.name not in RECORDS):
                problem(path, "it is under content/events and is not an Event (ID.md): nothing else is kept there")
    seen: dict[str, Path] = {}
    for path in E.event_files(events_dir):
        event, found = E.read_event(path.read_bytes(), path.name)
        for said in found:
            problem(path, said)
        if event is None:
            continue
        seen[event["id"]] = path
        for key in event["related_series"]:
            if key not in series:
                problem(path, f"it names the Series {key}, which is not in the catalog")
        hits = W.event_terms(event)
        if not hits:
            continue
        where = "; ".join(f"its {field} has {', '.join(terms)}" for field, terms in hits.items())
        if event["status"] == "public":
            problem(path, f"{where}: a public Event's text states what happened and has no word of the list "
                          "(atlas/content/wordlist.py). Reword it, or make it a draft")
        else:
            remarks.append(f"{path.name} is a draft and {where} (the word list): it is in no public release "
                           "until its wording is decided")
    for path in N.note_files(notes):
        relative = path.relative_to(N.NOTES_DIR if notes is None else Path(notes))
        if len(relative.parts) != 2 or path.suffix != ".md":
            problem(path, "it is under notes/ and is not a note (notes/USER/ID.md): nothing else is kept there")
            continue
        for said in N.read_note(path.read_bytes(), relative.parts[0], path.name, series):
            problem(path, said)
    return problems, remarks
