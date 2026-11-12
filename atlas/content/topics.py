"""A Topic as a file (CONTEXT.md, Topic, Companion; PLAN 5 and M23; ADR 0037):
``content/topics/{slug}.md``.

The file is front matter between two ``---`` lines and nothing else: a Topic has no text of
its own. ``schema/topic.schema.json`` says what it is: labels, a definition quoted from a
cited source, and the names of Series and Events. What a schema cannot say is checked here:
the file's name, that the main Series is one of the member Series, that a Companion is not
the main Series and is not listed twice, and that nothing is written under the front matter.

``references`` holds a Topic to what it names: every Series is in the Catalog, every Event
is a file, the coverage matrix and its indicator exist, and a Companion's relation is one the
Catalog does not contradict. Every problem says the line of the file it is on, so a dangling
reference is found where it was typed.

``compiled`` is the Topic as a Release carries it: the same fields, the range's members
resolved from the coverage matrix (one Series per country; a row that stands for a group of
countries, the euro area, is left out, or its members would be counted twice), and the Events
that the Release holds. Series are carried by key whether or not the Release holds them: a
Topic's page says which it cannot show, and why.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

from . import events as E
from . import wordlist as W

TOPICS_DIR = E.ROOT / "content" / "topics"
SCHEMA_PATH = E.ROOT / "schema" / "topic.schema.json"
#: How a Companion may be related to the main Series (the schema's own list).
RELATIONS = ("component", "excludes_components", "input", "same_survey", "same_release")
#: The relations that say both Series are of one dataset of one agency.
_SAME_DATASET = ("component", "excludes_components", "same_survey")
_COUNTRY = re.compile(r"[A-Z]{3}")
#: The fields of a Topic a Release carries, in this order.
FIELDS = ("slug", "title", "segment", "status", "definition", "main", "series", "companions", "range", "events")

Found = tuple[int | None, str]


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


@dataclass(frozen=True)
class Topic:
    """One Topic as its file holds it, with where each part of it is written."""

    record: dict
    path: Path
    #: The line of the file each value is on, by its path in the front matter: ("main",),
    #: ("series", 2), ("companions", 0, "series"), ("range", "coverage"), ("events", 1).
    lines: dict[tuple, int]
    body: bytes

    @property
    def slug(self) -> str:
        return self.record["slug"]

    def line(self, *path) -> int | None:
        """The line a value is on; that of the nearest thing above it when it has none."""
        while path:
            if path in self.lines:
                return self.lines[path]
            path = path[:-1]
        return 1


def _lines(front: str) -> dict[tuple, int]:
    """Where each value of the front matter is written. The front matter begins on the file's
    second line."""
    out: dict[tuple, int] = {}

    def walk(node: yaml.Node, path: tuple) -> None:
        if path:
            out[path] = node.start_mark.line + 2
        if isinstance(node, yaml.MappingNode):
            for name, value in node.value:
                walk(value, (*path, name.value))
        elif isinstance(node, yaml.SequenceNode):
            for i, value in enumerate(node.value):
                walk(value, (*path, i))

    try:
        root = yaml.compose(front, Loader=yaml.SafeLoader)
    except yaml.YAMLError:
        return out
    if root is not None:
        walk(root, ())
    return out


def read_topic(body: bytes, name: str, path: Path | None = None) -> tuple[Topic | None, list[Found]]:
    """One Topic from the bytes of its file; or None and why not, each reason with its line."""
    try:
        parts = E.split(body.decode("utf-8"))
    except UnicodeDecodeError:
        return None, [(None, "the file is not UTF-8 text")]
    if parts is None:
        return None, [(1, "the file does not begin with front matter between two --- lines")]
    try:
        front = yaml.load(parts[0], Loader=E._Strict)  # noqa: S506 - a SafeLoader subclass
    except yaml.YAMLError as error:
        mark = getattr(error, "problem_mark", None)
        return None, [(mark.line + 2 if mark else 1, f"the front matter cannot be read: {str(error).splitlines()[0][:160]}")]
    if not isinstance(front, dict):
        return None, [(1, "the front matter is not a list of names and values")]
    lines = _lines(parts[0])
    topic = Topic(front, path if path is not None else Path(name), lines, body)
    problems: list[Found] = []
    for error in sorted(_validator().iter_errors(front), key=lambda e: list(map(str, e.absolute_path))):
        where = "/".join(str(part) for part in error.absolute_path) or "the front matter"
        problems.append((topic.line(*error.absolute_path), f"{where}: {error.message[:200]}"))
    if problems:
        return None, problems
    if parts[1]:
        # No free prose: a Topic is labels, a quoted definition and names (ADR 0037).
        after = len(parts[0].splitlines()) + 3
        problems.append((after, "text is written under the front matter: a Topic has no text of its own "
                                "(a definition is quoted in `definition`, with its source)"))
    if name != f"{front['slug']}.md":
        problems.append((topic.line("slug"), f"the file is not named for its slug (it would be {front['slug']}.md)"))
    if front["main"] not in front["series"]:
        problems.append((topic.line("main"), f"its main Series {front['main']} is not one of its member Series (`series`)"))
    seen: set[str] = set()
    for i, companion in enumerate(front["companions"]):
        if companion["series"] == front["main"]:
            problems.append((topic.line("companions", i, "series"), "a Companion is shown beside the main Series and is not the main Series itself"))
        if companion["series"] in seen:
            problems.append((topic.line("companions", i, "series"), f"the Companion {companion['series']} is listed twice"))
        seen.add(companion["series"])
    return (None, problems) if problems else (topic, [])


def own_terms(topic: Topic) -> list[tuple[int | None, str, list[str]]]:
    """Where a Topic's own words hit the word list (``atlas/content/wordlist.py``): its title,
    its range's label and the name of its source, each with its line. The quote is the
    agency's and is not held to the list."""
    record = topic.record
    places = [(("title",), "title", record["title"]),
              (("definition", "source", "name"), "source name", record["definition"]["source"]["name"])]
    if "range" in record:
        places.append((("range", "label"), "range label", record["range"]["label"]))
    return [(topic.line(*path), name, W.terms_in(text)) for path, name, text in places if W.terms_in(text)]


def topic_files(directory: Path | None = None) -> list[Path]:
    directory = TOPICS_DIR if directory is None else Path(directory)
    return sorted(directory.glob("*.md")) if directory.is_dir() else []


def said(path: Path | str, found: Found) -> str:
    """A problem as a person reads it: the file, the line, what is wrong."""
    line, message = found
    return f"{path}:{line}: {message}" if line is not None else f"{path}: {message}"


def load_topics(directory: Path | None = None) -> tuple[list[Topic], list[tuple[Path, Found]]]:
    """Every Topic under ``content/topics``, by slug, and every reason a file is not one."""
    topics, problems = [], []
    for path in topic_files(directory):
        topic, found = read_topic(path.read_bytes(), path.name, path)
        problems += [(path, each) for each in found]
        if topic is not None:
            topics.append(topic)
    return sorted(topics, key=lambda topic: topic.slug), problems


def members(wanted: dict, coverage: dict[str, dict]) -> tuple[dict | None, list[dict]]:
    """The indicator's column, and the Series the matrix gives for it, one per country, in the
    matrix's order. A row for a group of countries (its code is not a country's three letters)
    is left out: its members have rows of their own and would be counted twice."""
    matrix = coverage.get(wanted["coverage"])
    column = next((c for c in (matrix or {}).get("columns", []) if c["id"] == wanted["indicator"]), None)
    if matrix is None or column is None:
        return None, []
    out = []
    for row in matrix["rows"]:
        cell = row["cells"].get(column["id"]) or {}
        if _COUNTRY.fullmatch(row["country"]) and "series" in cell:
            out.append({"key": cell["series"], "country": row["country"]})
    return column, out


def _origins(key: str, catalog: dict[str, dict]) -> set[tuple[str, str]]:
    """The (producer, dataset) of every stored Series a Series rests on."""
    from ..catalog.load import leaves

    out = set()
    for leaf in leaves(key, catalog):
        origin = (catalog[leaf].get("source") or {}).get("origin") or {}
        out.add((origin.get("producer"), origin.get("dataset")))
    return out


def _inputs(key: str, catalog: dict[str, dict]) -> set[str]:
    """Every Series a Derived series is computed from, however many Recipes away."""
    out: set[str] = set()
    todo = [key]
    while todo:
        for each in (catalog.get(todo.pop(), {}).get("recipe") or {}).get("inputs", []):
            if each not in out:
                out.add(each)
                todo.append(each)
    return out


def _relation_problem(main: str, companion: dict, catalog: dict[str, dict]) -> str | None:
    """Why the Catalog contradicts the relation a Companion states; None when it does not. The
    Catalog can check where two Series come from and what one is computed from. That one
    measures a part of the other is the editor's statement, held to one agency's one dataset."""
    key, relation = companion["series"], companion["relation"]
    if relation == "input":
        return None if key in _inputs(main, catalog) else f"{main} is not computed from {key} (the Catalog's Recipes say so)"
    ours, theirs = _origins(main, catalog), _origins(key, catalog)
    if relation in _SAME_DATASET and (len(ours) != 1 or ours != theirs):
        return f"{key} and {main} do not rest on one dataset of one agency, which `{relation}` says they do"
    if relation == "same_release":
        # What an agency publishes in a release is a Series it produces, not one computed here.
        computed = next((each for each in (key, main) if "recipe" in catalog[each]), None)
        if computed:
            return (f"{computed} is computed by Macro Atlas, so no agency publishes it in a release: "
                    "name the Series it is computed from")
        if {p for p, _ in ours} != {p for p, _ in theirs} or len({p for p, _ in ours}) != 1:
            return f"{key} and {main} are not one agency's, which `same_release` says they are"
    return None


def references(topic: Topic, *, catalog: dict[str, dict] | set[str], events: set[str],
               coverage: dict[str, dict]) -> list[Found]:
    """What a Topic names that is not there, each with its line. ``catalog`` is the Catalog (a
    set of keys will do, and then no relation is checked); ``events`` the ids of the Events
    that are files; ``coverage`` the coverage matrices by name."""
    record, out = topic.record, []

    def series(key: str, *path) -> bool:
        if key not in catalog:
            out.append((topic.line(*path), f"it names the Series {key}, which is not in the catalog"))
            return False
        if isinstance(catalog, dict) and catalog[key].get("status") == "retired":
            out.append((topic.line(*path), f"{key} is retired: a Topic names Series that are still kept"))
            return False
        return True

    main = series(record["main"], "main")
    for i, key in enumerate(record["series"]):
        if key != record["main"]:
            series(key, "series", i)
    for i, companion in enumerate(record["companions"]):
        if series(companion["series"], "companions", i, "series") and main and isinstance(catalog, dict):
            wrong = _relation_problem(record["main"], companion, catalog)
            if wrong:
                out.append((topic.line("companions", i, "relation"), wrong))
    wanted = record.get("range")
    if wanted:
        series(wanted["series"], "range", "series")
        if wanted["coverage"] not in coverage:
            out.append((topic.line("range", "coverage"), f"there is no coverage matrix {wanted['coverage']} (catalog/coverage/{wanted['coverage']}.json)"))
        else:
            column, found = members(wanted, coverage)
            if column is None:
                out.append((topic.line("range", "indicator"), f"the coverage matrix {wanted['coverage']} has no column {wanted['indicator']}"))
            elif len(found) < 3:
                out.append((topic.line("range", "indicator"), f"{wanted['coverage']} gives {len(found)} countries a Series for {wanted['indicator']}: "
                                                              "a range needs at least three"))
            elif len({m["key"] for m in found}) != len(found):
                out.append((topic.line("range", "indicator"), f"{wanted['coverage']} gives one Series to two countries for {wanted['indicator']}"))
            else:
                for member in found:
                    if member["key"] not in catalog:
                        out.append((topic.line("range", "indicator"), f"its member {member['key']} is not in the catalog"))
                    elif isinstance(catalog, dict) and catalog[member["key"]].get("status") == "retired":
                        out.append((topic.line("range", "indicator"), f"its member {member['key']} is retired: a range is of Series that are still kept"))
    for i, event in enumerate(record["events"]):
        if event not in events:
            out.append((topic.line("events", i), f"it names the Event {event}, and there is no content/events/{event}.md"))
    return out


def compiled(topic: Topic, coverage: dict[str, dict], held_events: set[str]) -> tuple[dict, list[str]]:
    """The Topic as a Release carries it, and the Events it lists that the Release does not
    hold (a draft is in no public-profile Release, so neither is its id)."""
    record = topic.record
    out = {name: record[name] for name in FIELDS if name in record}
    left_out = [event for event in record["events"] if event not in held_events]
    out["events"] = [event for event in record["events"] if event in held_events]
    wanted = record.get("range")
    if wanted:
        column, found = members(wanted, coverage)
        out["range"] = {"series": wanted["series"], "label": wanted["label"],
                        "indicator": {"id": wanted["indicator"], "name": column["name"]}, "members": found}
    return out, left_out


def _quoted(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def serialise(record: dict) -> str:
    """The text of a Topic's file. ``read_topic`` of it gives the Topic back."""
    lines = ["---", f"slug: {_quoted(record['slug'])}", f"title: {_quoted(record['title'])}",
             f"segment: {record['segment']}", f"status: {record['status']}", "definition:",
             f"  quote: {_quoted(record['definition']['quote'])}", "  source:"]
    source = record["definition"]["source"]
    lines += [f"    {name}: {_quoted(source[name])}" for name in ("name", "url", "archive_url", "no_archive") if name in source]
    lines.append(f"main: {_quoted(record['main'])}")
    lines.append("series:")
    lines += [f"  - {_quoted(key)}" for key in record["series"]]
    lines.append("companions:" if record["companions"] else "companions: []")
    for companion in record["companions"]:
        lines += [f"  - series: {_quoted(companion['series'])}", f"    relation: {companion['relation']}"]
    if "range" in record:
        wanted = record["range"]
        lines += ["range:", f"  series: {_quoted(wanted['series'])}", f"  coverage: {_quoted(wanted['coverage'])}",
                  f"  indicator: {_quoted(wanted['indicator'])}", f"  label: {_quoted(wanted['label'])}"]
    lines.append("events:" if record["events"] else "events: []")
    lines += [f"  - {_quoted(event)}" for event in record["events"]]
    lines.append("---")
    return "\n".join(lines) + "\n"
