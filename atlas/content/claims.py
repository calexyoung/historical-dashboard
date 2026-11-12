"""A Claim as a file, and a Claim lock (PLAN 4.5, 5 and M20; ADR 0011, ADR 0034).

``content/claims/{id}.md`` is front matter between two ``---`` lines, held to
``schema/claim.schema.json``, then the quote, verbatim. A Claim is a record (who said what,
when and where, with two archived records of it) and the Readings needed to examine it. No
schema here has a field for a finding, a rating or a label, and unknown fields are refused.

``content/claims/locks/{id}.v{n}.lock.json`` is a Claim lock: the frozen *then* and *now when
checked* Evidence rows of one recording of the Claim, with everything PLAN 4.5 lists. A lock
is never edited: it carries the hash of the rest of itself, and the hash of the Claim's record
as it stood. Recording the Claim afresh adds a version with a reason.

This module reads and checks; it computes no figure (the engine does, ADR 0003) and writes
nothing but through ``lock_bytes``, which the commands in ``atlas/publish/claims.py`` call.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, date, datetime
from functools import cache
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import yaml
from jsonschema import Draft202012Validator

from ..period import period_bounds
from . import events as E
from . import wordlist as W

CLAIMS_DIR = E.ROOT / "content" / "claims"
#: Where the repository keeps locks. A local release root keeps its own in ``{root}/locks``.
LOCKS = "locks"
SCHEMA_PATH = E.ROOT / "schema" / "claim.schema.json"
RELEASE_SCHEMA_PATH = E.ROOT / "schema" / "release.schema.json"
ZONE = ZoneInfo("America/New_York")

MEASURES = ("value_at", "change", "extreme", "rank", "difference")
TRANSFORMS = ("lin", "chg", "ch1", "pch", "pc1", "pca", "log", "rebase", "z", "drawdown")
WINDOWED = ("change", "extreme", "rank")
WINDOW_TRANSFORMS = ("rebase", "z", "drawdown")
NEEDS = {"value_at": ("period",), "change": ("window",), "extreme": ("window", "which"),
         "rank": ("period", "window", "order"), "difference": ("periods",)}
#: The part of a Claim a lock freezes, in the order it is written. Its status, topics and
#: corrections are not frozen: publishing a Claim, or logging a correction, changes no evidence.
RECORD_FIELDS = ("claimant", "said_on", "said_at", "venue", "sources", "quote", "readings",
                 "readings_not_measured", "selection_note", "checked_on")
#: Fields whose text is Macro Atlas's own and is held to the word list. The quote is the
#: claimant's; names, roles and venues are names.
OWN_TEXT = ("selection_note", "readings_not_measured")
_LOCK_NAME = re.compile(r"([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\.v([1-9][0-9]{0,3})\.lock\.json")
_ID = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
_KEY = re.compile(r"[a-z][a-z0-9_]{0,63}")


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


@cache
def _lock_validator() -> Draft202012Validator:
    schema = json.loads(RELEASE_SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft202012Validator({"$schema": schema["$schema"], "$ref": "#/$defs/claimLock", "$defs": schema["$defs"]})


def _is_day(text: object) -> bool:
    try:
        return isinstance(text, str) and date.fromisoformat(text).isoformat() == text
    except ValueError:
        return False


def new_york_day(instant: str | datetime) -> str:
    """The New York calendar day an instant falls on."""
    at = instant if isinstance(instant, datetime) else datetime.strptime(instant, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    return at.astimezone(ZONE).date().isoformat()


# --- a Reading ---------------------------------------------------------------------------------------


def _window_problem(window: object, what: str) -> str | None:
    if not isinstance(window, dict) or set(window) != {"from", "to"} or not (
            _is_day(window["from"]) and _is_day(window["to"])):
        return f"{what} is not two days of the calendar (from, to)"
    if window["to"] < window["from"]:
        return f"{what} ends before it starts"
    return None


def reading_problem(reading: object, series_freq: str) -> str | None:
    """Why ``reading`` is not a Reading of a Series of frequency ``series_freq``, or None. The
    engine applies the same rules (``readingProblem`` in packages/core/src/claim.ts);
    ``checks/claim-cases.json`` holds both to one table."""
    if not isinstance(reading, dict):
        return "it is not a set of names and values"
    if not isinstance(reading.get("id"), str) or not _ID.fullmatch(reading["id"]):
        return "its id is not a short name in lower case"
    if not isinstance(reading.get("series"), str) or not _KEY.fullmatch(reading["series"]):
        return "its series is not a Series key"
    measure, transform = reading.get("measure"), reading.get("transform")
    if measure not in MEASURES:
        return f"its measure is not one of {', '.join(MEASURES)}"
    if transform not in TRANSFORMS:
        return f"its transform is not one of {', '.join(TRANSFORMS)}"
    windowed = measure in WINDOWED
    allowed = {"id", "series", "transform", "measure", "freq", *NEEDS[measure], *(("alternative_windows",) if windowed else ())}
    for name in reading:
        if name not in allowed:
            return f"{measure} has no {name}"
    for name in NEEDS[measure]:
        if name not in reading:
            return f"{measure} needs " + {"window": "a window", "periods": "two periods"}.get(name, f"its {name}")
    if not windowed and transform in WINDOW_TRANSFORMS:
        return f"{transform} depends on a window, and {measure} has none"
    if "freq" in reading and reading["freq"] not in ("weekly", "monthly", "quarterly", "annual"):
        return "its freq is not weekly, monthly, quarterly or annual"
    freq = reading.get("freq", series_freq)

    def label(value: object) -> str | None:
        if isinstance(value, str) and period_bounds(freq, value) is not None:
            return None
        return f"{json.dumps(value)} is not a {freq.replace('_', ' ')} Period"

    if "period" in reading and label(reading["period"]):
        return label(reading["period"])
    if "periods" in reading:
        periods = reading["periods"]
        if not isinstance(periods, list) or len(periods) != 2:
            return "difference needs two periods"
        for period in periods:
            if label(period):
                return label(period)
        if periods[0] == periods[1]:
            return "its two periods are the same"
    if "which" in reading and reading["which"] not in ("max", "min"):
        return "its which is not max or min"
    if "order" in reading and reading["order"] not in ("highest", "lowest"):
        return "its order is not highest or lowest"
    if windowed:
        said = _window_problem(reading["window"], "its window")
        if said:
            return said
        others = reading.get("alternative_windows", [])
        if not isinstance(others, list):
            return "its alternative_windows is not a list"
        seen = {(reading["window"]["from"], reading["window"]["to"])}
        for other in others:
            said = _window_problem(other, "an alternative window")
            if said:
                return said
            if (other["from"], other["to"]) in seen:
                return "an alternative window repeats another window of the reading"
            seen.add((other["from"], other["to"]))
        if measure == "rank":
            start = period_bounds(freq, reading["period"])[0]
            for window in (reading["window"], *others):
                if not window["from"] <= start <= window["to"]:
                    return (f"its period {reading['period']} does not start inside the window "
                            f"{window['from']} to {window['to']}")
    return None


# --- a Claim -------------------------------------------------------------------------------------------


def read_claim(body: bytes, name: str) -> tuple[dict | None, list[str]]:
    """One Claim from the bytes of its file, with ``quote``; or None and why not. Everything a
    Claim's file can say by itself is checked here; whether its Series exist is the Catalog's
    to say (``atlas check``)."""
    try:
        parts = E.split(body.decode("utf-8"))
    except UnicodeDecodeError:
        return None, ["the file is not UTF-8 text"]
    if parts is None:
        return None, ["the file does not begin with front matter between two --- lines"]
    try:
        front = yaml.load(parts[0], Loader=E._Strict)  # noqa: S506 - a SafeLoader subclass
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
    for field in ("said_on", "checked_on", *(f"corrections/{i}/date" for i in range(len(front["corrections"])))):
        value = front
        for part in field.split("/"):
            value = value[int(part)] if isinstance(value, list) else value[part]
        if not _is_day(value):
            problems.append(f"its {field} {value} is not a day of the calendar")
    if problems:
        return None, problems
    if front["checked_on"] < front["said_on"]:
        problems.append(f"it was checked ({front['checked_on']}) before it was said ({front['said_on']})")
    if "said_at" in front:
        try:
            day = new_york_day(front["said_at"])
        except ValueError:
            problems.append(f"its said_at {front['said_at']} is not an instant of the calendar")
        else:
            if day != front["said_on"]:
                problems.append(f"its said_at {front['said_at']} is {day} in New York, and its said_on is {front['said_on']}")
    for name_, values in (("url", [s["url"] for s in front["sources"]]),
                          ("archive_url", [s["archive_url"] for s in front["sources"]])):
        if len(set(values)) != len(values):
            problems.append(f"two of its sources have one {name_}: a Claim needs two different records of the statement, each archived")
    seen: set[str] = set()
    for reading in front["readings"]:
        if reading["id"] in seen:
            problems.append(f"two readings share the id {reading['id']}")
        seen.add(reading["id"])
    if not front["id"].startswith(front["said_on"] + "-"):
        problems.append(f"its id {front['id']} does not start with its said_on {front['said_on']}")
    if name != f"{front['id']}.md":
        problems.append(f"the file is not named for its id (it would be {front['id']}.md)")
    if not parts[1]:
        problems.append("it has no quote: the statement, verbatim, goes under the front matter")
    if problems:
        return None, problems
    return {**front, "quote": parts[1]}, []


def _yaml(value, indent: int = 0) -> list[str]:
    """Block-style lines for a value, strings in double quotes, in the order given."""
    pad = "  " * indent
    lines: list[str] = []
    if isinstance(value, dict):
        for name, inner in value.items():
            if isinstance(inner, (dict, list)) and inner:
                lines.append(f"{pad}{name}:")
                lines += _yaml(inner, indent + 1)
            else:
                lines.append(f"{pad}{name}: {_scalar(inner)}")
    else:
        for inner in value:
            if isinstance(inner, dict):
                first, *rest = _yaml(inner, indent + 1)
                lines += [f"{pad}- {first.strip()}", *rest]
            else:
                lines.append(f"{pad}- {_scalar(inner)}")
    return lines


def _scalar(value) -> str:
    if isinstance(value, (dict, list)):
        return "[]" if isinstance(value, list) else "{}"
    return json.dumps(value, ensure_ascii=False)


#: The order a Claim's front matter is written in.
_ORDER = ("id", "claimant", "said_on", "said_at", "venue", "sources", "readings", "readings_not_measured",
          "selection_note", "checked_on", "corrections", "topics", "status")
_SOURCE_ORDER = ("name", "url", "archive_url", "locator", "kind")
_READING_ORDER = ("id", "series", "freq", "transform", "measure", "period", "periods", "window", "which", "order",
                  "alternative_windows")


def _ordered(mapping: dict, order: tuple[str, ...]) -> dict:
    return {**{name: mapping[name] for name in order if name in mapping},
            **{name: value for name, value in mapping.items() if name not in order}}


def serialise(claim: dict) -> str:
    """The text of a Claim's file. ``read_claim`` of it gives the Claim back."""
    front = _ordered({name: value for name, value in claim.items() if name != "quote"}, _ORDER)
    front["sources"] = [_ordered(source, _SOURCE_ORDER) for source in front.get("sources", [])]
    front["readings"] = [_ordered(reading, _READING_ORDER) for reading in front.get("readings", [])]
    quote = claim.get("quote", "").strip()
    return "\n".join(["---", *_yaml(front), "---"]) + "\n" + (f"\n{quote}\n" if quote else "")


def claim_files(directory: Path | None = None) -> list[Path]:
    directory = CLAIMS_DIR if directory is None else Path(directory)
    return sorted(directory.glob("*.md")) if directory.is_dir() else []


def load_claims(directory: Path | None = None) -> tuple[list[dict], list[str]]:
    """Every Claim under ``content/claims``, oldest first, and every reason a file is not one
    (each beginning with the file's name)."""
    claims, problems = [], []
    for path in claim_files(directory):
        claim, found = read_claim(path.read_bytes(), path.name)
        problems += [f"{path.name}: {problem}" for problem in found]
        if claim is not None:
            claims.append(claim)
    return sorted(claims, key=lambda claim: (claim["said_on"], claim["id"])), problems


def own_terms(claim: dict) -> dict[str, list[str]]:
    """Where a Claim's own text (never its quote) hits the word list."""
    out = {}
    for name in OWN_TEXT:
        value = claim.get(name, "")
        found = W.terms_in(" \n ".join(value) if isinstance(value, list) else value)
        if found:
            out[name] = found
    return out


def same_host_note(claim: dict) -> str | None:
    """A diagnostic, not a rule: two addresses on one host may still be two records, and two
    hosts may carry one. Whether the sources are different records is the editor's to say
    (each names its ``kind``)."""
    hosts = [urlsplit(source["url"]).hostname for source in claim["sources"]]
    if len(set(hosts)) < 2:
        return f"all its sources are on {hosts[0]}: make sure they are different records of the statement"
    return None


# --- the record a lock freezes ---------------------------------------------------------------------


def canonical(document) -> bytes:
    """One serialisation of a JSON value: names sorted, no spaces, UTF-8. What every hash here
    is taken of. Only Python writes and checks these hashes."""
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def record(claim: dict) -> dict:
    """The part of a Claim a lock freezes."""
    return {name: claim[name] for name in RECORD_FIELDS if name in claim}


def record_sha256(claim: dict) -> str:
    return hashlib.sha256(canonical(record(claim))).hexdigest()


# --- a lock --------------------------------------------------------------------------------------------


def lock_name(claim_id: str, version: int) -> str:
    return f"{claim_id}.v{version}.lock.json"


def sealed(body: dict) -> dict:
    """``body`` with the hash of itself: a lock as it is written. ``body`` has no hash yet."""
    body = {name: value for name, value in body.items() if name != "lock_sha256"}
    return {**body, "lock_sha256": hashlib.sha256(canonical(body)).hexdigest()}


def lock_bytes(lock: dict) -> bytes:
    return json.dumps(lock, ensure_ascii=False, indent=1, allow_nan=False).encode("utf-8") + b"\n"


def read_lock(body: bytes, name: str) -> tuple[dict | None, list[str]]:
    """One lock from the bytes of its file, or None and why it is not one: its shape, its
    name, and whether it is still the file that was written."""
    match = _LOCK_NAME.fullmatch(name)
    if not match:
        return None, ["it is not named as a lock is (CLAIM-ID.vN.lock.json)"]
    try:
        document = json.loads(body.decode("utf-8"), parse_constant=_no_constant)
    except (ValueError, UnicodeDecodeError) as error:
        return None, [f"it cannot be read: {str(error)[:160]}"]
    problems = []
    for error in sorted(_lock_validator().iter_errors(document), key=lambda e: list(map(str, e.absolute_path))):
        where = "/".join(str(part) for part in error.absolute_path) or "the lock"
        problems.append(f"{where}: {error.message[:200]}")
    if problems:
        return None, problems[:5]
    if (document["claim_id"], str(document["version"])) != (match[1], match[2]):
        return None, [f"it is not named for what it holds (it would be {lock_name(document['claim_id'], document['version'])})"]
    if sealed(document)["lock_sha256"] != document["lock_sha256"]:
        return None, ["it was edited after it was written (its hash is not the hash of its contents). A lock is "
                      "never edited: restore the file, or record the Claim afresh with atlas claims relock"]
    if hashlib.sha256(canonical(document["record"])).hexdigest() != document["record_sha256"]:
        return None, ["its record is not the one its record_sha256 names"]
    first = document["version"] == 1
    if first != (document["supersedes"] is None) or (not first and document["supersedes"] != document["version"] - 1):
        return None, ["its supersedes does not name the version before it"]
    if not first and not document["reason"]:
        return None, ["it is a relock and gives no reason"]
    return document, []


def _no_constant(name: str):
    raise ValueError(f"{name} is not JSON")


def lock_files(directory: Path) -> list[Path]:
    directory = Path(directory)
    return sorted(directory.glob("*.lock.json")) if directory.is_dir() else []


def load_locks(directory: Path) -> tuple[dict[str, list[dict]], dict[tuple[str, int], bytes], list[str]]:
    """Every lock in a directory: by Claim, oldest version first; the bytes of each file; and
    every reason a file is not a lock or a Claim's versions are not 1, 2, 3, ... (each
    beginning with the file's name)."""
    by_claim: dict[str, list[dict]] = {}
    raw: dict[tuple[str, int], bytes] = {}
    problems = []
    for path in lock_files(directory):
        body = path.read_bytes()
        document, found = read_lock(body, path.name)
        problems += [f"{path.name}: {problem}" for problem in found]
        if document is not None:
            by_claim.setdefault(document["claim_id"], []).append(document)
            raw[(document["claim_id"], document["version"])] = body
    for claim_id, locks in by_claim.items():
        locks.sort(key=lambda lock: lock["version"])
        have = [lock["version"] for lock in locks]
        for version in range(1, have[-1] + 1):
            if version not in have:
                problems.append(f"{lock_name(claim_id, have[-1])}: version {version} is missing: a Claim's locks are "
                                "kept whole, 1 to the newest")
    return by_claim, raw, problems


def stale(claim: dict, locks: list[dict]) -> str | None:
    """Why a Claim no longer agrees with its newest lock, or None."""
    if locks and locks[-1]["record_sha256"] != record_sha256(claim):
        changed = [name for name in RECORD_FIELDS if claim.get(name) != locks[-1]["record"].get(name)]
        return (f"its {', '.join(changed) or 'record'} changed since it was locked (v{locks[-1]['version']}): the locked "
                "evidence is of the record as it stood. Restore it, or record the Claim afresh: "
                f"python -m atlas claims relock {claim['id']} --profile P --reason WHY")
    return None


def lineage_rows(lock: dict, permission: str) -> list[dict]:
    return [{**row, "permission": permission} for row in lock["rights_used"]]


def rests_on(lock: dict) -> set[str]:
    """Every Series a lock's numbers came from: each Reading's, and what a Derived one rests on."""
    keys = set()
    for reading in lock["readings"]:
        keys.add(reading["series"])
        keys.update((reading["recipe"] or {}).get("rests_on", []))
        for row in (reading["then"], reading["now_when_checked"]):
            keys.update(item["key"] for item in row["inputs"])
    return keys
