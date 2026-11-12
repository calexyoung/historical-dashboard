"""An Event as a file (PLAN 5, M19; ADR 0033): ``content/events/{id}.md``.

The file is front matter between two ``---`` lines, then the description as text. The front
matter is the small part of YAML that ``serialise`` writes: one name to a line, strings in
double quotes, lists as ``- `` items. It is read strictly: a name given twice, a field the
schema does not have, a date YAML would turn into something other than text, are all refused,
with the reason. ``schema/event.schema.json`` says what an Event is; what a schema cannot say
(real calendar dates, an end after the start, the id and the file name) is checked here.
"""
from __future__ import annotations

import json
from datetime import date
from functools import cache
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
EVENTS_DIR = ROOT / "content" / "events"
SCHEMA_PATH = ROOT / "schema" / "event.schema.json"
#: The order ``serialise`` writes the front matter in: the schema's own.
_PRECISION_LENGTH = {"year": 4, "month": 7, "day": 10}


class _Strict(yaml.SafeLoader):
    """YAML as data only: no name twice in one mapping."""


def _mapping(loader: _Strict, node: yaml.MappingNode, deep: bool = False) -> dict:
    out = {}
    for name_node, value_node in node.value:
        name = loader.construct_object(name_node, deep=deep)
        if name in out:
            raise yaml.constructor.ConstructorError(None, None, f"the name {name!r} is given twice",
                                                    name_node.start_mark)
        out[name] = loader.construct_object(value_node, deep=deep)
    return out


_Strict.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


@cache
def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(_schema())


def _is_date(text: str) -> bool:
    try:
        date.fromisoformat({4: f"{text}-01-01", 7: f"{text}-01"}.get(len(text), text))
    except ValueError:
        return False
    return True


def _last_day(text: str) -> str:
    if len(text) == 4:
        return f"{text}-12-31"
    if len(text) == 7:
        year, month = int(text[:4]), int(text[5:])
        following = date(year + (month == 12), month % 12 + 1, 1)
        return date.fromordinal(following.toordinal() - 1).isoformat()
    return text


def span(event: dict) -> tuple[str, str]:
    """The first and the last day an Event covers, both inclusive: a month or a year is every
    day in it. This is what a time axis needs; it is never shown as the day something happened."""
    start = event["date"]
    first = {4: f"{start}-01-01", 7: f"{start}-01"}.get(len(start), start)
    return first, _last_day(event.get("end", start))


def split(text: str) -> tuple[str, str] | None:
    """The front matter and the body of a file, or None when it has no front matter."""
    if not text.startswith("---\n"):
        return None
    head, mark, body = text[4:].partition("\n---\n")
    if not mark:
        if not head.endswith("\n---"):
            return None
        head, body = head[:-4], ""
    return head, body.strip()


def read_event(body: bytes, name: str) -> tuple[dict | None, list[str]]:
    """One Event from the bytes of its file, with ``description``; or None and why not."""
    try:
        parts = split(body.decode("utf-8"))
    except UnicodeDecodeError:
        return None, ["the file is not UTF-8 text"]
    if parts is None:
        return None, ["the file does not begin with front matter between two --- lines"]
    try:
        front = yaml.load(parts[0], Loader=_Strict)  # noqa: S506 - a SafeLoader subclass
    except yaml.YAMLError as error:
        return None, [f"the front matter cannot be read: {str(error).splitlines()[0][:160]}"]
    if not isinstance(front, dict):
        return None, ["the front matter is not a list of names and values"]
    problems = []
    for error in sorted(_validator().iter_errors(front), key=lambda e: list(map(str, e.absolute_path))):
        where = "/".join(str(part) for part in error.absolute_path) or "the front matter"
        problems.append(f"{where}: {error.message[:200]}")
    if problems:
        return None, problems
    precision = front["date_precision"]
    for field in ("date", "end"):
        value = front.get(field)
        if value is None:
            continue
        if len(value) != _PRECISION_LENGTH[precision]:
            problems.append(f"its {field} {value} is not a {precision}, which its date_precision says it is"
                            if field == "date" else f"its end {value} is not in the precision of its date")
        elif not _is_date(value):
            problems.append(f"its {field} {value} is not a day of the calendar")
    if not problems and "end" in front and front["end"] < front["date"]:
        problems.append(f"it ends before it starts ({front['end']} is before {front['date']})")
    if not front["id"].startswith(front["date"] + "-"):
        problems.append(f"its id {front['id']} does not start with its date {front['date']}")
    if name != f"{front['id']}.md":
        problems.append(f"the file is not named for its id (it would be {front['id']}.md)")
    if problems:
        return None, problems
    return {**front, "description": parts[1]}, []


def _quoted(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def _citation(source: dict, indent: str) -> list[str]:
    names = [name for name in ("name", "url", "archive_url", "no_archive") if name in source]
    return [f"{indent}{'- ' if i == 0 else '  '}{name}: {_quoted(source[name])}" for i, name in enumerate(names)]


def serialise(event: dict) -> str:
    """The text of an Event's file. ``read_event`` of it gives the Event back."""
    lines = ["---", f"id: {_quoted(event['id'])}", f"date: {_quoted(event['date'])}"]
    if "end" in event:
        lines.append(f"end: {_quoted(event['end'])}")
    lines += [f"date_precision: {event['date_precision']}", f"title: {_quoted(event['title'])}",
              f"category: {event['category']}", f"status: {event['status']}"]
    for name in ("topics", "related_series"):
        values = event.get(name, [])
        lines.append(f"{name}: []" if not values else f"{name}:")
        lines += [f"  - {_quoted(value)}" for value in values]
    lines.append("sources:")
    for source in event["sources"]:
        lines += _citation(source, "  ")
    if event.get("accepted_terms"):
        lines.append("accepted_terms:")
        lines += [f"  - {_quoted(term)}" for term in event["accepted_terms"]]
    lines.append("---")
    description = event.get("description", "").strip()
    return "\n".join(lines) + "\n" + (f"\n{description}\n" if description else "")


def event_files(directory: Path | None = None) -> list[Path]:
    directory = EVENTS_DIR if directory is None else Path(directory)
    return sorted(directory.glob("*.md")) if directory.is_dir() else []


def order(events: list[dict]) -> list[dict]:
    """Events in the order of time: by the date as written (a month comes before its days, a
    year before its months), then by id. It is the order v1 kept its own in."""
    return sorted(events, key=lambda event: (event["date"], event["id"]))


def load_events(directory: Path | None = None) -> tuple[list[dict], list[str]]:
    """Every Event under ``content/events``, in order, and every reason a file is not one
    (each beginning with the file's name)."""
    events, problems = [], []
    for path in event_files(directory):
        event, found = read_event(path.read_bytes(), path.name)
        problems += [f"{path.name}: {problem}" for problem in found]
        if event is not None:
            events.append(event)
    return order(events), problems


def as_v1(event: dict) -> dict:
    """An Event in the shape v1 kept it (``atlas/events.yaml``): month, day, title, cat, url."""
    out = {"month": event["date"][:7]}
    if event["date_precision"] == "day":
        out["day"] = int(event["date"][8:])
    return {**out, "title": event["title"], "cat": event["category"], "url": event["sources"][0]["url"]}
