"""The content layer of ``atlas check`` (PLAN 5 and M19; ADR 0033).

It runs after the Catalog's four layers and holds Macro Atlas's own content to its rules:

- every file under ``content/events`` is an Event (``schema/event.schema.json``, real dates,
  named for its id), or the one record of the migration review; nothing else is kept there;
- every citation has an archived copy or says why not (the schema will not take one without);
- an Event's ``related_series`` are Series of the Catalog;
- the text of a ``public`` Event has no word of the list (``wordlist.py``) that the Event does
  not carry as accepted. A draft that has one is a note, not an error: a draft is in no
  public-profile Release, and saying so is how its wording gets decided;
- every file under ``notes/`` is one user's note, in that user's folder;
- every file under ``content/claims`` is a Claim held to the claim record rules (ADR 0011,
  ADR 0034): two different archived records of the statement, each with a locator; a
  selection note; a correction log; Readings that are Readings of Series in the Catalog; no
  field for a finding. A ``public`` Claim has a Reading, a lock, and own text clear of the
  word list (the quote is the claimant's and is not held to it);
- every file under ``content/claims/locks`` is a lock of one of those Claims, unedited, with
  the versions whole; the Claim's record is the one its newest lock froze; the lock was
  computed on a public-profile Release; and the rights gate permits display and
  redistribution of everything its numbers came through (a lock in the repository is a file
  of values).

Reads files; fetches and writes nothing.
"""
from __future__ import annotations

from pathlib import Path

from ..catalog.load import Problem
from . import claims as K
from . import events as E
from . import notes as N
from . import wordlist as W
from .compile import CONTENT_DIR

LAYER = "content"
#: Files under content/events that are not Events.
RECORDS = ("migration-review.json",)


def check_content(series: dict[str, dict] | set[str], content: Path | None = None,
                  notes: Path | None = None, gate=None) -> tuple[list[Problem], list[str]]:
    """The problems of the content layer, and the notes (what a person should know that is
    not wrong). ``series`` is the Catalog (key to entry; a set of keys will do where no Claim
    is checked). ``gate`` is the rights gate asked about the locks kept in the repository;
    with none, a lock there is refused."""
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
    problems += _claims(series, content / "claims", gate, remarks)
    for path in N.note_files(notes):
        relative = path.relative_to(N.NOTES_DIR if notes is None else Path(notes))
        if len(relative.parts) != 2 or path.suffix != ".md":
            problem(path, "it is under notes/ and is not a note (notes/USER/ID.md): nothing else is kept there")
            continue
        for said in N.read_note(path.read_bytes(), relative.parts[0], path.name, series):
            problem(path, said)
    return problems, remarks


def _claims(series, directory: Path, gate, remarks: list[str]) -> list[Problem]:
    """The claim record rules (ADR 0011, ADR 0034) over ``content/claims`` and its locks."""
    problems: list[Problem] = []

    def problem(path: Path, message: str) -> None:
        problems.append(Problem(LAYER, str(path), message))

    locks_dir = directory / K.LOCKS
    if directory.is_dir():
        for path in sorted(directory.iterdir()):
            if path.suffix != ".md" and path != locks_dir or path.is_dir() and path != locks_dir:
                problem(path, "it is under content/claims and is not a Claim (ID.md): nothing else is kept there")
    if locks_dir.is_dir():
        for path in sorted(locks_dir.iterdir()):
            if path.is_dir() or not path.name.endswith(".lock.json"):
                problem(path, "it is under content/claims/locks and is not a lock (CLAIM-ID.vN.lock.json)")
    by_claim, _raw, found = K.load_locks(locks_dir)
    for said in found:
        name, _, rest = said.partition(": ")
        problem(locks_dir / name, rest)
    seen: set[str] = set()
    for path in K.claim_files(directory):
        claim, found = K.read_claim(path.read_bytes(), path.name)
        for said in found:
            problem(path, said)
        if claim is None:
            # Not judged twice: a file that is not a Claim says nothing of its locks.
            seen.add(path.name[:-len(".md")])
            continue
        seen.add(claim["id"])
        for reading in claim["readings"]:
            entry = series.get(reading["series"]) if isinstance(series, dict) else None
            if reading["series"] not in series:
                problem(path, f"reading {reading['id']}: it names the Series {reading['series']}, which is not in the catalog")
            elif entry is not None:
                said = K.reading_problem(reading, entry["freq"])
                if said:
                    problem(path, f"reading {reading['id']}: {said}")
        locks = by_claim.get(claim["id"], [])
        said = K.stale(claim, locks)
        if said:
            problem(path, said)
        hits = K.own_terms(claim)
        where = "; ".join(f"its {field} has {', '.join(terms)}" for field, terms in hits.items())
        if claim["status"] == "public":
            if not claim["readings"]:
                problem(path, "it is public and has no reading: a public Claim is set beside at least one measured Reading")
            if not locks:
                problem(path, "it is public and has no lock in content/claims/locks: its evidence is computed and "
                              f"frozen first (python -m atlas claims compute {claim['id']} --profile public)")
            if hits:
                problem(path, f"{where}: a public Claim's own text says why it was recorded and what was not "
                              "measured, with no word of the list (atlas/content/wordlist.py). Reword it, or "
                              "make it a draft. The quote is not held to the list")
        elif hits:
            remarks.append(f"{path.name} is a draft and {where} (the word list): it is in no public release "
                           "until its wording is decided")
        note = K.same_host_note(claim)
        if note:
            remarks.append(f"{path.name}: {note}")
    for claim_id, locks in sorted(by_claim.items()):
        newest = locks_dir / K.lock_name(claim_id, locks[-1]["version"])
        if claim_id not in seen:
            problem(newest, f"there is no Claim {claim_id} for it to be a lock of")
        for lock in locks:
            path = locks_dir / K.lock_name(claim_id, lock["version"])
            if lock["release"]["profile"] != "public":
                problem(path, "it was computed on a local-profile Release, which may hold values that are not "
                              "cleared: such a lock stays in the local release root and is never committed")
                continue
            if gate is None:
                problem(path, "there is no rights register to ask whether its numbers may be kept in the repository")
                continue
            for permission in ("display", "redistribute"):
                decision = gate.permits(K.lineage_rows(lock, permission), "production")
                if not decision.allowed:
                    problem(path, f"its numbers may not be kept in the repository ({permission}): {decision.reason}")
                    break
    return problems
