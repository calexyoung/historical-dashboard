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

Python writes no Derived value: ``derived/`` is the engine's (ADR 0003). ``build`` decides
which of the series table's Recipes may be computed, writes a Catalog entry for each, and
lists them in ``Built.materialise``; the publisher runs the Node step (``engine.py``) and
``add_derived`` takes in what it computed. A Derived series is computed only when every stored
Series it rests on, to any depth, is published from the store in this Release and, for a
public-profile Release, the rights gate permits display of the whole lineage. Otherwise it is
withheld by name with the reason, like any other Series. v1's Derived series (local profile)
are never handed to the engine: they stay as v1 computed them.

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
from ..content.compile import ContentError, compile_content
from ..manual import MANUAL_DIR
from ..release import ANNOTATIONS, CATALOG, LATEST, LEGACY
from ..rights import RightsGate
from ..vintage.store import VintageStore
from . import engine

NATIVE = "native"
#: What the series table's ``catalog`` block may say, beyond the declared metadata.
CATALOG_FIELDS = ("measure_kind", "unit_kind", "segment", "continuity", "agg", "max_lag", "range",
                  "price_basis", "base_period", "country", "topics", "definition", "aliases",
                  "breaks")
REQUIRED_CATALOG_FIELDS = ("measure_kind", "segment", "continuity")
#: Rights statuses from the least restrictive to the most, as packages/core/src/recipe.ts has
#: them. The Node step checks every Derived entry against the engine's own answer.
RIGHTS_ORDER = ("public_domain", "cc_by", "citation_required", "permission_required",
                "no_redistribution", "unknown")
#: The Channel of a value Macro Atlas computed (atlas/rights.py, OWN_CHANNELS).
COMPUTED = {"via": "computed", "adapter": "atlas-core"}
NO_VALUE = "its recipe gives no value from what its inputs hold now"
_EXACT_INTEGER = 2 ** 53
#: How a source's freshness line says a Series is too old. A reuse judges age afresh and so
#: drops the notes that say this, and keeps the others.
AGE_NOTE = ", past its limit of "


class ContentRefused(Exception):
    """The content cannot be compiled. Its words may name a draft (an id, a file, a term of
    its text), so they are for the person running the command and never for a file of a
    public root."""


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
    #: The Catalog's entries, as written into ``files``; ``add_derived`` writes them again.
    entries: list[dict] = field(default_factory=list)
    #: Derived series the engine is to compute, in key order (``add_derived`` empties it).
    materialise: list[str] = field(default_factory=list)
    #: Lock files whose Claims the engine is to compute a latest row for (``add_latest``).
    latest_for: list[str] = field(default_factory=list)
    #: What the engine step found drifted: {claim_id, lock_version, differences}.
    drift: list[dict] = field(default_factory=list)
    #: The headline Series as the repository declares them, by Segment (``add_reading_files``).
    highlights: dict[str, list[str]] = field(default_factory=dict)

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


def _block(spec: dict) -> dict:
    block = spec.get("catalog")
    if not isinstance(block, dict) or any(name not in block for name in REQUIRED_CATALOG_FIELDS):
        raise ExportError(f"{spec['key']}: the series table gives it no catalog block with "
                          f"{', '.join(REQUIRED_CATALOG_FIELDS)}")
    unknown = sorted(set(block) - set(CATALOG_FIELDS))
    if unknown:
        raise ExportError(f"{spec['key']}: the catalog block has fields a Release does not know: "
                          f"{', '.join(unknown)}")
    return block


def combined_rights(blocks: list[dict]) -> dict:
    """The Rights block of a Derived series: the most restrictive status of the stored Series
    it rests on, and every one of their owners and attributions, so that no obligation is
    dropped. ``terms_url`` is that of the most restrictive; ``reviewed`` the oldest reading,
    or none if any was never read."""
    def rank(block: dict) -> int:
        return RIGHTS_ORDER.index(block["status"]) if block["status"] in RIGHTS_ORDER else len(RIGHTS_ORDER) - 1

    worst = max(blocks, key=rank)
    said = list(dict.fromkeys(block["attribution"] for block in blocks if block.get("attribution")))
    read = [block.get("reviewed") for block in blocks]
    return {"owner": "; ".join(dict.fromkeys(block["owner"] for block in blocks)),
            "terms_url": worst.get("terms_url"), "status": RIGHTS_ORDER[rank(worst)],
            "attribution": "; ".join(said) or None,
            "reviewed": None if any(day is None for day in read) else min(read)}


def _derived_entry(spec: dict, leaves: list[dict]) -> dict:
    """The Catalog entry of a Derived series. A Release's entry has room for one Origin: it is
    that of the first stored Series the Recipe reaches, and stands for the lineage only as a
    label. The lineage itself is the Recipe's inputs, which every reader that asks the rights
    gate walks to the end (``root.rights_problems``, the site's Query)."""
    entry = {"key": spec["key"], "name": spec["name"], "unit": spec["unit"], **_block(spec),
             "freq": spec["freq"], "representation": NATIVE,
             "source": {"origin": dict(leaves[0]["source"]["origin"]), "channel": dict(COMPUTED)},
             "rights": combined_rights([leaf["rights"] for leaf in leaves]), "status": "active",
             "recipe": spec["recipe"]}
    if spec.get("seasonal_adjustment"):
        entry["seasonal_adjustment"] = spec["seasonal_adjustment"]
    return entry


def _entry(spec: dict, metadata: dict, rights: dict) -> dict:
    block = _block(spec)
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
    retrieved, and whether the last fetch failed or its newest Period is older than allowed.
    A source that was not asked for want of its key is stale, and says when it was last fetched."""
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
            if newest.get("outcome") == "no_key":
                # The source wants a key and the run had none, so it was not asked (M15). What
                # is published is the last state recorded from it: stale, not failed. The
                # time is this Series' own last recorded Capture, not the source's newest.
                group["stale"].append(f"{spec['endpoint']}: {S.stale_phrase(last)} (not asked on "
                                      f"{newest.get('started_at')}: {newest.get('error')})")
            elif newest.get("outcome") != "captured":
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


def _decide_derived(built: Built, entries: list[dict], specs: list[dict], *, profile: str,
                    gate: RightsGate, withdrawn: dict[str, dict], legacy: dict[str, bytes] | None) -> None:
    """For each Recipe of the series table: compute it, withhold it by name, or leave it out.
    Nothing is computed here."""
    by_key = {spec["key"]: spec for spec in specs}
    known = {entry["key"]: entry for entry in entries}          # stored Series, published or withheld
    withheld = {row["key"]: row["reason"] for row in built.withheld}
    decided: dict[str, bool] = {}                               # key -> it has a Catalog entry

    def closure(key: str) -> tuple[list[str], list[str]]:
        """Stored and derived keys ``key`` rests on, each in the order first reached."""
        stored, derived, stack = [], [], list(reversed(by_key[key]["recipe"]["inputs"]))
        while stack:
            name = stack.pop()
            if name in by_key:
                if name not in derived:
                    derived.append(name)
                    stack.extend(reversed(by_key[name]["recipe"]["inputs"]))
            elif name not in stored:
                stored.append(name)
        return stored, derived

    def decide(key: str) -> bool:
        if key in decided:
            return decided[key]
        spec = by_key[key]
        stored, derived = closure(key)
        decided[key] = False
        # Like a stored Series the store does not hold: there is nothing to describe yet.
        if any(name not in known for name in stored) or not all([decide(name) for name in derived]):
            return False
        entry = _derived_entry(spec, [known[name] for name in stored])
        legacy_has = legacy is not None and (f"derived/{key}.json" in legacy or f"series/{key}.json" in legacy)
        reason = None
        if key in withdrawn:
            reason = f"withdrawn on {withdrawn[key]['withdrawn_at'][:10]}: {withdrawn[key]['reason']}"
        else:
            blocked = [name for name in (*stored, *derived) if name in withheld]
            if blocked:
                if legacy_has:
                    return False                                # v1's Series of this key stays whole
                reason = f"computed from {blocked[0]}, which is withheld ({withheld[blocked[0]]})"
            elif profile == "public":
                rests_on = [known[name] for name in stored] + [known_derived[name] for name in derived]
                decision = gate.permits([lineage(e) for e in (*rests_on, entry)], "production")
                if not decision.allowed:
                    reason = decision.reason
        entries.append(entry)
        known_derived[key] = entry
        decided[key] = True
        if reason is not None:
            built.withheld.append({"key": key, "reason": reason})
            withheld[key] = reason
        else:
            built.materialise.append(key)
        return True

    known_derived: dict[str, dict] = {}
    for key in sorted(by_key):
        decide(key)
    built.materialise.sort()


def add_derived(built: Built, outcome: engine.Outcome) -> None:
    """Take in what the Node step computed: the Derived files and their manifest rows, the
    Transforms each offers, and a withheld line for a Recipe that gave no value. Rewrites the
    Catalog. The step has already been checked against what it was asked (``engine.run``)."""
    by_key = {entry["key"]: entry for entry in built.entries}
    for key in built.materialise:
        path = f"derived/{key}.json"
        entry = by_key[key]
        if path not in outcome.files:
            built.withheld.append({"key": key, "reason": NO_VALUE})
            continue
        built.files[path] = outcome.files[path]
        entry["allowed_transforms"] = offered_transforms(entry, json.loads(outcome.files[path]))
        built.rows[key] = {"kind": "derived", "sha256": hashlib.sha256(outcome.files[path]).hexdigest(),
                           "channel": entry["source"]["channel"]["via"],
                           "rights_status": entry["rights"]["status"], "representation": NATIVE}
    if outcome.files:
        built.semantics_version = outcome.semantics_version
    built.report.append({"check": engine.CHECK, "outcome": "pass"})
    for check in outcome.checks:
        if not check["check"].startswith("spot value"):
            continue
        if check["outcome"] == "pass":
            built.report.append({"check": check["check"], "outcome": "pass"})
        elif check.get("reason") == "no_value":
            # The Series is here and the Period is not: said, so that an unchecked spot is seen.
            built.report.append({"check": check["check"], "outcome": "warn",
                                 "detail": "not checked: this release holds no value for that Period"})
    built.materialise = []
    built.files[CATALOG] = dump({"series": built.entries})


def build(*, profile: str, store: Path, table: object, gate: RightsGate, series: list[dict],
          created: datetime, withdrawn: dict[str, dict] | None = None,
          legacy: dict[str, bytes] | None = None, derived: list[dict] | None = None,
          content: Path | None = None, manual: Path | None = None,
          local_locks: Path | None = None) -> Built:
    """The files of a Release from what the store holds now, without its Derived series:
    ``Built.materialise`` lists those the engine is to compute (``add_derived``). ``legacy`` is
    the file set of v1's converted Release (local profile only); ``derived`` the series
    table's Recipes; ``content`` and ``manual`` the directories the content compiler reads
    (default the repository's ``content`` and ``catalog/manual``). Raises ``ExportError``."""
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
    _decide_derived(built, entries, derived or [], profile=profile, gate=gate, withdrawn=withdrawn,
                    legacy=legacy)
    v1_annotations = None
    if legacy is not None:
        v1_annotations = _add_legacy(built, entries, legacy, withdrawn)["annotations"]
    built.entries = entries
    built.files[CATALOG] = dump({"series": entries})
    add_content(built, profile=profile, gate=gate, content=content, manual=manual, v1=v1_annotations,
                local_locks=local_locks, withdrawn=set(withdrawn))
    return built


def add_content(built: Built, *, profile: str, gate: RightsGate, content: Path | None = None,
                manual: Path | None = None, v1: list[dict] | None = None,
                local_locks: Path | None = None, withdrawn: set[str] | None = None) -> None:
    """Write a Release's content afresh (M19; ADR 0033): Events from their files, the
    hand-entered layers, and on a local Profile v1's bands and recessions out of ``v1`` (the
    Annotations of a converted or an earlier local Release; only those marked as v1's are
    taken, so no Event and no hand-entered layer is carried from one Release to the next)."""
    layers = [a for a in v1 or [] if a.get("provenance", {}).get("representation") == LEGACY]
    try:
        compiled = compile_content(profile=profile, content=content,
                                   manual=MANUAL_DIR if manual is None else manual, gate=gate,
                                   legacy_annotations=layers if profile == "local" else None,
                                   local_locks=local_locks, withdrawn=withdrawn)
    except (ContentError, OSError) as error:
        # A file that cannot be read is named by its path, which may be a draft's id.
        raise ContentRefused(f"the content cannot be compiled: {error}") from None
    built.files.update(compiled.files)
    built.report.extend(compiled.report)
    built.latest_for = compiled.latest_for
    built.highlights = compiled.highlights


def add_latest(built: Built, outcome: engine.Outcome) -> None:
    """Take in ``evidence/latest.json`` as the engine step left it, and say what drifted."""
    if not built.latest_for:
        return
    built.files[LATEST] = outcome.latest
    built.latest_for = []
    # The engine computed something in this Release: its version is the Release's.
    built.semantics_version = outcome.semantics_version
    if outcome.drift:
        built.drift = outcome.drift
        built.report.append({"check": "claims: drift", "outcome": "warn",
                             "detail": ("a row computed on this Release is no longer the locked one, for a "
                                        "person to look at and re-lock: " + ", ".join(
                                            f"{row['claim_id']} v{row['lock_version']} ({row['differences']})"
                                            for row in outcome.drift))[:2000]})


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
