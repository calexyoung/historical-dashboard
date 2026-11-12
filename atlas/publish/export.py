"""The allowlist export (PLAN 4.3, 4.4 step 2, M9; ADR 0006, ADR 0023): the files of a Release,
built in memory from the vintage store.

``build`` reads each Series the series table names and the store holds, and decides one of
three things for it:

* it is **published**: a Catalog entry, a file under ``series/`` and a manifest row;
* it is **withheld**: a Catalog entry by name and a line on the manifest's withheld list with
  the reason. None of its values is written anywhere;
* the store's own record of it is not whole, and the run stops.

A public-profile Release publishes a Series only when the rights gate permits display of
exactly what the store holds for it, on the production Surface. Withholding is by leaving out:
nothing here writes a value and then hides it.

A local-profile Release takes everything the store holds and adds v1's legacy Series for every
key the store does not hold. A key held from an Origin replaces v1's Series whole: a Series is
never part one and part the other (PLAN 6.1 point 3).

Only native Series are written. ``derived/`` is the engine's (ADR 0003), and arrives in M11.

Each published Series also gets ``vintages/{key}.json``: every version the store holds for it,
its metadata history and its Captures (M10, ADR 0024). Past values are values. A withheld
Series has no such file, and in a public-profile Release the file is written only when the
gate permits every Origin, dataset and Channel its history came through; otherwise the Series
is published without it and the check report says so.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from ..capture import store as S
from ..legacy import offered_transforms
from ..period import next_period, period_bounds
from ..release import ANNOTATIONS, CATALOG, LEGACY
from ..rights import RightsGate
from ..vintage.store import VintageStore

NATIVE = "native"
#: What the series table's ``catalog`` block may say, beyond the declared metadata.
CATALOG_FIELDS = ("measure_kind", "unit_kind", "segment", "continuity", "agg", "max_lag", "range",
                  "price_basis", "base_period", "country", "topics", "definition", "aliases",
                  "breaks")
REQUIRED_CATALOG_FIELDS = ("measure_kind", "segment", "continuity")
_EXACT_INTEGER = 2 ** 53
#: How a source's freshness line says a Series is too old. A reuse judges age afresh and so
#: drops the notes that say this, and keeps the others.
AGE_NOTE = ", past its limit of "


class ExportError(Exception):
    """Nothing can be released from this store as it stands."""


def dump(document) -> bytes:
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            + "\n").encode("utf-8")


def number(text: str) -> tuple[int | float, bool]:
    """A stored value as the number a Release carries, and whether nothing was lost.

    The store keeps the provider's decimal text; the Release contract carries JSON numbers,
    which every reader takes as doubles. The value published is the double nearest the text.
    "Nothing was lost" means the shortest decimal that names that double is the same number as
    the text: true for ``129.250``, false for a figure of more than about sixteen digits
    (ADR 0023). A text too large to be a double at all cannot be published."""
    value = float(text)
    if not math.isfinite(value):
        raise ExportError(f"{text[:24]} is too large to publish as a number")
    exact = Decimal(repr(value)) == Decimal(text)
    if value.is_integer() and abs(value) < _EXACT_INTEGER and "." not in text:
        return int(value), exact
    return value, exact


def lineage(entry: dict, permission: str = "display") -> dict:
    """One row for the rights gate: where a Catalog entry's values came from."""
    return {"origin": entry["source"]["origin"]["producer"],
            "dataset": entry["source"]["origin"]["dataset"],
            "channel": entry["source"]["channel"]["via"],
            "representation": entry["representation"], "permission": permission}


@dataclass
class Built:
    """A Release's files without its manifest, and what the manifest will need to say."""

    files: dict[str, bytes] = field(default_factory=dict)
    rows: dict[str, dict] = field(default_factory=dict)        # manifest.series
    withheld: list[dict] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    inputs: list[dict] = field(default_factory=list)
    report: list[dict] = field(default_factory=list)           # check results the export found
    semantics_version: str = "none"
    #: Hard links to make instead of writing bytes: path in the Release -> the file to link to.
    links: dict[str, Path] = field(default_factory=dict)
    reused_data_from: str | None = None

    def release_id(self, created: datetime) -> str:
        digest = hashlib.sha256()
        for path in sorted(self.files):
            digest.update(path.encode() + b"\0" + hashlib.sha256(self.files[path]).digest())
        digest.update(dump(self.withheld))
        return f"{created:%Y%m%dT%H%M%SZ}-{digest.hexdigest()[:7]}"

    def published(self) -> dict[str, str | None]:
        return {key: row.get("state_hash") for key, row in sorted(self.rows.items())}


def _register_rights(table: object, gate: RightsGate, producer: str, dataset: str) -> dict:
    """The Catalog's Rights block for an Origin and dataset, as the register reads today."""
    rows = table["rows"] if gate.problem is None else []
    row = next((r for r in rows if r["kind"] == "origin" and producer in r["origins"]
                and (r["datasets"] == "*" or dataset in r["datasets"])), None)
    if row is None:
        return {"owner": producer, "terms_url": None, "status": "unknown", "attribution": None,
                "reviewed": None}
    terms = [t for t in row.get("terms", []) if isinstance(t, dict)]
    read = sorted(t["read_on"] for t in terms if isinstance(t.get("read_on"), str))
    return {"owner": row.get("name") or producer,
            "terms_url": next((t["url"] for t in terms if isinstance(t.get("url"), str)), None),
            "status": row.get("licence_class", "unknown"), "attribution": row.get("attribution"),
            "reviewed": read[-1] if read else None}


def _held(vintages: VintageStore, key: str) -> tuple[list[dict], dict] | str:
    """The current Observations of a Series and the one metadata they are all held under, or
    the reason a Release cannot show what the store holds."""
    rows = vintages.vintage(key)
    if not rows:
        return "its source lists no Observation for it now"
    by_hash = {line["metadata_hash"]: line["metadata"] for line in vintages.metadata_history(key)}
    # Rights as they stood at each Capture are history (M10's to show); what must be one thing
    # is what the values are: their name, unit, adjustment, Origin and Channel.
    shapes = {json.dumps({k: v for k, v in by_hash[row["metadata_hash"]].items() if k != "rights"},
                         sort_keys=True) for row in rows}
    channels = {row["channel"] for row in rows}
    if len(shapes) > 1 or len(channels) > 1:
        return ("the store holds it under more than one definition or Channel, which a Release "
                "cannot show yet")
    metadata = by_hash[rows[-1]["metadata_hash"]]
    if metadata.get("source", {}).get("channel", {}).get("via") != rows[-1]["channel"]:
        return "its rows and its metadata name different Channels"
    return rows, metadata


def _entry(spec: dict, metadata: dict, rights: dict) -> dict:
    block = spec.get("catalog")
    if not isinstance(block, dict) or any(name not in block for name in REQUIRED_CATALOG_FIELDS):
        raise ExportError(f"{spec['key']}: the series table gives it no catalog block with "
                          f"{', '.join(REQUIRED_CATALOG_FIELDS)}")
    unknown = sorted(set(block) - set(CATALOG_FIELDS))
    if unknown:
        raise ExportError(f"{spec['key']}: the catalog block has fields a Release does not know: "
                          f"{', '.join(unknown)}")
    for name in ("name", "unit"):
        if not isinstance(metadata.get(name), str) or not metadata[name]:
            raise ExportError(f"{spec['key']}: its recorded metadata has no {name}")
    entry = {"key": spec["key"], "name": metadata["name"], "unit": metadata["unit"], **block,
             "freq": spec["freq"], "representation": NATIVE}
    if metadata.get("seasonal_adjustment"):
        entry["seasonal_adjustment"] = metadata["seasonal_adjustment"]
    source = metadata["source"]
    entry["source"] = {"origin": dict(source["origin"]), "channel": dict(source["channel"])}
    entry["rights"] = rights
    entry["status"] = "active"
    return entry


def _series_file(key: str, freq: str, rows: list[dict]) -> tuple[dict, bool]:
    """The file for a Series, with every Period between its bounds present: one the source no
    longer lists is an explicit missing Observation. Also says whether every value survived
    becoming a double."""
    observations, exact = [], True
    expected = None
    for row in rows:
        while freq != "irregular" and expected is not None and expected != row["period"]:
            first, last = period_bounds(freq, expected)
            if first >= row["period_start"]:
                raise ExportError(f"{key}: its Periods are not in order at {row['period']}")
            observations.append({"period": expected, "period_start": first, "period_end": last,
                                 "value": None, "status": "missing"})
            expected = next_period(freq, expected)
        value = None
        if row["value"] is not None:
            value, kept = number(row["value"])
            exact = exact and kept
        observations.append({"period": row["period"], "period_start": row["period_start"],
                             "period_end": row["period_end"], "value": value, "status": row["status"]})
        expected = next_period(freq, row["period"])
    return {"key": key, "freq": freq, "representation": NATIVE,
            "period_start": observations[0]["period_start"],
            "period_end": observations[-1]["period_end"], "observations": observations}, exact


def _public_metadata(metadata: dict) -> dict:
    """The fields of a recorded metadata that a Release shows, and no others: the store keeps
    whatever it was given, and a line of history is not a place for anything to ride along.
    ``rights`` is what the register said that day. It is a record and authorises nothing."""
    source = metadata["source"]
    shown = {"name": metadata["name"], "unit": metadata["unit"]}
    if metadata.get("seasonal_adjustment"):
        shown["seasonal_adjustment"] = metadata["seasonal_adjustment"]
    shown["source"] = {
        "origin": {name: source["origin"].get(name) for name in ("producer", "dataset", "origin_id", "url")},
        "channel": {name: source["channel"][name] for name in ("via", "adapter", "endpoint", "auth")
                    if name in source["channel"]}}
    rights = metadata.get("rights")
    shown["rights"] = None if not isinstance(rights, dict) else {
        "licence_class": rights.get("licence_class"), "attribution": rights.get("attribution")}
    return shown


def _vintage_file(key: str, freq: str, vintages: VintageStore) -> dict | str:
    """``vintages/{key}.json`` from the store's three logs, or why it cannot be written. Values
    become numbers exactly as in the Series' own file, so the versions current now are that
    file's Observations."""
    try:
        lines = [{"hash": line["metadata_hash"], "recorded_from": line["recorded_from"],
                  "metadata": _public_metadata(line["metadata"])} for line in vintages.metadata_history(key)]
    except (KeyError, TypeError, AttributeError):
        return "a line of its metadata history does not say what it is or where it came from"
    rows = []
    for row in vintages.rows(key):
        rows.append({
            "period": row["period"], "period_start": row["period_start"], "period_end": row["period_end"],
            "value": None if row["value"] is None else number(row["value"])[0],
            "status": row["status"], "deleted": bool(row["deleted"]),
            "recorded_from": row["recorded_from"], "recorded_to": row["recorded_to"],
            "provider_from": row["provider_from"], "provider_to": row["provider_to"],
            "provider_precision": row["provider_precision"] if row["provider_from"] is not None else None,
            "channel": row["channel"], "metadata": row["metadata_hash"]})
    captures = [{"retrieved_at": line["retrieved_at"], "scope": list(line["scope"]), "change": line["change"]}
                for line in vintages.captures(key)]
    # No adapter dates a version by the Origin's clock yet, so no span of it is known complete.
    return {"key": key, "freq": freq, "representation": NATIVE, "provider_coverage": None,
            "metadata": lines, "captures": captures, "rows": rows}


def history_lineages(document: dict) -> list[dict]:
    """One row for the rights gate per Origin, dataset and Channel that a vintage file's
    versions and metadata lines came through. Raises on a file that does not say."""
    sources = [(line["hash"], line["metadata"]["source"]) for line in document["metadata"]]
    found = {(source["origin"]["producer"], source["origin"]["dataset"], source["channel"]["via"])
             for _, source in sources}
    # Every line a version's hash names: a file that gives one hash to two lines is not
    # believed about which it meant.
    for row in document["rows"]:
        named = [source for name, source in sources if name == row["metadata"]]
        if not named:
            raise ValueError("a version names metadata the file does not hold")
        found |= {(source["origin"]["producer"], source["origin"]["dataset"], row["channel"]) for source in named}
    if not all(isinstance(part, str) and part for parts in found for part in parts):
        raise ValueError("a version does not say where it came from")
    return [{"origin": producer, "dataset": dataset, "channel": channel,
             "representation": document["representation"], "permission": "display"}
            for producer, dataset, channel in sorted(found)]


def lag_limit(period_end: str, max_lag: str | None) -> str | None:
    """The last day on which a Series whose last Period ends on ``period_end`` is within
    ``max_lag``; None when no limit is recorded. The same rule as packages/core's staleness."""
    if not max_lag or len(max_lag) < 3 or max_lag[0] != "P" or not max_lag[1:-1].isdigit():
        return None
    count, unit, end = int(max_lag[1:-1]), max_lag[-1], date.fromisoformat(period_end)
    try:
        if unit in "DW":
            return date.fromordinal(end.toordinal() + count * (7 if unit == "W" else 1)).isoformat()
        if unit not in "MY":
            return None
        months = end.year * 12 + (end.month - 1) + count * (12 if unit == "Y" else 1)
        year, month = divmod(months, 12)
        month += 1
        first_of_next = date(year + (month == 12), month % 12 + 1, 1)
        last_day = date.fromordinal(first_of_next.toordinal() - 1).day
        return date(year, month, min(end.day, last_day)).isoformat()
    except (ValueError, OverflowError):
        return "9999-12-31"


def _freshness(store: Path, vintages: VintageStore, published: list[tuple[dict, dict, dict]],
               created: datetime) -> list[dict]:
    """One line per Origin and Channel published from: when its last recorded Capture was
    retrieved, and whether the last fetch failed or its newest Period is older than allowed."""
    fetches = S.read_fetch_log(store)
    groups: dict[tuple[str, str], dict] = {}
    for spec, entry, document in published:
        key = spec["key"]
        group = groups.setdefault((entry["source"]["origin"]["producer"], entry["source"]["channel"]["via"]),
                                  {"fetched": None, "failed": [], "stale": []})
        caplog = vintages.captures(key)
        last = caplog[-1]["retrieved_at"]
        group["fetched"] = max(group["fetched"] or last, last)
        attempts = [line for line in fetches if line.get("endpoint") == spec["endpoint"]]
        if attempts:
            newest = attempts[-1]
            if newest.get("outcome") != "captured":
                group["failed"].append(f"the last fetch of {spec['endpoint']} "
                                       f"({newest.get('started_at')}) was {newest.get('outcome')}")
            elif newest["capture_id"] not in {line["capture_id"] for line in caplog}:
                group["stale"].append(f"the capture of {spec['endpoint']} retrieved "
                                      f"{newest['retrieved_at']} is not recorded yet (atlas replay)")
        limit = lag_limit(document["period_end"], entry.get("max_lag"))
        if limit is not None and f"{created:%Y-%m-%d}" > limit:
            group["stale"].append(f"{key} ends {document['period_end']}{AGE_NOTE}{limit}")
    lines = []
    for (producer, via), group in sorted(groups.items()):
        line = {"producer": producer, "via": via, "fetched": group["fetched"], "outcome": "ok"}
        notes = sorted(set(group["failed"])) or sorted(set(group["stale"]))
        if notes:
            line["outcome"] = "failed" if group["failed"] else "stale"
            line["detail"] = "; ".join(notes)
        lines.append(line)
    return lines


def build(*, profile: str, store: Path, table: object, gate: RightsGate, series: list[dict],
          created: datetime, withdrawn: dict[str, dict] | None = None,
          legacy: dict[str, bytes] | None = None) -> Built:
    """The files of a Release from what the store holds now. ``legacy`` is the file set of
    v1's converted Release (local profile only). Raises ``ExportError``."""
    if profile not in ("public", "local"):
        raise ExportError(f"unknown profile {profile!r}")
    if profile == "public" and legacy is not None:
        raise ExportError("v1's legacy Series are never part of a public-profile release")
    if profile == "public" and gate.problem is not None:
        raise ExportError(f"the rights register cannot be trusted ({gate.problem}), so nothing "
                          "may be published")
    withdrawn = withdrawn or {}
    vintages = VintageStore(store)
    held = set(vintages.series_keys())
    built = Built()
    entries: list[dict] = []
    published: list[tuple[dict, dict, dict]] = []
    inexact: list[str] = []
    no_history: list[str] = []

    def withhold(entry: dict, reason: str) -> None:
        entries.append(entry)
        built.withheld.append({"key": entry["key"], "reason": reason})

    for spec in sorted(series, key=lambda s: s["key"]):
        key = spec["key"]
        if key not in held:
            continue
        problem = vintages.problem(key)
        if problem:
            raise ExportError(f"the vintage store is not whole: {problem}")
        found = _held(vintages, key)
        # A Series with nothing to show still has a name: its last recorded metadata.
        metadata = found[1] if not isinstance(found, str) else vintages.metadata_history(key)[-1]["metadata"]
        origin = metadata["source"]["origin"]
        entry = _entry(spec, metadata, _register_rights(table, gate, origin["producer"], origin["dataset"]))
        if key in withdrawn:
            withhold(entry, f"withdrawn on {withdrawn[key]['withdrawn_at'][:10]}: {withdrawn[key]['reason']}")
            continue
        if isinstance(found, str):
            if profile == "public" or legacy is None or f"series/{key}.json" not in legacy:
                withhold(entry, found)
            continue  # on a local build v1's Series, if there is one, stays whole
        if profile == "public":
            decision = gate.permits([lineage(entry)], "production")
            if not decision.allowed:
                withhold(entry, decision.reason)
                continue
        document, exact = _series_file(key, spec["freq"], found[0])
        if not exact:
            inexact.append(key)
        entry["allowed_transforms"] = offered_transforms(entry, document)
        path = f"series/{key}.json"
        built.files[path] = dump(document)
        built.rows[key] = {"kind": "stored", "sha256": hashlib.sha256(built.files[path]).hexdigest(),
                           "state_hash": vintages.captures(key)[-1]["state_hash"],
                           "channel": entry["source"]["channel"]["via"],
                           "rights_status": entry["rights"]["status"], "representation": NATIVE}
        history = _vintage_file(key, spec["freq"], vintages)
        if not isinstance(history, str) and profile == "public":
            try:
                decision = gate.permits(history_lineages(history), "production")
                if not decision.allowed:
                    history = decision.reason
            except (ValueError, KeyError, TypeError, AttributeError):
                # A line of history that does not say where it came from cannot be asked about.
                history = "a line of its history does not name its Origin, dataset and Channel"
        if isinstance(history, str):
            no_history.append(f"{key} ({history})")
        else:
            path = f"vintages/{key}.json"
            built.files[path] = dump(history)
            built.rows[key]["vintages_sha256"] = hashlib.sha256(built.files[path]).hexdigest()
        entries.append(entry)
        published.append((spec, entry, document))

    built.sources = _freshness(Path(store), vintages, published, created)
    if inexact:
        built.report.append({"check": "values as doubles", "outcome": "warn",
                             "detail": f"{', '.join(inexact)}: at least one value has more digits "
                                       "than a double holds; the nearest double is published and "
                                       "the exact text stays in the store"})
    if published:
        built.report.append({"check": "vintages", "outcome": "pass"} if not no_history else {
            "check": "vintages", "outcome": "warn",
            "detail": ("published without its history, so it has no as-of answer: "
                       + "; ".join(no_history))[:2000]})
    annotations = {"annotations": []}
    if legacy is not None:
        annotations = _add_legacy(built, entries, legacy, withdrawn)
    built.files[CATALOG] = dump({"series": entries})
    built.files[ANNOTATIONS] = dump(annotations)
    return built


def _add_legacy(built: Built, entries: list[dict], legacy: dict[str, bytes], withdrawn: dict) -> dict:
    """Add v1's Series for every key not already in ``entries``, each whole and as the legacy
    converter wrote it. Returns v1's Annotations."""
    manifest = json.loads(legacy["manifest.json"])
    native = {entry["key"] for entry in entries}
    for entry in json.loads(legacy[CATALOG])["series"]:
        key = entry["key"]
        if key in native:
            continue
        if entry["representation"] != LEGACY:
            raise ExportError(f"{key}: the legacy converter gave a Series that is not marked legacy")
        entries.append(entry)
        if key in withdrawn:
            built.withheld.append({"key": key, "reason": f"withdrawn on "
                                   f"{withdrawn[key]['withdrawn_at'][:10]}: {withdrawn[key]['reason']}"})
            continue
        folder = "derived" if "recipe" in entry else "series"
        built.files[f"{folder}/{key}.json"] = legacy[f"{folder}/{key}.json"]
        built.rows[key] = manifest["series"][key]
        if folder == "derived":
            built.semantics_version = manifest["semantics_version"]
    # Anything computed from a withdrawn Series goes with it.
    by_key = {entry["key"]: entry for entry in entries}
    gone = {row["key"] for row in built.withheld}
    changed = True
    while changed:
        changed = False
        for key, entry in by_key.items():
            if key not in gone and gone & set(entry.get("recipe", {}).get("inputs", [])):
                gone.add(key)
                built.withheld.append({"key": key, "reason": "computed from a Series that is withheld"})
                built.files.pop(f"derived/{key}.json", None)
                built.rows.pop(key, None)
                changed = True
    built.inputs = manifest.get("inputs", [])
    return json.loads(legacy[ANNOTATIONS])
