"""The Release contract, Python side: is this directory a valid Release? (PLAN 4.2, 4.3; ADR 0004)

A Release is the seam between the writer and every reader. ``validate_release(directory)``
returns the list of ways a directory breaks the contract; an empty list means it is valid. The
contract is ``schema/release.schema.json`` plus the cross-file rules in ``schema/README.md``.
The TypeScript twin is ``packages/core/src/release``; both run ``checks/release-cases.json`` and
report the same issue codes.

Structural validity is not authorisation. Whether a Series may appear on a Surface is decided by
``atlas.rights.permits`` over the rights register. The profile rules here (a public
Release holds no legacy data, no drafts, and names a signed register) are a second, independent
line of defence for the interim data rule (PLAN 6.1).
"""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from functools import cache, lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError, validators

from atlas.period import next_period, period_bounds

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema" / "release.schema.json"
SCHEMA_VERSION = "0.6.0"
#: Every version this reader knows; a writer writes ``SCHEMA_VERSION``. 0.2.0 (M10) added
#: ``vintages/`` and ``vintages_sha256``, so a 0.1.0 Release is one that holds neither. 0.3.0
#: (M19) added ``content/events.json``: a 0.3.0 Release must have it, an earlier one may not.
#: 0.4.0 (M20) added ``content/claims.json`` (required), ``locks/`` and ``evidence/latest.json``.
#: 0.5.0 (M22) added ``content/highlights.json`` and ``search.json`` (both required).
#: 0.6.0 (M23) added ``content/topics.json`` (required) and the Topics' entries of ``search.json``.
SCHEMA_VERSIONS = ("0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", SCHEMA_VERSION)
#: The versions that have no ``content/events.json``.
_BEFORE_EVENTS = ("0.1.0", "0.2.0")
#: The versions that have no Claims, locks or latest Evidence rows.
_BEFORE_CLAIMS = ("0.1.0", "0.2.0", "0.3.0")
#: The versions that have no headline Series and no search index.
_BEFORE_SEARCH = ("0.1.0", "0.2.0", "0.3.0", "0.4.0")
#: The versions that have no Topics.
_BEFORE_TOPICS = (*_BEFORE_SEARCH, "0.5.0")
#: The six Segments, in the order of the Overview (CONTEXT.md, Segment).
SEGMENTS = ("economy_jobs", "markets_money", "infrastructure", "governance_politics", "disasters_health",
            "us_in_the_world")
#: The fields of a Claim its lock freezes (atlas/content/claims.py, RECORD_FIELDS).
_CLAIM_RECORD = ("claimant", "said_on", "said_at", "venue", "sources", "quote", "readings",
                 "readings_not_measured", "selection_note", "checked_on")

MANIFEST = "manifest.json"
CATALOG = "catalog.json"
ANNOTATIONS = "content/annotations.json"
EVENTS = "content/events.json"
CLAIMS = "content/claims.json"
LATEST = "evidence/latest.json"
HIGHLIGHTS = "content/highlights.json"
SEARCH = "search.json"
TOPICS = "content/topics.json"
_OPTIONAL_FILES = (EVENTS, CLAIMS, LATEST, HIGHLIGHTS, SEARCH, TOPICS)
REQUIRED_FILES = (MANIFEST, CATALOG, ANNOTATIONS)
_SERIES_FILE = re.compile(r"(series|derived|vintages)/([a-z][a-z0-9_]{0,63})\.json")
_LOCK_FILE = re.compile(r"locks/([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.v[1-9][0-9]{0,3})\.lock\.json")
VINTAGES = "vintages"
_KIND_OF_FOLDER = {"series": "stored", "derived": "derived"}
LEGACY = "legacy_monthly_rounded"


@dataclass(frozen=True)
class Issue:
    """One way a directory breaks the Release contract."""

    code: str
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.code}: {self.path}: {self.message}"


@cache
def _ecma_pattern(pattern: str) -> re.Pattern:
    """Compile a schema pattern the way JavaScript reads it.

    JSON Schema patterns are ECMA 262 regular expressions, where a closing ``$`` matches only at
    the very end. Python's ``$`` also matches before a trailing newline, which would let
    ``"fx_key" + newline`` through here and not in the TypeScript twin.
    """
    if pattern.endswith("$") and not pattern.endswith("\\$"):
        pattern = pattern[:-1] + "\\Z"
    return re.compile(pattern)


def _pattern(validator, pattern, instance, schema):
    if validator.is_type(instance, "string") and not _ecma_pattern(pattern).search(instance):
        yield ValidationError(f"{instance!r} does not match {pattern!r}")


_ReleaseValidator = validators.extend(Draft202012Validator, {"pattern": _pattern})


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return _ReleaseValidator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def load_release(directory: Path) -> dict[str, bytes]:
    """Every file under a release directory, by its path relative to it (with forward slashes)."""
    directory = Path(directory)
    if not directory.is_dir():
        return {}
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def validate_release(directory: Path) -> list[Issue]:
    """The ways ``directory`` breaks the Release contract. Empty means valid."""
    directory = Path(directory)
    return validate_files(directory.name, load_release(directory))


def validate_files(release_id: str, files: Mapping[str, bytes]) -> list[Issue]:
    """As ``validate_release``, for a Release already read into memory.

    Checks run in stages and stop at the first stage that finds something, so a reader is never
    shown consequences of a problem instead of the problem: files present and named by the
    contract, JSON, schema version, schema, the cross-file rules, then the vintage files.
    """
    issues: list[Issue] = []
    series_paths: dict[str, dict[str, str]] = {"series": {}, "derived": {}, VINTAGES: {}}  # folder -> key -> path
    lock_paths: dict[str, str] = {}  # the lock's name (ID.vN) -> path
    for path in sorted(files):
        match = _SERIES_FILE.fullmatch(path)
        lock = _LOCK_FILE.fullmatch(path)
        if match:
            series_paths[match[1]][match[2]] = path
        elif lock:
            lock_paths[lock[1]] = path
        elif path not in REQUIRED_FILES and path not in _OPTIONAL_FILES:
            issues.append(Issue("unknown_file", path, "the release contract does not name this file"))
    for path in REQUIRED_FILES:
        if path not in files:
            issues.append(Issue("missing_file", path, "a release must have this file"))
    if any(i.code == "missing_file" for i in issues):
        return issues

    parsed: dict[str, object] = {}
    known = list(REQUIRED_FILES) + [p for folder in series_paths.values() for p in folder.values()]
    known += [path for path in _OPTIONAL_FILES if path in files] + list(lock_paths.values())
    for path in known:
        try:
            parsed[path] = json.loads(
                bytes(files[path]).decode("utf-8"),
                parse_constant=_no_constant,
                parse_float=_finite_float,
                parse_int=_finite_int,
                object_pairs_hook=_no_repeated_keys,
            )
        except (ValueError, UnicodeDecodeError) as error:
            issues.append(Issue("invalid_json", path, str(error)))
    if any(i.code == "invalid_json" for i in issues):
        return issues

    manifest = parsed[MANIFEST]
    version = manifest.get("schema_version") if isinstance(manifest, dict) else None
    if version is not None and version not in SCHEMA_VERSIONS:
        issues.append(
            Issue(
                "unsupported_schema_version",
                MANIFEST,
                f"this reader knows schema_version {' and '.join(SCHEMA_VERSIONS)}, not {version!r}",
            )
        )
        return issues
    if version == "0.1.0":
        for path in sorted(series_paths[VINTAGES].values()):
            issues.append(Issue("unknown_file", path, "schema_version 0.1.0 does not name this file"))
    if version in _BEFORE_EVENTS and EVENTS in files:
        issues.append(Issue("unknown_file", EVENTS, f"schema_version {version} does not name this file"))
    if version is not None and version not in _BEFORE_EVENTS and EVENTS not in files:
        issues.append(Issue("missing_file", EVENTS, "a release must have this file"))
    if version in _BEFORE_CLAIMS:
        for path in sorted(p for p in (CLAIMS, LATEST, *lock_paths.values()) if p in files):
            issues.append(Issue("unknown_file", path, f"schema_version {version} does not name this file"))
    elif version is not None and CLAIMS not in files:
        issues.append(Issue("missing_file", CLAIMS, "a release must have this file"))
    for path in (HIGHLIGHTS, SEARCH):
        if version in _BEFORE_SEARCH and path in files:
            issues.append(Issue("unknown_file", path, f"schema_version {version} does not name this file"))
        elif version is not None and version not in _BEFORE_SEARCH and path not in files:
            issues.append(Issue("missing_file", path, "a release must have this file"))
    if version in _BEFORE_TOPICS and TOPICS in files:
        issues.append(Issue("unknown_file", TOPICS, f"schema_version {version} does not name this file"))
    elif version is not None and version not in _BEFORE_TOPICS and TOPICS not in files:
        issues.append(Issue("missing_file", TOPICS, "a release must have this file"))
    if issues:
        return issues

    bundle = {
        "manifest": manifest,
        "catalog": parsed[CATALOG],
        "series": {key: parsed[path] for key, path in series_paths["series"].items()},
        "derived": {key: parsed[path] for key, path in series_paths["derived"].items()},
        "vintages": {key: parsed[path] for key, path in series_paths[VINTAGES].items()},
        "annotations": parsed[ANNOTATIONS],
    }
    if EVENTS in parsed:
        bundle["events"] = parsed[EVENTS]
    if CLAIMS in parsed:
        bundle["claims"] = parsed[CLAIMS]
        bundle["locks"] = {name: parsed[path] for name, path in lock_paths.items()}
    if LATEST in parsed:
        bundle["latest"] = parsed[LATEST]
    if HIGHLIGHTS in parsed:
        bundle["highlights"] = parsed[HIGHLIGHTS]
    if SEARCH in parsed:
        bundle["search"] = parsed[SEARCH]
    if TOPICS in parsed:
        bundle["topics"] = parsed[TOPICS]
    for error in sorted(_validator().iter_errors(bundle), key=lambda e: list(map(str, e.absolute_path))):
        path, pointer = _locate(list(error.absolute_path))
        issues.append(Issue("schema", path, f"{pointer}: {error.message}"[:400]))
    if any(i.code == "schema" for i in issues):
        return issues

    vintage_paths = series_paths.pop(VINTAGES)
    issues.extend(_cross_file_rules(release_id, bundle, files, series_paths))
    issues.extend(_claim_rules(bundle, files, lock_paths))
    if not issues:  # a last stage: a vintage file is judged against Series files that are sound
        issues.extend(_vintage_rules(bundle, files, vintage_paths))
    if not issues:  # and the headline Series and the search index against a Catalog and content that are
        issues.extend(_reading_rules(bundle))
    return issues


def _no_constant(name: str):
    raise ValueError(f"{name} is not JSON")


def _no_repeated_keys(pairs: list) -> dict:
    """JSON leaves a repeated key undefined; refuse it, so no two readers can see different values."""
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError("an object names a key twice")
    return obj


# Every number in a Release is a finite double, in both languages. Python would otherwise read
# 1e400 as infinity and an enormous integer exactly, where JavaScript reads both as Infinity.
def _finite_float(text: str) -> float:
    value = float(text)
    if value in (float("inf"), float("-inf")):
        raise ValueError(f"{text[:24]} is too large to be a number")
    return value


def _finite_int(text: str) -> int:
    try:
        value = int(text)
        float(value)
    except (ValueError, OverflowError):  # ValueError: past Python's digit limit for int()
        raise ValueError(f"{text[:24]}... is too large to be a number") from None
    return value


def _locate(parts: list) -> tuple:
    """Turn a path inside the bundle into (file, JSON pointer inside that file)."""
    if not parts:
        return MANIFEST, "/"
    head, rest = parts[0], parts[1:]
    if head in ("series", "derived", VINTAGES) and rest:
        return f"{head}/{rest[0]}.json", "/" + "/".join(map(str, rest[1:]))
    if head == "locks" and rest:
        return f"locks/{rest[0]}.lock.json", "/" + "/".join(map(str, rest[1:]))
    file = {"manifest": MANIFEST, "catalog": CATALOG, "annotations": ANNOTATIONS, "events": EVENTS,
            "claims": CLAIMS, "latest": LATEST, "highlights": HIGHLIGHTS, "search": SEARCH,
            "topics": TOPICS}.get(head, str(head))
    return file, "/" + "/".join(map(str, rest))


def _cross_file_rules(release_id, bundle, files, series_paths) -> list[Issue]:
    issues: list[Issue] = []

    def add(code: str, path: str, message: str) -> None:
        issues.append(Issue(code, path, message))

    manifest, catalog = bundle["manifest"], bundle["catalog"]
    if manifest["release_id"] != release_id:
        add(
            "release_id_mismatch",
            MANIFEST,
            f"release_id {manifest['release_id']!r} is not the directory name {release_id!r}",
        )

    entries: dict[str, dict] = {}
    for entry in catalog["series"]:
        if entry["key"] in entries:
            add("duplicate_key", CATALOG, f"{entry['key']} appears more than once")
        else:
            entries[entry["key"]] = entry

    withheld = set()
    for row in manifest["withheld"]:
        withheld.add(row["key"])
        if row["key"] not in entries:
            add("withheld_unknown", MANIFEST, f"withheld series {row['key']} is not in the catalog")

    # Files against the catalog.
    present: dict[str, list[str]] = {}  # key -> folders it has a file in
    for folder, by_key in series_paths.items():
        for key, path in by_key.items():
            present.setdefault(key, []).append(folder)
            entry = entries.get(key)
            if entry is None:
                add("orphan_series_file", path, f"{key} is not in the catalog")
            elif key in withheld:
                add("withheld_present", path, f"{key} is withheld, so the release may not hold its values")
            elif ("recipe" in entry) != (folder == "derived"):
                home = "derived/" if "recipe" in entry else "series/"
                add("misplaced_series_file", path, f"{key} belongs in {home}")
    for key in entries:
        if key not in withheld and key not in present:
            add("missing_series_file", CATALOG, f"{key} is not withheld but has no file")

    # Manifest rows against the files and the catalog.
    rows = manifest["series"]
    for key in sorted(present):
        if key not in rows:
            add("missing_manifest_row", MANIFEST, f"{key} has a file but no manifest row")
    for key, row in rows.items():
        if key not in present:
            code = "withheld_present" if key in withheld else "orphan_manifest_row"
            add(code, MANIFEST, f"{key} has a manifest row but no file")
            continue
        entry = entries.get(key)
        for folder in present[key]:
            path = series_paths[folder][key]
            if hashlib.sha256(bytes(files[path])).hexdigest() != row["sha256"]:
                add("hash_mismatch", path, "the file's bytes do not match the manifest's sha256")
            if _KIND_OF_FOLDER[folder] != row["kind"]:
                add("manifest_mismatch", MANIFEST, f"{key} is recorded as {row['kind']} but is in {folder}/")
        if entry is not None:
            expected = {
                "channel": entry["source"]["channel"]["via"],
                "rights_status": entry["rights"]["status"],
                "representation": entry["representation"],
            }
            for field, value in expected.items():
                if row[field] != value:
                    add(
                        "manifest_mismatch",
                        MANIFEST,
                        f"{key}: manifest {field} {row[field]!r} is not the catalog's {value!r}",
                    )

    # Each file against its catalog entry, then its Periods.
    for folder, by_key in series_paths.items():
        for key, path in by_key.items():
            doc = bundle[folder][key]
            entry = entries.get(key)
            if doc["key"] != key:
                add("series_mismatch", path, f"key {doc['key']!r} is not the file name")
            if entry is None:
                continue
            if doc["representation"] != entry["representation"]:
                add("series_mismatch", path, "representation is not the catalog's")
            if doc["freq"] != entry["freq"]:
                add("series_mismatch", path, f"freq {doc['freq']!r} is not the catalog's {entry['freq']!r}")
                continue
            issues.extend(_period_rules(path, doc))

    issues.extend(_recipe_rules(entries, withheld))

    # Annotations.
    seen = set()
    for annotation in bundle["annotations"]["annotations"]:
        if annotation["id"] in seen:
            add("duplicate_annotation_id", ANNOTATIONS, f"{annotation['id']} appears more than once")
        seen.add(annotation["id"])
        for key in annotation.get("series", []):
            if key not in entries:
                add("unknown_series_ref", ANNOTATIONS, f"{annotation['id']} names {key}, which is not in the catalog")
        anchor = annotation["anchor"]
        if anchor["type"] == "span" and anchor["end"] is not None and anchor["end"] < anchor["start"]:
            add("bad_anchor", ANNOTATIONS, f"{annotation['id']} ends before it starts")
    issues.extend(_event_rules(bundle))

    # Profile rules (PLAN 6.1): a second line of defence, not the rights gate.
    if manifest["profile"] == "public":
        if not manifest["rights_register"]["signed"]:
            add("unsigned_register", MANIFEST, "a public release must name a signed rights register")
        legacy = {k for k, e in entries.items() if e["representation"] == LEGACY}
        legacy |= {k for k, r in rows.items() if r["representation"] == LEGACY}
        legacy |= {k for f in ("series", "derived") for k, d in bundle[f].items() if d["representation"] == LEGACY}
        for key in sorted(legacy):
            add("legacy_in_public", CATALOG, f"{key} is in v1's legacy representation, which is never public")
        for key, entry in entries.items():
            if entry["status"] == "draft":
                add("draft_in_public", CATALOG, f"{key} is a draft")
        for event in bundle.get("events", {}).get("events", []):
            if event["status"] == "draft":
                add("draft_in_public", EVENTS, f"{event['id']} is a draft")
        for annotation in bundle["annotations"]["annotations"]:
            if annotation.get("provenance", {}).get("representation") == LEGACY:
                add("legacy_in_public", ANNOTATIONS,
                    f"{annotation['id']} is v1's, which is never public")
    return issues


def _claim_rules(bundle: dict, files: Mapping[str, bytes], lock_paths: dict[str, str]) -> list[Issue]:
    """0.4.0 (M20; ADR 0034): Claims, their locks and the latest Evidence rows agree. A lock
    file is the lock of a Claim in the Release, listed there with the hash of its bytes; a
    Claim's locks are listed whole, 1 to the newest, each in the Release or named without its
    numbers; and there is a latest row for the newest lock of exactly the Claims whose newest
    lock is in the Release. A public-profile Release holds no draft Claim, no public Claim
    without a lock, and no lock computed on a local-profile Release."""
    if "claims" not in bundle:
        return []
    issues: list[Issue] = []

    def add(code: str, path: str, message: str) -> None:
        issues.append(Issue(code, path, message))

    public = bundle["manifest"]["profile"] == "public"
    claims: dict[str, dict] = {}
    for claim in bundle["claims"]["claims"]:
        if claim["id"] in claims:
            add("duplicate_claim_id", CLAIMS, f"{claim['id']} appears more than once")
        claims[claim["id"]] = claim
        if public and claim["status"] == "draft":
            add("draft_in_public", CLAIMS, f"{claim['id']} is a draft")
        if public and not claim["locks"]:
            add("claim_lock", CLAIMS, f"{claim['id']} is public and has no lock")
        for index, row in enumerate(claim["locks"]):
            name = f"{claim['id']}.v{row['version']}"
            if row["version"] != index + 1:
                add("claim_lock", CLAIMS, f"{claim['id']}: its locks are not listed whole, 1 to the newest")
            if row["state"] == "in_release":
                if "sha256" not in row or "why" in row:
                    add("claim_lock", CLAIMS, f"{name} is in the release and is not listed with its hash alone")
                elif name not in lock_paths:
                    add("claim_lock", CLAIMS, f"{name} is listed as in the release and its file is not")
            elif "sha256" in row or "why" not in row:
                add("claim_lock", CLAIMS, f"{name} is not in the release and is not listed with the reason alone")
    need: dict[str, int] = {}
    for name, path in sorted(lock_paths.items()):
        lock = bundle["locks"][name]
        claim = claims.get(lock["claim_id"])
        if name != f"{lock['claim_id']}.v{lock['version']}":
            add("claim_lock", path, "the file is not named for the Claim and version it holds")
            continue
        row = next((r for r in (claim or {}).get("locks", []) if r["version"] == lock["version"]), None)
        if claim is None or row is None:
            add("claim_lock", path, "no Claim of the release lists this lock")
            continue
        if row.get("state") != "in_release" or row.get("sha256") != hashlib.sha256(files[path]).hexdigest():
            add("claim_lock", path, "it is not the file the Claim lists (state and sha256)")
        if row["record_sha256"] != lock["record_sha256"]:
            add("claim_lock", path, "its record_sha256 is not the one the Claim lists")
        if public and lock["release"]["profile"] != "public":
            add("claim_lock", path, "it was computed on a local-profile Release, which is never public")
        if lock["version"] == len(claim["locks"]):
            need[claim["id"]] = lock["version"]
            # The statement shown is the one the evidence was frozen for.
            changed = [name for name in _CLAIM_RECORD if claim.get(name) != lock["record"].get(name)]
            if changed:
                add("claim_lock", CLAIMS, f"{claim['id']}: its {', '.join(changed)} is not what its newest lock froze")
    held = bundle.get("latest")
    if held is None:
        for claim_id, version in sorted(need.items()):
            add("claim_evidence", LATEST, f"{claim_id} v{version} is in the release and has no latest row")
        return issues
    seen: set[str] = set()
    for entry in held["claims"]:
        claim_id = entry["claim_id"]
        if claim_id in seen or need.get(claim_id) != entry["lock_version"]:
            add("claim_evidence", LATEST, f"{claim_id} v{entry['lock_version']} is not the newest lock, in the "
                                          "release, of a Claim of the release, named once")
            continue
        seen.add(claim_id)
        lock = bundle["locks"][f"{claim_id}.v{entry['lock_version']}"]
        if [r["id"] for r in entry["readings"]] != [r["id"] for r in lock["record"]["readings"]]:
            add("claim_evidence", LATEST, f"{claim_id}: its latest rows are not the lock's readings, in order")
    for claim_id in sorted(set(need) - seen):
        add("claim_evidence", LATEST, f"{claim_id} v{need[claim_id]} is in the release and has no latest row")
    if not held["claims"]:
        add("claim_evidence", LATEST, "the file is there only when a lock has a latest row")
    return issues


def search_document(catalog: dict, withheld: list[dict], events: dict | None, claims: dict | None,
                    topics: dict | None = None) -> dict:
    """``search.json`` (0.5.0, M22; ADR 0036): what a reader can search for in a Release, as
    words. One entry for every Series of ``catalog.json``, then every Event, then every Claim,
    then (0.6.0, M23) every Topic,
    each in its file's order. It is a projection of those files and of the manifest's
    withheld list, and of nothing else: no Observation, lock or Evidence row is read to make it, so no
    value can enter it from data (a description or a quote is content a person wrote, public on
    its own page). Writers write exactly this; both validators hold a Release to it."""
    def words(*values) -> list[str]:
        return [value for value in values if isinstance(value, str) and value]

    gone = {row["key"] for row in withheld}
    entries = []
    for entry in catalog["series"]:
        origin = (entry.get("source") or {}).get("origin") or {}
        entries.append({
            "kind": "series", "id": entry["key"], "title": entry["name"], "text": entry.get("description") or "",
            "keywords": words(entry.get("unit"), origin.get("producer"), origin.get("dataset"),
                              origin.get("origin_id"), entry.get("country"), *entry.get("topics", [])),
            **({"withheld": True} if entry["key"] in gone else {})})
    for event in (events or {}).get("events", []):
        entries.append({"kind": "event", "id": event["id"], "title": event["title"], "text": event["description"],
                        "keywords": words(event["category"], event["date"], *event.get("topics", []))})
    for claim in (claims or {}).get("claims", []):
        who = claim["claimant"]
        entries.append({"kind": "claim", "id": claim["id"], "title": f"{who['name']}, {claim['said_on']}",
                        "text": claim["quote"],
                        "keywords": words(who["name"], who.get("role"), who.get("party"), *claim.get("topics", []))})
    for topic in (topics or {}).get("topics", []):
        # The text is the definition the Topic quotes: a cited source's words, public on its page.
        entries.append({"kind": "topic", "id": topic["slug"], "title": topic["title"],
                        "text": topic["definition"]["quote"],
                        "keywords": words(topic["segment"], topic["definition"]["source"]["name"], topic["main"])})
    return {"entries": entries}


def _reading_rules(bundle: dict) -> list[Issue]:
    """0.5.0 (M22; ADR 0036): the headline Series are Series of this Release, each under its own
    Segment, and the search index is the projection of the Release's own files and no more."""
    issues: list[Issue] = []
    held = bundle.get("highlights")
    if held is not None:
        segment_of = {entry["key"]: entry.get("segment") for entry in bundle["catalog"]["series"]}
        if [row["segment"] for row in held["segments"]] != list(SEGMENTS):
            issues.append(Issue("highlights", HIGHLIGHTS, "it does not list the six Segments once each, in the order of the Overview"))
        seen: set[str] = set()
        for row in held["segments"]:
            for key in row["series"]:
                if key not in segment_of:
                    issues.append(Issue("highlights", HIGHLIGHTS, f"{key} is not a Series of this release's catalog"))
                elif segment_of[key] != row["segment"]:
                    issues.append(Issue("highlights", HIGHLIGHTS, f"{key} is listed under {row['segment']} and the catalog puts it in {segment_of[key]}"))
                if key in seen:
                    issues.append(Issue("highlights", HIGHLIGHTS, f"{key} is listed more than once"))
                seen.add(key)
    issues.extend(_topic_rules(bundle))
    index = bundle.get("search")
    if index is not None:
        expected = search_document(bundle["catalog"], bundle["manifest"]["withheld"], bundle.get("events"),
                                   bundle.get("claims"), bundle.get("topics"))["entries"]
        entries = index["entries"]
        if len(entries) != len(expected):
            issues.append(Issue("search_projection", SEARCH, f"it holds {len(entries)} entries and the release's Series, Events, Claims and Topics are {len(expected)}"))
        for got, want in zip(entries, expected):
            if got != want:
                issues.append(Issue("search_projection", SEARCH, f"the entry for {want['kind']} {want['id']} is not the projection of the release's own files"))
    return issues


def _topic_rules(bundle: dict) -> list[Issue]:
    """0.6.0 (M23; ADR 0037): a Topic is listed once; its main Series is one of its member
    Series; a Companion is not the main Series and is listed once; a range has each member
    once; and every Event it lists is an Event of this Release. A Series is named by key
    whether or not the Release holds it, as an Event's related Series are. A public-profile
    Release holds no draft Topic."""
    issues: list[Issue] = []
    held = bundle.get("topics")
    if held is None:
        return issues
    events = {event["id"] for event in (bundle.get("events") or {}).get("events", [])}
    seen: set[str] = set()
    for topic in held["topics"]:
        slug = topic["slug"]
        if slug in seen:
            issues.append(Issue("duplicate_topic", TOPICS, f"{slug} appears more than once"))
        seen.add(slug)
        if topic["main"] not in topic["series"]:
            issues.append(Issue("topic", TOPICS, f"{slug}: its main Series {topic['main']} is not one of its member Series"))
        companions = [companion["series"] for companion in topic["companions"]]
        if topic["main"] in companions:
            issues.append(Issue("topic", TOPICS, f"{slug}: its main Series is listed as its own Companion"))
        if len(set(companions)) != len(companions):
            issues.append(Issue("topic", TOPICS, f"{slug}: a Companion is listed twice"))
        members = [member["key"] for member in (topic.get("range") or {}).get("members", [])]
        if len(set(members)) != len(members):
            issues.append(Issue("topic", TOPICS, f"{slug}: a member of its range is listed twice"))
        for event in topic["events"]:
            if event not in events:
                issues.append(Issue("topic", TOPICS, f"{slug}: it lists the Event {event}, which is not an Event of this release"))
        if bundle["manifest"]["profile"] == "public" and topic["status"] == "draft":
            issues.append(Issue("draft_in_public", TOPICS, f"{slug} is a draft"))
    return issues


def _last_day(text: str) -> str:
    if len(text) == 4:
        return f"{text}-12-31"
    if len(text) == 7:
        return period_bounds("monthly", text)[1]
    return text


def _event_anchor(event: dict) -> dict | None:
    """Where an Event sits on a time axis: a day is a date, a month or a year is that Period,
    and an Event with an end is a span of whole days. None when its dates are not ones a
    calendar has, or are not as precise as it says."""
    length = {"year": 4, "month": 7, "day": 10}[event["date_precision"]]
    values = [event["date"], *([event["end"]] if "end" in event else [])]
    try:
        for value in values:
            if len(value) != length:
                return None
            date.fromisoformat({4: f"{value}-01-01", 7: f"{value}-01"}.get(length, value))
    except ValueError:
        return None
    if "end" in event:
        start = {4: f"{event['date']}-01-01", 7: f"{event['date']}-01"}.get(length, event["date"])
        return {"type": "span", "start": start, "end": _last_day(event["end"])}
    if length == 10:
        return {"type": "date", "date": event["date"]}
    return {"type": "period", "period": event["date"]}


def _event_rules(bundle: dict) -> list[Issue]:
    """0.3.0: every Event is drawn as exactly one Annotation that says what the Event says,
    and every Annotation of kind ``event`` is the projection of an Event."""
    if "events" not in bundle:
        return []
    issues: list[Issue] = []
    events: dict[str, dict] = {}
    for event in bundle["events"]["events"]:
        if event["id"] in events:
            issues.append(Issue("duplicate_event_id", EVENTS, f"{event['id']} appears more than once"))
        events[event["id"]] = event
        anchor = _event_anchor(event)
        if anchor is None:
            issues.append(Issue("bad_event_date", EVENTS, f"{event['id']}: its date or end is not a "
                                f"{event['date_precision']} of the calendar"))
        elif anchor["type"] == "span" and anchor["end"] < anchor["start"]:
            issues.append(Issue("bad_event_date", EVENTS, f"{event['id']} ends before it starts"))
    projected: set[str] = set()
    for annotation in bundle["annotations"]["annotations"]:
        if annotation["kind"] != "event":
            continue
        ref = annotation["ref"] or ""
        identifier = ref[len("content/events/"):-len(".md")] if ref.startswith("content/events/") and ref.endswith(".md") else None
        event = events.get(identifier)
        if event is None or annotation["id"] != f"event-{identifier}":
            issues.append(Issue("event_projection", ANNOTATIONS,
                                f"{annotation['id']} is not the Annotation of an Event in {EVENTS}"))
            continue
        projected.add(identifier)
        first = event["sources"][0]
        source = {name: first[name] for name in ("name", "url", "archive_url") if name in first}
        if (annotation["label"], annotation.get("category"), annotation["anchor"], annotation["source"]) != (
                event["title"], event["category"], _event_anchor(event), source):
            issues.append(Issue("event_projection", ANNOTATIONS,
                                f"{annotation['id']} does not say what its Event says "
                                "(title, category, date or first citation)"))
    for identifier in events:
        if identifier not in projected:
            issues.append(Issue("event_projection", EVENTS, f"{identifier} has no Annotation"))
    return issues


def _period_rules(path: str, doc: dict) -> list[Issue]:
    issues: list[Issue] = []
    freq, observations = doc["freq"], doc["observations"]
    good: list[bool] = []
    for obs in observations:
        bounds = period_bounds(freq, obs["period"])
        ok = bounds == (obs["period_start"], obs["period_end"])
        good.append(ok)
        if not ok:
            want = f"{bounds[0]} to {bounds[1]}" if bounds else f"no {freq} period has that label"
            issues.append(
                Issue(
                    "bad_period",
                    path,
                    f"{obs['period']}: says {obs['period_start']} to {obs['period_end']}; expected {want}",
                )
            )
    for i in range(1, len(observations)):
        if not (good[i - 1] and good[i]):
            continue
        before, after = observations[i - 1], observations[i]
        if after["period_start"] <= before["period_start"]:
            issues.append(
                Issue("unordered_periods", path, f"{after['period']} does not come after {before['period']}")
            )
        elif freq != "irregular":
            expected: str | None = next_period(freq, before["period"])
            if after["period"] != expected:
                issues.append(
                    Issue(
                        "implicit_gap",
                        path,
                        f"{expected} is left out between {before['period']} and {after['period']}; "
                        "a gap must be an explicit missing observation",
                    )
                )
    if (
        doc["period_start"] != observations[0]["period_start"]
        or doc["period_end"] != observations[-1]["period_end"]
    ):
        issues.append(
            Issue("bounds_mismatch", path, "period_start and period_end are not the first and last observation's")
        )
    return issues


def _recipe_rules(entries: dict[str, dict], withheld: set) -> list[Issue]:
    """Structure only: inputs exist, no cycles, nothing shown that rests on a withheld input.

    Computing a Recipe is the engine's job alone (ADR 0003).
    """
    issues: list[Issue] = []

    def inputs_of(key: str) -> list[str]:
        return entries.get(key, {}).get("recipe", {}).get("inputs", [])

    def closure(key: str) -> set:
        seen: set = set()
        stack = list(inputs_of(key))
        while stack:
            current = stack.pop()
            if current not in seen:
                seen.add(current)
                stack.extend(inputs_of(current))
        return seen

    for key, entry in entries.items():
        if "recipe" not in entry:
            continue
        for name in entry["recipe"]["inputs"]:
            if name not in entries:
                issues.append(Issue("unknown_recipe_input", CATALOG, f"{key} takes {name}, which is not in the catalog"))
        reach = closure(key)
        if key in reach:
            issues.append(Issue("recipe_cycle", CATALOG, f"{key} depends on itself"))
        blocked = sorted(reach & withheld)
        if blocked and key not in withheld:
            issues.append(
                Issue("withheld_input", CATALOG, f"{key} is derived from withheld {', '.join(blocked)}")
            )
    return issues


def _same_number(a, b) -> bool:
    """Two values of a Release are the same when they are the same double: every reader takes
    a JSON number as one (schema/README.md, "Strict JSON"), and Python alone keeps an integer
    past 2**53 exact."""
    return a == b if a is None or b is None else float(a) == float(b)


def instant_key(text: str) -> str:
    """An Instant as text that sorts in time order: the fraction, if any, padded to nine digits.
    (``...:00Z`` and ``...:00.5Z`` do not sort as written.)"""
    whole, _, fraction = text[:-1].partition(".")
    return f"{whole}.{fraction:0<9}"


def _vintage_rules(bundle, files, vintage_paths: dict[str, str]) -> list[Issue]:
    """vintages/{key}.json against the manifest, the catalog and the Series' own file, then its
    own order in time (schema/README.md). Resolving an as-of question from the file is the
    engine's job alone (ADR 0003)."""
    issues: list[Issue] = []
    manifest = bundle["manifest"]
    entries = {entry["key"]: entry for entry in bundle["catalog"]["series"]}
    withheld = {row["key"] for row in manifest["withheld"]}

    for key, row in manifest["series"].items():
        if "vintages_sha256" in row and key not in vintage_paths:
            issues.append(Issue("manifest_mismatch", MANIFEST,
                                f"{key}: the manifest names a vintage file the release does not hold"))
    for key, path in vintage_paths.items():
        def bad(message: str, path=path) -> None:
            issues.append(Issue("vintage_mismatch", path, message))

        if key in withheld:
            issues.append(Issue("withheld_present", path,
                                f"{key} is withheld, so the release may not hold its past values"))
            continue
        series = bundle["series"].get(key)
        if series is None or key not in entries:
            issues.append(Issue("orphan_vintage_file", path, f"{key} has no file under series/"))
            continue
        row = manifest["series"].get(key, {})
        if "vintages_sha256" not in row:
            issues.append(Issue("manifest_mismatch", MANIFEST, f"{key}: the manifest has no vintages_sha256"))
        elif hashlib.sha256(bytes(files[path])).hexdigest() != row["vintages_sha256"]:
            issues.append(Issue("hash_mismatch", path, "the file's bytes do not match the manifest's vintages_sha256"))
        doc = bundle["vintages"][key]
        if doc["key"] != key:
            bad(f"key {doc['key']!r} is not the file name")
            continue
        if doc["freq"] != entries[key]["freq"]:
            bad(f"freq {doc['freq']!r} is not the catalog's {entries[key]['freq']!r}")
            continue
        if series["representation"] != doc["representation"]:
            bad(f"series/{key}.json is not in the native representation, so it has no vintages")
            continue

        coverage = doc["provider_coverage"]
        if coverage is not None and instant_key(coverage["from"]) > instant_key(coverage["to"]):
            bad("provider_coverage ends before it begins")
        times = [instant_key(capture["retrieved_at"]) for capture in doc["captures"]]
        if times != sorted(times):
            bad("captures are not oldest first")
        for capture in doc["captures"]:
            first, last = capture["scope"]
            if first is not None and last is not None and first > last:
                bad(f"the scope of the capture at {capture['retrieved_at']} ends before it begins")
        times = [instant_key(line["recorded_from"]) for line in doc["metadata"]]
        if times != sorted(times):
            bad("the metadata history is not oldest first")
        captured = {instant_key(capture["retrieved_at"]) for capture in doc["captures"]}
        channel_of: dict[str, str] = {}
        since: dict[str, str] = {}  # metadata hash -> when it was first recorded
        said: dict[str, str] = {}
        for line in doc["metadata"]:
            since.setdefault(line["hash"], instant_key(line["recorded_from"]))
            text = json.dumps(line["metadata"], sort_keys=True)
            if said.setdefault(line["hash"], text) != text:
                bad(f"two different metadata share the hash {line['hash'][:12]}")
            channel_of[line["hash"]] = line["metadata"]["source"]["channel"]["via"]

        current: dict[str, dict] = {}
        seen: set = set()
        before = None
        dated = None
        for version in doc["rows"]:
            period = version["period"]
            if period_bounds(doc["freq"], period) != (version["period_start"], version["period_end"]):
                bad(f"{period}: its dates are not that Period's")
            start, stop = instant_key(version["recorded_from"]), version["recorded_to"]
            if stop is not None and instant_key(stop) < start:
                bad(f"{period}: a version is replaced before it was first held")
            if start not in captured or (stop is not None and instant_key(stop) not in captured):
                bad(f"{period}: a version is held from or to a time that is no Capture's")
            if version["metadata"] in since and start < since[version["metadata"]]:
                bad(f"{period}: a version is held before the metadata it names was recorded")
            if before is None or before["period"] != period:
                dated = None  # the last version of this Period that the Origin dated
            if version["provider_from"] is not None:
                if dated is not None and (dated["provider_to"] is None or instant_key(
                        dated["provider_to"]) > instant_key(version["provider_from"])):
                    bad(f"{period}: two versions the Origin dated were in force at once")
                dated = version
            if version["provider_from"] is None:
                if version["provider_to"] is not None or version["provider_precision"] is not None:
                    bad(f"{period}: a version the Origin did not date carries a provider time")
            elif version["provider_precision"] is None:
                bad(f"{period}: a version the Origin dated does not say how precisely")
            elif version["provider_to"] is not None and instant_key(version["provider_to"]) < instant_key(version["provider_from"]):
                bad(f"{period}: a version is superseded before the Origin published it")
            if version["metadata"] not in channel_of:
                bad(f"{period}: a version names metadata the file does not hold")
            elif channel_of[version["metadata"]] != version["channel"]:
                bad(f"{period}: a version's Channel is not the one its metadata names")
            if before is not None and before["period"] == period:
                if before["recorded_to"] is None:
                    bad(f"{period}: more than one version is current")
                elif instant_key(before["recorded_to"]) > start:
                    bad(f"{period}: two versions were held at once")
            elif before is not None and (period in seen or version["period_start"] < before["period_start"]):
                bad(f"{period}: versions are not in Period order")
            seen.add(period)
            before = version
            if stop is None and not version["deleted"]:
                current[period] = version

        # The versions current now are the Series' own file, once its gaps are written out.
        listed = set()
        for observation in series["observations"]:
            period = observation["period"]
            listed.add(period)
            version = current.get(period)
            if version is None:
                if observation["value"] is not None or observation["status"] != "missing":
                    bad(f"{period}: series/{key}.json has a value that no current version holds")
            elif not _same_number(version["value"], observation["value"]) or version["status"] != observation["status"]:
                bad(f"{period}: the current version is not what series/{key}.json holds")
        for period in sorted(set(current) - listed):
            bad(f"{period}: a current version is not in series/{key}.json")
    return issues
