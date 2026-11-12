"""``python -m atlas add event`` and ``python -m atlas add note`` (PLAN 5, M19; ADR 0033).

Each writes one draft file and nothing else: it fetches nothing, commits nothing and never
overwrites a file. What it writes passes ``atlas check``.

An Event is written as a draft. Only a person makes one public, by editing the file, and
only Alex accepts a term of the word list for it; neither is an option here. A citation needs
an archived copy (``--archive-url``) or the reason there is none (``--no-archive``): the
command does not look one up and does not make a reason up.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from . import events as E
from . import notes as N
from . import wordlist as W
from .compile import CONTENT_DIR

CATEGORIES = ("political", "financial", "geopolitical", "health", "policy", "disaster", "infrastructure", "legislation")


class AddRefused(Exception):
    """The draft was not written."""


def slug(text: str, limit: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit].strip("-")


def _write_new(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "x", encoding="utf-8") as handle:
            handle.write(text)
    except FileExistsError:
        raise AddRefused(f"{path} already exists; edit it, or choose another title (an id is permanent)") from None


def add_event(args, series: set[str] | None = None) -> tuple[Path, list[str]]:
    """Write the draft Event the options describe. ``series`` is every key of the Catalog: an
    Event is not written about a Series that is not there. Raises ``AddRefused``."""
    unknown = [key for key in args.series or [] if series is not None and key not in series]
    if unknown:
        raise AddRefused(f"{', '.join(unknown)} is not a Series of the catalog (--series takes a key)")
    if bool(args.archive_url) == bool(args.no_archive):
        raise AddRefused("a citation needs an archived copy or the reason there is none: give "
                         "--archive-url URL or --no-archive REASON (one of them)")
    precision = {4: "year", 7: "month", 10: "day"}.get(len(args.date))
    if precision is None:
        raise AddRefused(f"{args.date} is not a day (YYYY-MM-DD), a month (YYYY-MM) or a year (YYYY)")
    name = slug(args.title)
    if not name:
        raise AddRefused("the title has no letter or digit to make an id from")
    source = {"url": args.source,
              **({"archive_url": args.archive_url} if args.archive_url else {"no_archive": args.no_archive})}
    event = {"id": f"{args.date}-{name}", "date": args.date, **({"end": args.end} if args.end else {}),
             "date_precision": precision, "title": args.title.strip(), "category": args.category,
             "status": "draft", "topics": list(args.topic or []), "related_series": list(args.series or []),
             "sources": [source], "description": (args.description or "").strip()}
    text = E.serialise(event)
    _, problems = E.read_event(text.encode("utf-8"), f"{event['id']}.md")
    if problems:
        raise AddRefused(f"that is not an Event: {problems[0]}")
    path = (Path(args.content) if args.content else CONTENT_DIR) / "events" / f"{event['id']}.md"
    _write_new(path, text)
    said = [f"wrote {path} (status: draft; a draft is in no public release)"]
    for field, terms in W.event_terms(event).items():
        said.append(f"note: its {field} has {', '.join(terms)}, on the word list of causal and evaluative terms. "
                    "A public Event states what happened; reword it before making it public.")
    if not event["description"]:
        said.append("note: it has no description. Write what happened and when under the front matter, "
                    "from the cited source.")
    said.append("next: python -m atlas check")
    return path, said


def add_note(args, series: set[str] | None) -> tuple[Path, list[str]]:
    """Write one user's draft note. Raises ``AddRefused``."""
    kind, _, target = args.about.partition(":")
    problem = N.about_problem(kind, target, series)
    if problem:
        raise AddRefused(problem)
    text = args.text.strip()
    if not text:
        raise AddRefused("a note has text")
    created = args.date or date.today().isoformat()
    note = {"id": f"{created}-{slug(text, 48) or 'note'}", "user": args.user, "about": {"kind": kind, "id": target},
            "created": created, "text": text}
    body = N.serialise(note)
    problems = N.read_note(body.encode("utf-8"), args.user, f"{note['id']}.md", series)
    if problems:
        raise AddRefused(f"that is not a note: {problems[0]}")
    path = (Path(args.notes) if args.notes else N.NOTES_DIR) / args.user / f"{note['id']}.md"
    _write_new(path, body)
    return path, [f"wrote {path} (status: draft)",
                  f"It is {args.user}'s own remark: kept outside content/ and never part of a public release.",
                  "next: python -m atlas check"]
