"""``python -m atlas add event``, ``add note`` (PLAN 5, M19; ADR 0033) and ``add claim`` (M20;
ADR 0034).

Each writes one draft file and nothing else: it fetches nothing, commits nothing and never
overwrites a file. What it writes passes ``atlas check``.

An Event is written as a draft. Only a person makes one public, by editing the file, and
only Alex accepts a term of the word list for it; neither is an option here. A citation needs
an archived copy (``--archive-url``) or the reason there is none (``--no-archive``): the
command does not look one up and does not make a reason up.
"""
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from pathlib import Path

from . import claims as K
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


def add_claim(args, series: dict[str, dict], now: datetime | None = None) -> tuple[Path, list[str]]:
    """Write the draft Claim the options describe: the record, and at most one Reading (more
    are an edit to the file). ``series`` is the Catalog. A Claim is written as a draft with
    two archived records of the statement or not at all; no option makes one public and none
    takes a finding. Raises ``AddRefused``."""
    sources, kinds, archives, locators = (list(getattr(args, name) or []) for name in
                                          ("source", "source_kind", "archive_url", "locator"))
    if len(sources) < 2:
        raise AddRefused("a Claim needs two different records of the statement: give --source URL --kind KIND "
                         "--archive-url URL --locator WHERE twice (ADR 0011)")
    if not len(sources) == len(kinds) == len(archives) == len(locators):
        raise AddRefused("each --source needs its own --kind, --archive-url and --locator, in the same order: "
                         "a Claim's source has an archived copy, with no exception")
    name = slug(args.title)
    if not name:
        raise AddRefused("the title has no letter or digit to make an id from")
    readings = []
    if args.series:
        if args.series not in series:
            raise AddRefused(f"{args.series} is not a Series of the catalog (--series takes a key)")
        if not args.measure:
            raise AddRefused(f"--series needs --measure (one of {', '.join(K.MEASURES)})")
        reading = {"id": "r1", "series": args.series, **({"freq": args.freq} if args.freq else {}),
                   "transform": args.transform, "measure": args.measure}
        if args.period:
            reading["periods" if args.measure == "difference" else "period"] = (
                list(args.period) if args.measure == "difference" else args.period[0])
        if args.window_from or args.window_to:
            reading["window"] = {"from": args.window_from, "to": args.window_to}
        if args.which:
            reading["which"] = args.which
        if args.order:
            reading["order"] = args.order
        if args.alt_window:
            reading["alternative_windows"] = [dict(zip(("from", "to"), text.partition(":")[::2], strict=True))
                                              for text in args.alt_window]
        problem = K.reading_problem(reading, series[args.series]["freq"])
        if problem:
            raise AddRefused(f"that is not a reading: {problem}")
        readings.append(reading)
    elif args.measure:
        raise AddRefused("--measure needs --series")
    claim = {
        "id": f"{args.said_on}-{name}",
        "claimant": {"name": args.name.strip(), "role": args.role.strip(), "party": args.party.strip()},
        "said_on": args.said_on, **({"said_at": args.said_at} if args.said_at else {}),
        "venue": args.venue.strip(),
        "sources": [{"url": url, "archive_url": archive, "locator": locator.strip(), "kind": kind}
                    for url, kind, archive, locator in zip(sources, kinds, archives, locators, strict=True)],
        "readings": readings, "readings_not_measured": [text.strip() for text in args.not_measured or []],
        "selection_note": args.selection_note.strip(),
        # The day in New York, as compute holds it: a machine on UTC is a day ahead in the evening.
        "checked_on": args.checked_on or K.new_york_day(now or datetime.now(UTC)),
        "corrections": [], "topics": list(args.topic or []), "status": "draft", "quote": args.quote.strip(),
    }
    text = K.serialise(claim)
    _, problems = K.read_claim(text.encode("utf-8"), f"{claim['id']}.md")
    if problems:
        raise AddRefused(f"that is not a Claim: {problems[0]}")
    path = (Path(args.content) if args.content else CONTENT_DIR) / "claims" / f"{claim['id']}.md"
    _write_new(path, text)
    said = [f"wrote {path} (status: draft; a draft is in no public release)"]
    for field, terms in K.own_terms(claim).items():
        said.append(f"note: its {field} has {', '.join(terms)}, on the word list of causal and evaluative terms. "
                    "Reword it before making the Claim public. The quote is not held to the list.")
    note = K.same_host_note(claim)
    if note:
        said.append(f"note: {note}")
    if not readings:
        said.append("note: it has no reading. Add one under readings: in the file (docs/method/claims.md).")
    said.append("next: python -m atlas check")
    said.append(f"then: python -m atlas claims compute {claim['id']} --profile local")
    return path, said
