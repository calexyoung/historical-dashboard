"""Shared pieces for the Claim tests (PLAN M20): an invented Claim and a lock for it, built
by hand to the lock's schema. Every name, quote and value is invented; the Origin is the
fixtures' made-up one. Nothing here says what anybody said."""
from __future__ import annotations

import copy
from pathlib import Path

from atlas.content import claims as K

ORIGIN = "Macro Atlas fixture (synthetic)"
ARCHIVE = "https://web.archive.org/web/2031/"


def claim(**changes) -> dict:
    base = {
        "id": "2031-03-04-an-invented-official-on-the-jobless-rate",
        "claimant": {"name": "An Invented Official", "role": "Secretary of Examples", "party": "none"},
        "said_on": "2031-03-04",
        "venue": "A press conference that did not happen",
        "sources": [
            {"name": "Invented recording", "url": "https://video.example.org/briefing", "kind": "recording",
             "archive_url": ARCHIVE + "https://video.example.org/briefing", "locator": "at 12:40"},
            {"name": "Invented transcript", "url": "https://example.org/transcript", "kind": "transcript",
             "archive_url": ARCHIVE + "https://example.org/transcript", "locator": "paragraph 9"},
        ],
        "readings": [{"id": "rate-in-january", "series": "unrate", "transform": "lin", "measure": "value_at",
                      "period": "2031-01"}],
        "readings_not_measured": ["The rate among people aged 16 to 24."],
        "selection_note": "Kept as a test of the file format.",
        "checked_on": "2031-03-06",
        "corrections": [],
        "topics": [],
        "status": "draft",
        "quote": "The jobless rate was 4.1 percent in January.",
    }
    return {**copy.deepcopy(base), **changes}


def write_claim(content: Path, record: dict | None = None) -> Path:
    record = record or claim()
    path = Path(content) / "claims" / f"{record['id']}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(K.serialise(record), encoding="utf-8")
    return path


def row(state: str, value: float, as_of: str | None = None) -> dict:
    cutoff = None if as_of is None else {"instant": f"{as_of}T05:00:00Z", "day": as_of, "precision": "date",
                                        "zone": "America/New_York"}
    return {"state": state, "as_of": as_of, "cutoff": cutoff, "basis": None if as_of is None else "atlas_observed",
            "same_day_release": False,
            "inputs": [{"key": "unrate", "basis": None if as_of is None else "atlas_observed", "capture_gap": None,
                        "same_day_release": False, "unit": "percent", "last_capture": "2031-03-06T14:00:00Z"}],
            "unit": "percent", "figures": [{"name": "value", "value": value, "period": "2031-01", "status": "final"}],
            "window_sensitivity": [], "release_id": "20310306T150000Z-abcdef0", "semantics_version": "0.8.0"}


def lock(record: dict | None = None, *, version: int = 1, profile: str = "public", then: float = 4.1,
         now: float = 4.2, reason: str | None = None, **changes) -> dict:
    """A sealed lock of ``record`` as ``atlas claims compute`` would write it."""
    record = record or claim()
    body = {
        "format": 1, "claim_id": record["id"], "version": version, "locked_at": "2031-03-06T15:30:00Z",
        "reason": reason if version > 1 or reason else None, "supersedes": version - 1 if version > 1 else None,
        "record": K.record(record), "record_sha256": K.record_sha256(record),
        "release": {"release_id": "20310306T150000Z-abcdef0", "created": "2031-03-06T15:00:00Z", "profile": profile},
        "semantics_version": "0.8.0",
        "rights_used": [{"origin": ORIGIN, "dataset": "fixture jobs", "channel": "fixture", "representation": "native"}],
        "readings": [{"id": "rate-in-january", "series": "unrate", "freq": "monthly", "unit": "percent",
                      "transform": "lin", "measure": "value_at", "recipe": None,
                      "periods": [{"period": "2031-01", "start": "2031-01-01", "end": "2031-01-31"}],
                      "window": None, "alternative_windows": [],
                      "then": row("then", then, record["said_on"]), "now_when_checked": row("now_when_checked", now)}],
        **changes,
    }
    return K.sealed(body)


def write_lock(directory: Path, document: dict) -> Path:
    path = Path(directory) / K.lock_name(document["claim_id"], document["version"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(K.lock_bytes(document))
    return path
