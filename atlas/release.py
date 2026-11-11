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
from functools import cache, lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError, validators

from atlas.period import next_period, period_bounds

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema" / "release.schema.json"
SCHEMA_VERSION = "0.2.0"
#: Every version this reader knows; a writer writes ``SCHEMA_VERSION``. 0.2.0 (M10) added
#: ``vintages/`` and ``vintages_sha256``, so a 0.1.0 Release is one that holds neither.
SCHEMA_VERSIONS = ("0.1.0", SCHEMA_VERSION)

MANIFEST = "manifest.json"
CATALOG = "catalog.json"
ANNOTATIONS = "content/annotations.json"
REQUIRED_FILES = (MANIFEST, CATALOG, ANNOTATIONS)
_SERIES_FILE = re.compile(r"(series|derived|vintages)/([a-z][a-z0-9_]{0,63})\.json")
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
    for path in sorted(files):
        match = _SERIES_FILE.fullmatch(path)
        if match:
            series_paths[match[1]][match[2]] = path
        elif path not in REQUIRED_FILES:
            issues.append(Issue("unknown_file", path, "the release contract does not name this file"))
    for path in REQUIRED_FILES:
        if path not in files:
            issues.append(Issue("missing_file", path, "a release must have this file"))
    if any(i.code == "missing_file" for i in issues):
        return issues

    parsed: dict[str, object] = {}
    known = list(REQUIRED_FILES) + [p for folder in series_paths.values() for p in folder.values()]
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
    for error in sorted(_validator().iter_errors(bundle), key=lambda e: list(map(str, e.absolute_path))):
        path, pointer = _locate(list(error.absolute_path))
        issues.append(Issue("schema", path, f"{pointer}: {error.message}"[:400]))
    if any(i.code == "schema" for i in issues):
        return issues

    vintage_paths = series_paths.pop(VINTAGES)
    issues.extend(_cross_file_rules(release_id, bundle, files, series_paths))
    if not issues:  # a last stage: a vintage file is judged against Series files that are sound
        issues.extend(_vintage_rules(bundle, files, vintage_paths))
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
    file = {"manifest": MANIFEST, "catalog": CATALOG, "annotations": ANNOTATIONS}.get(head, str(head))
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
        channel_of = {line["hash"]: line["metadata"]["source"]["channel"]["via"] for line in doc["metadata"]}

        current: dict[str, dict] = {}
        seen: set = set()
        before = None
        for version in doc["rows"]:
            period = version["period"]
            if period_bounds(doc["freq"], period) != (version["period_start"], version["period_end"]):
                bad(f"{period}: its dates are not that Period's")
            start, stop = instant_key(version["recorded_from"]), version["recorded_to"]
            if stop is not None and instant_key(stop) < start:
                bad(f"{period}: a version is replaced before it was first held")
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
            elif (version["value"], version["status"]) != (observation["value"], observation["status"]):
                bad(f"{period}: the current version is not what series/{key}.json holds")
        for period in sorted(set(current) - listed):
            bad(f"{period}: a current version is not in series/{key}.json")
    return issues
