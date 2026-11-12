"""Hand-entered files (PLAN 6 and M16; ADR 0030): figures and terms of office that no source
serves as data, typed in from a published record, each with its citation.

Two kinds of file, both strict JSON under ``catalog/manual/``:

- a **series file** (``catalog/manual/{name}.json``): Observations of one or more Series, each
  ``{period, value, citation}``, optionally with the ``working`` that shows how the value
  follows from the figures the cited page prints. The ``manual`` adapter of the capture kit
  reads it like any other source, so a correction is a recorded revision with a retrieval time
  (``atlas/capture/adapters.py``).
- a **terms file** (``catalog/manual/terms/{name}.json``): who held an office and when. A term
  of government is an Annotation, not a Series (CONTEXT.md); this module validates and loads
  the file, and the projection into a Release's annotations belongs to M19.

A citation says where a person can check the entry: who published it, what it is called, its
address, the day it was read and where on the page or in the document the figure is. The day
a citation was read is not a retrieval time; that is the Capture's.

Nothing here grants anything. Whether a file may exist in the repository at all is the rights
gate's answer for its Origin (``atlas check``): a committed file is a public copy.
"""
from __future__ import annotations

import json
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

from .period import FREQUENCIES, period_bounds

FORMAT = 1
#: Where a hand-entered series file may be, relative to the repository: one flat directory.
FILE = re.compile(r"catalog/manual/[a-z0-9][a-z0-9_-]{0,63}\.json")
ROOT = Path(__file__).resolve().parents[1]
MANUAL_DIR = ROOT / "catalog" / "manual"
CITATION_FIELDS = ("publisher", "title", "url", "accessed", "locator")
FORMULAS = ("two_party_margin",)
_NUMBER = re.compile(r"-?[0-9]+(\.[0-9]+)?")
_COUNT = re.compile(r"[0-9]+")
_NAME = re.compile(r"[a-z0-9][a-z0-9_]{0,63}")
PARTIES = ("D", "R", "I")
#: A value checked against its working is written with at most this many decimals.
MAX_PLACES = 6


def _strict(pairs):
    out = {}
    for name, value in pairs:
        if name in out:
            raise ValueError(f"the name {name!r} is given twice")
        out[name] = value
    return out


def _load(body: bytes, problems: list[str]) -> dict | None:
    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=_strict)
    except UnicodeDecodeError:
        problems.append("the file is not UTF-8 text")
        return None
    except ValueError as error:
        problems.append(f"the file is not strict JSON ({error})")
        return None
    if not isinstance(value, dict):
        problems.append("the file is not a JSON object")
        return None
    return value


def _is_day(text: object) -> bool:
    try:
        return isinstance(text, str) and len(text) == 10 and date.fromisoformat(text).isoformat() == text
    except ValueError:
        return False


def _only(value: dict, allowed: tuple[str, ...], required: tuple[str, ...], what: str, problems: list[str]) -> bool:
    extra = sorted(set(value) - set(allowed))
    missing = [name for name in required if name not in value]
    if extra:
        problems.append(f"{what} has a field this format does not know: {extra[0]}")
    if missing:
        problems.append(f"{what} has no {missing[0]}")
    return not extra and not missing


def citation_problem(citation: object, read_by: str | None = None) -> str | None:
    """Why ``citation`` does not say where an entry can be checked, or None. ``read_by`` is the
    day the file was captured: a page cannot have been read after that."""
    if not isinstance(citation, dict):
        return "has no citation"
    extra = sorted(set(citation) - {*CITATION_FIELDS, "archive_url"})
    if extra:
        return f"has a citation with a field this format does not know: {extra[0]}"
    for name in CITATION_FIELDS:
        if not isinstance(citation.get(name), str) or not citation[name].strip():
            return f"has a citation with no {name}"
    for name in ("url", "archive_url"):
        if name in citation and not (isinstance(citation[name], str) and re.fullmatch(r"https://[^\s]+", citation[name])):
            return f"has a citation whose {name} is not an https address"
    if not _is_day(citation["accessed"]):
        return "has a citation that does not say the day it was read (accessed, as 2026-11-12)"
    if read_by is not None and citation["accessed"] > read_by:
        return f"has a citation read on {citation['accessed']}, after the file was captured ({read_by})"
    return None


def cited(citation: dict) -> str:
    """A citation in one line, as an Observation's footnote carries it."""
    return (f"{citation['publisher']}, {citation['title']}, {citation['locator']}. "
            f"{citation['url']} (read {citation['accessed']})")


def working_problem(value: str, working: object) -> str | None:
    """Why ``working`` does not lead to ``value``, or None. The value entered is checked against
    the figures given; it is never replaced by what they give.

    ``two_party_margin``: Democratic minus Republican votes over their sum, in percentage
    points, rounded to the decimals the value is written with, a half going away from zero."""
    if not isinstance(working, dict) or working.get("formula") not in FORMULAS:
        return f"has working whose formula is not one of: {', '.join(FORMULAS)}"
    if set(working) != {"formula", "democratic", "republican"}:
        return "has working that does not give exactly the democratic and republican votes"
    votes = [working["democratic"], working["republican"]]
    if not all(isinstance(v, str) and _COUNT.fullmatch(v) for v in votes):
        return "has working whose votes are not whole numbers written as text"
    democratic, republican = (Decimal(v) for v in votes)
    if democratic + republican == 0:
        return "has working with no votes at all"
    places = len(value.partition(".")[2])
    if places > MAX_PLACES:
        return f"has a value with more than {MAX_PLACES} decimals, which no working is checked to"
    try:
        margin = ((democratic - republican) / (democratic + republican) * 100).quantize(
            Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
        same = Decimal(value) == margin
    except InvalidOperation:
        return "has working that cannot be worked out (the figures are too long)"
    return None if same else (f"has the value {value}, and its working gives {margin} "
                              f"(the two-party margin of {votes[0]} and {votes[1]})")


def read_series_file(body: bytes, expect: dict, problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
    """The Observations of a hand-entered series file, by the file's own names, and what was
    counted. ``expect`` is what the endpoint pins: ``origin``, ``datasets``, ``frequency``,
    ``series`` (the names read), ``units`` and ``asked_on`` (the day of the capture, New York).
    Every reason the file is not whole goes into ``problems``; a file with one gives nothing."""
    checks: dict = {}
    document = _load(body, problems)
    if document is None:
        return {}, checks
    if not _only(document, ("format", "kind", "about", "origin", "frequency", "series"),
                 ("format", "kind", "origin", "frequency", "series"), "the file", problems):
        return {}, checks
    if document["format"] != FORMAT or isinstance(document["format"], bool) or document["kind"] != "series":
        problems.append(f"the file is not a hand-entered series file of format {FORMAT}")
        return {}, checks
    origin = document["origin"]
    if not (isinstance(origin, dict) and set(origin) == {"producer", "dataset"}):
        problems.append("the file does not name its Origin: a producer and a dataset")
        return {}, checks
    if origin["producer"] != expect["origin"]:
        problems.append(f"the file's Origin is {origin['producer']!r}, and the endpoint is on the "
                        f"register row of {expect['origin']!r}")
    if origin["dataset"] not in expect["datasets"]:
        problems.append(f"the file's dataset is {origin['dataset']!r}, which the endpoint does not name")
    if document["frequency"] != expect["frequency"]:
        problems.append(f"the file says its Periods are {document['frequency']!r}, and the endpoint "
                        f"expects {expect['frequency']!r}")
    listed = document["series"]
    if not isinstance(listed, dict):
        problems.append("the file's series is not an object")
        return {}, checks
    for name in expect["series"]:
        if name not in listed:
            problems.append(f"the file has no series {name}")
    for name in listed:
        if name not in expect["series"]:
            problems.append(f"the file has a series the endpoint does not read: {name}")
    if problems:
        return {}, checks
    frequency = expect["frequency"]
    out: dict[str, list[dict]] = {}
    for name in expect["series"]:
        block = listed[name]
        if not isinstance(block, dict) or not _only(block, ("unit", "note", "entries"), ("unit", "entries"),
                                                    f"series {name}", problems):
            if not isinstance(block, dict):
                problems.append(f"series {name} is not an object")
            continue
        if block["unit"] != expect["units"][name]:
            problems.append(f"series {name} is in {block['unit']!r}, and the endpoint expects "
                            f"{expect['units'][name]!r}")
        entries = block["entries"]
        if not isinstance(entries, list) or not entries:
            problems.append(f"series {name} has no entries")
            continue
        seen: dict[str, dict] = {}
        for entry in entries:
            if not isinstance(entry, dict):
                problems.append(f"series {name} has an entry that is not an object")
                continue
            period = entry.get("period")
            bounds = period_bounds(frequency, period) if isinstance(period, str) else None
            if bounds is None:
                problems.append(f"series {name} has an entry whose period, {period!r}, is not a "
                                f"{frequency} Period")
                continue
            what = f"series {name}, {period},"
            if not _only(entry, ("period", "value", "working", "citation", "note"),
                         ("period", "value", "citation"), what.rstrip(","), problems):
                continue
            if period in seen:
                problems.append(f"series {name} gives {period} twice")
                continue
            value = entry["value"]
            if not isinstance(value, str) or not _NUMBER.fullmatch(value):
                problems.append(f"{what} has a value that is not a number written as text: {value!r}")
                continue
            if bounds[0] > expect["asked_on"]:
                problems.append(f"{what} is for a Period that had not begun on {expect['asked_on']}")
            said = citation_problem(entry["citation"], expect["asked_on"])
            if said:
                problems.append(f"{what} {said}")
                continue
            if "working" in entry:
                said = working_problem(value, entry["working"])
                if said:
                    problems.append(f"{what} {said}")
            seen[period] = {"period": period, "value": value, "status": "observed",
                            "footnotes": [{"code": "citation", "text": cited(entry["citation"])}]}
        ordered = sorted(seen.values(), key=lambda o: period_bounds(frequency, o["period"]))
        if ordered:
            out[name] = ordered
            checks.setdefault("series", {})[name] = {"rows": len(ordered), "first": ordered[0]["period"],
                                                     "last": ordered[-1]["period"]}
    checks["citations"] = sum(len(rows) for rows in out.values())
    return ({} if problems else out), checks


def read_terms_file(body: bytes, problems: list[str], today: str | None = None) -> dict | None:
    """A terms file, checked: ``{office, label, origin, terms}`` with each term ``{holder, start,
    end, citation}`` and, where it is a fact of the record, ``party``. Terms are in order, do
    not overlap, and only the last may still be running (``end: null``). Dates are days, both
    ends inclusive. None, with the reasons in ``problems``, when the file is not whole."""
    document = _load(body, problems)
    if document is None:
        return None
    if not _only(document, ("format", "kind", "about", "origin", "office", "label", "terms"),
                 ("format", "kind", "origin", "office", "label", "terms"), "the file", problems):
        return None
    if document["format"] != FORMAT or isinstance(document["format"], bool) or document["kind"] != "terms":
        problems.append(f"the file is not a hand-entered terms file of format {FORMAT}")
        return None
    origin = document["origin"]
    if not (isinstance(origin, dict) and set(origin) == {"producer", "dataset"}
            and all(isinstance(v, str) and v for v in origin.values())):
        problems.append("the file does not name its Origin: a producer and a dataset")
    if not isinstance(document["office"], str) or not _NAME.fullmatch(document["office"]):
        problems.append("the file's office is not a short name in lower case")
    if not isinstance(document["label"], str) or not document["label"].strip():
        problems.append("the file has no label for its office")
    terms = document["terms"]
    if not isinstance(terms, list) or not terms:
        problems.append("the file has no terms")
        return None
    previous_end: str | None = ""
    for number, term in enumerate(terms, start=1):
        if not isinstance(term, dict):
            problems.append(f"term {number} is not an object")
            continue
        what = f"term {number}" + (f" ({term['holder']})" if isinstance(term.get("holder"), str) else "")
        if not _only(term, ("holder", "start", "end", "party", "citation", "note"),
                     ("holder", "start", "end", "citation"), what, problems):
            continue
        if not isinstance(term["holder"], str) or not term["holder"].strip():
            problems.append(f"{what} names no holder")
        if not _is_day(term["start"]) or not (term["end"] is None or _is_day(term["end"])):
            problems.append(f"{what} does not give its start and end as days (an end still to come is null)")
            continue
        if term["end"] is not None and term["end"] < term["start"]:
            problems.append(f"{what} ends before it starts")
        if previous_end is None:
            problems.append(f"{what} follows a term that has not ended")
        elif term["start"] <= previous_end:
            problems.append(f"{what} starts on {term['start']}, not after the term before it ended ({previous_end})")
        previous_end = term["end"]
        if "party" in term and term["party"] not in PARTIES:
            problems.append(f"{what} has a party that is not one of {', '.join(PARTIES)}")
        said = citation_problem(term["citation"], today)
        if said:
            problems.append(f"{what} {said}")
    return None if problems else document


def series_files(directory: Path | None = None) -> list[Path]:
    directory = MANUAL_DIR if directory is None else Path(directory)
    return sorted(directory.glob("*.json")) if directory.is_dir() else []


def terms_files(directory: Path | None = None) -> list[Path]:
    directory = (MANUAL_DIR if directory is None else Path(directory)) / "terms"
    return sorted(directory.glob("*.json")) if directory.is_dir() else []


def stray_files(directory: Path | None = None) -> list[Path]:
    """Everything under ``catalog/manual`` that is neither a series file nor a terms file:
    a file of another kind, or in another directory. Nothing else belongs there, and a file
    that no check reads could hold what no check has seen."""
    directory = MANUAL_DIR if directory is None else Path(directory)
    if not directory.is_dir():
        return []
    known = {*series_files(directory), *terms_files(directory)}
    return sorted(path for path in directory.rglob("*") if not path.is_dir() and path not in known)


def load_terms(directory: Path | None = None) -> list[dict]:
    """Every terms file under ``catalog/manual/terms``, checked. Raises ``ValueError`` naming
    the first file that is not whole. This is what M19's annotation projection reads."""
    out = []
    for path in terms_files(directory):
        problems: list[str] = []
        document = read_terms_file(path.read_bytes(), problems)
        if document is None:
            raise ValueError(f"{path}: {problems[0]}")
        out.append(document)
    return out


__all__ = ["FILE", "FORMAT", "FREQUENCIES", "MANUAL_DIR", "citation_problem", "cited", "load_terms",
           "read_series_file", "read_terms_file", "series_files", "stray_files", "terms_files", "working_problem"]
