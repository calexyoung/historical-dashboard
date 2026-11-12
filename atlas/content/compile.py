"""The content compiler (PLAN 4.3, 5 and M19; ADR 0033): what a Release's ``content/`` holds.

    compile_content(profile=..., content=..., manual=..., gate=...) -> Compiled

It reads files of the repository and nothing else: Events (``content/events/*.md``) and the
hand-entered layers (``catalog/manual/terms`` and ``catalog/manual/spans``). It writes two
files of the Release:

``content/events.json``
    The Events, whole and in the order of time. A public-profile Release holds the ``public``
    ones only: a draft is in no file of it, under any name. A local-profile Release holds the
    drafts too, each saying it is one.

``content/annotations.json``
    The projection every time axis draws from (one shape, PLAN 5): each Event in the file
    above as one Annotation, anchored as precisely as it is dated and no more; each term of
    government as a ``governance`` span; each dated span of a recession file as a
    ``recession``. An Annotation that came from a hand-entered file says where from
    (``provenance``), so that the rights check of a Release can ask the gate about it for as
    long as the Release is kept.

Two Profiles (PLAN 6.1). ``public``: a hand-entered layer is projected only when the gate
permits display of its Origin on production; one it refuses is left out and named in the
report. v1's own bands and recessions (``legacy_annotations``) are refused outright. ``local``:
asks for no signature, and keeps v1's bands and recessions for every set that no hand-entered
file provides. A set is hand-entered whole or v1's whole. v1's Events are not taken from the
converter at all: they are files now.

The compiler never fetches and never decides wording. A ``public`` Event whose text hits the
word list stops a public-profile compile, exactly as ``atlas check`` fails on it.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .. import manual
from ..release import ANNOTATIONS, EVENTS, LEGACY
from . import events as E
from . import wordlist as W

HAND_ENTERED = "hand_entered"
#: The fields of an Event a Release carries, in this order.
EVENT_FIELDS = ("id", "date", "end", "date_precision", "title", "category", "status", "topics",
                "related_series", "magnitude", "sources", "description")
CONTENT_DIR = E.ROOT / "content"


class ContentError(Exception):
    """The content as it stands cannot go into a Release of this Profile."""


@dataclass
class Compiled:
    """A Release's content files, and what its check report says of them."""

    files: dict[str, bytes] = field(default_factory=dict)
    report: list[dict] = field(default_factory=list)
    #: Every content file read, as (path below the content or manual directory, bytes).
    read: list[tuple[str, bytes]] = field(default_factory=list)


def dump(document) -> bytes:
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def event_anchor(event: dict) -> tuple[dict, dict]:
    """Where an Event sits on a time axis, and the attributes that say how precisely. A day is
    a date; a month or a year is that Period, never a day in it; an Event with an end is a
    span of whole days, first to last."""
    precision = event["date_precision"]
    if "end" in event:
        start, end = E.span(event)
        return {"type": "span", "start": start, "end": end}, ({} if precision == "day" else {"date_precision": precision})
    if precision == "day":
        return {"type": "date", "date": event["date"]}, {}
    return {"type": "period", "period": event["date"]}, {}


def event_annotation(event: dict) -> dict:
    """The one Annotation an Event is drawn as. Both release validators hold a Release to it."""
    anchor, attributes = event_anchor(event)
    first = event["sources"][0]
    out = {"id": f"event-{event['id']}", "kind": "event", "anchor": anchor, "label": event["title"],
           "ref": f"content/events/{event['id']}.md",
           "source": {name: first[name] for name in ("name", "url", "archive_url") if name in first},
           "category": event["category"]}
    return {**out, **({"attributes": attributes} if attributes else {})}


def _cited(citation: dict) -> dict:
    out = {"name": f"{citation['publisher']}, {citation['title']}", "url": citation["url"]}
    return {**out, **({"archive_url": citation["archive_url"]} if citation.get("archive_url") else {})}


def _provenance(document: dict) -> dict:
    return {"producer": document["origin"]["producer"], "dataset": document["origin"]["dataset"],
            "via": HAND_ENTERED, "representation": "native"}


def term_annotations(document: dict) -> list[dict]:
    out = []
    for term in document["terms"]:
        out.append({"id": f"governance-{document['office']}-{term['start']}", "kind": "governance",
                    "anchor": {"type": "span", "start": term["start"], "end": term["end"]},
                    "label": term["holder"], "ref": None, "source": _cited(term["citation"]),
                    "category": document["office"],
                    **({"attributes": {"party": term["party"]}} if "party" in term else {}),
                    "provenance": _provenance(document)})
    return out


def span_annotations(document: dict) -> list[dict]:
    return [{"id": f"{document['layer']}-{span['start'][:7]}", "kind": document["layer"],
             "anchor": {"type": "span", "start": span["start"], "end": span["end"]},
             "label": span.get("label", document["label"]), "ref": None, "source": _cited(span["citation"]),
             "provenance": _provenance(document)} for span in document["spans"]]


def _layers(manual_dir: Path | None, read: list[tuple[str, bytes]]) -> list[tuple[str, dict, list[dict]]]:
    """Each hand-entered layer file as (its name, the document, its Annotations)."""
    if manual_dir is None:
        return []
    out = []
    for kind, paths, reader, project in (
            ("terms", manual.terms_files(manual_dir), manual.read_terms_file, term_annotations),
            ("spans", manual.spans_files(manual_dir), manual.read_spans_file, span_annotations)):
        for path in paths:
            body, problems = path.read_bytes(), []
            document = reader(body, problems)
            if document is None:
                raise ContentError(f"{path}: {problems[0]}")
            read.append((f"{kind}/{path.name}", body))
            out.append((f"{kind}/{path.stem}", document, project(document)))
    return out


def compile_content(*, profile: str, content: Path | None = None, manual: Path | None = None,
                    gate=None, legacy_annotations: list[dict] | None = None) -> Compiled:
    """The content files of a Release of ``profile``. ``content`` is the directory that holds
    ``events/`` (default the repository's ``content``); ``manual`` the hand-entered directory
    (``catalog/manual``; None: no hand-entered layer is read); ``gate`` the rights gate a
    public Profile asks; ``legacy_annotations`` what the legacy converter projected from v1's
    bands and its recession series. Raises ``ContentError``."""
    if profile not in ("public", "local"):
        raise ContentError(f"unknown profile {profile!r}")
    if profile == "public" and legacy_annotations:
        raise ContentError("v1's bands and recessions are never part of a public-profile release")
    if profile == "public" and gate is None:
        raise ContentError("a public-profile release needs the rights gate")
    content = CONTENT_DIR if content is None else Path(content)
    out = Compiled()

    # --- Events ---
    paths = E.event_files(content / "events")
    events, problems = E.load_events(content / "events")
    if problems:
        raise ContentError("; ".join(problems[:5]) + (f" (and {len(problems) - 5} more)" if len(problems) > 5 else ""))
    out.read += [(f"events/{path.name}", path.read_bytes()) for path in paths]
    drafts = [event for event in events if event["status"] == "draft"]
    if profile == "public":
        events = [event for event in events if event["status"] == "public"]
        loaded = [f"{event['id']} ({', '.join(sorted({t for found in W.event_terms(event).values() for t in found}))})"
                  for event in events if W.event_terms(event)]
        if loaded:
            raise ContentError("a public Event's text hits the word list (atlas/content/wordlist.py): "
                               + "; ".join(loaded[:5]))
    compiled_events = [{name: event[name] for name in EVENT_FIELDS if name in event} for event in events]
    annotations = [event_annotation(event) for event in events]
    left_out = f"; {len(drafts)} draft{'' if len(drafts) == 1 else 's'} left out" if profile == "public" and drafts else ""
    if (content / "events").is_dir():
        out.report.append({"check": "content", "outcome": "pass",
                           "detail": f"{len(events)} Event{'' if len(events) == 1 else 's'}{left_out}"})
    else:
        # Never silently: a writer that cannot see the content (an image built without it)
        # publishes a Release with no Event, and its check report says why.
        out.report.append({"check": "content", "outcome": "warn",
                           "detail": f"there is no directory {content / 'events'}: no Event is in this Release"})

    # --- hand-entered layers ---
    refused, taken = [], set()
    for name, document, projected in _layers(manual, out.read):
        if profile == "public":
            decision = gate.permits([{"origin": document["origin"]["producer"],
                                      "dataset": document["origin"]["dataset"], "channel": HAND_ENTERED,
                                      "representation": "native", "permission": "display"}], "production")
            if not decision.allowed:
                refused.append(f"{name}: {decision.reason}")
                continue
        annotations += projected
        taken.add(("governance", document["office"]) if document["kind"] == "terms" else (document["layer"], None))
    if refused:
        out.report.append({"check": "content: hand-entered layers", "outcome": "warn",
                           "detail": ("left out: " + "; ".join(refused))[:2000]})

    # --- v1's bands and recessions, where no hand-entered file has the set (local only) ---
    for annotation in legacy_annotations or []:
        if annotation["kind"] == "event":
            raise ContentError("Events come from content/events, not from the legacy converter")
        if annotation.get("provenance", {}).get("representation") != LEGACY:
            raise ContentError(f"{annotation['id']} does not say it is v1's")
        key = (annotation["kind"], annotation.get("category") if annotation["kind"] == "governance" else None)
        if key not in taken:
            annotations.append(annotation)

    seen: set[str] = set()
    for annotation in annotations:
        if annotation["id"] in seen:
            raise ContentError(f"two Annotations would share the id {annotation['id']}")
        seen.add(annotation["id"])
    out.files[EVENTS] = dump({"events": compiled_events})
    out.files[ANNOTATIONS] = dump({"annotations": annotations})
    return out
