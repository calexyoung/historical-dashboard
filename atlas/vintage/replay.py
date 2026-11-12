"""Replay: Captures in, vintage store out (PLAN M8; ADR 0012, ADR 0022).

``replay`` reads a capture store's fetch log, takes each complete Capture in the order it was
retrieved, parses its kept bytes with today's adapter, and records each Series it is bound to.
Recording is by retrieval time, so replaying a year of Captures today writes the same store as
recording each on its own day. A Capture already in a Series' capture log is passed by, so a
replay can be run again after every capture run.

Which Series a source's own identifier is recorded under comes from the *series table*: since
M12 the Catalog's own projection (``atlas.catalog.series_table`` over ``catalog/series``), or a
table file of the same shape (the fixtures). It also holds the metadata Macro Atlas declares
for the Series, as dated versions, so that history can be rebuilt from the table and the
Captures alone.

Replay asks the rights gate before it writes anything: the observation log is a stored copy of
what an Origin served, and needs the same permission the Capture did.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from ..capture import store as S
from ..capture.adapters import ADAPTERS
from ..capture.replay import load_capture
from ..period import FREQUENCIES
from ..rights import RightsGate
from .store import CaptureRef, ChangeSet, SeriesState, StoreError, VintageStore

SERIES_FORMAT = 1
#: An adapter's word for a kind of value, in the release contract's vocabulary. "observed" is
#: a published value the source did not mark preliminary; "unavailable" is a Period the source
#: lists and prints no number for.
STATUS = {"observed": "final", "preliminary": "preliminary", "revised": "revised",
          "unavailable": "missing"}
_KEY = re.compile(r"[a-z][a-z0-9_]{0,63}")


class SeriesTableError(ValueError):
    """The series table cannot be used."""


def _table(path: Path | None) -> tuple[dict, str]:
    """The series table and what to call it: the Catalog's own projection (the default, or a
    catalog directory), or a table file of the M8 format (the fixtures)."""
    if path is None or Path(path).is_dir():
        from ..catalog import CatalogError, load_catalog, series_table

        try:
            return series_table(load_catalog(path)), f"the catalog at {path or 'catalog/series'}"
        except CatalogError as error:
            raise SeriesTableError(str(error)) from None
    path = Path(path)
    try:
        table = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise SeriesTableError(f"the series table at {path} cannot be read: {error}") from None
    if not isinstance(table, dict) or table.get("format") != SERIES_FORMAT:
        raise SeriesTableError(f"{path} is not series table format {SERIES_FORMAT}")
    return table, str(path)


def load_series(path: Path | None = None) -> list[dict]:
    """The series table's entries, checked: from the Catalog (``catalog/series``, or another
    catalog directory), or from a table file. Raises ``SeriesTableError``."""
    table, path = _table(path)
    entries = table.get("series")
    if not isinstance(entries, list):
        raise SeriesTableError(f"{path} lists no series")
    keys, bound = set(), set()
    for entry in entries:
        key = entry.get("key") if isinstance(entry, dict) else None
        if not isinstance(key, str) or not _KEY.fullmatch(key):
            raise SeriesTableError(f"{key!r} is not a Series key")
        if key in keys:
            raise SeriesTableError(f"{key} is in the series table twice")
        keys.add(key)
        if entry.get("freq") not in FREQUENCIES:
            raise SeriesTableError(f"{key}: {entry.get('freq')!r} is not a frequency")
        for name in ("endpoint", "origin_id", "dataset"):
            if not isinstance(entry.get(name), str) or not entry[name]:
                raise SeriesTableError(f"{key}: it names no {name}")
        if entry.get("url") is not None and not isinstance(entry["url"], str):
            raise SeriesTableError(f"{key}: its url is not text")
        binding = (entry["endpoint"], entry["origin_id"])
        if binding in bound:
            raise SeriesTableError(f"{entry['origin_id']} of {entry['endpoint']} is bound to two Series")
        bound.add(binding)
        versions = entry.get("metadata")
        if not isinstance(versions, list) or not versions or not all(isinstance(v, dict) for v in versions):
            raise SeriesTableError(f"{key}: it declares no metadata")
        if versions[0].get("from", 0) is not None:
            raise SeriesTableError(f"{key}: its first metadata version must be in force from the "
                                   'start ("from": null)')
        starts = []
        for version in versions[1:]:
            start = version.get("from")
            try:
                # Exactly as the logs write an instant: the versions are compared as text.
                exact = S.stamp(S.unstamp(start)) == start
            except (TypeError, ValueError):
                exact = False
            if not exact:
                raise SeriesTableError(f"{key}: a metadata version does not say from when, "
                                       "written exactly like 2026-04-01T00:00:00Z")
            starts.append(start)
        if starts != sorted(set(starts)):
            raise SeriesTableError(f"{key}: its metadata versions are not in order of time")
    return entries


RECIPE_ARITY = {"ratio": (2, 2), "difference": (2, 2), "sum": (2, None), "product": (2, None),
                "pct_change": (1, 1)}
RECIPE_ORDERS = ("aggregate_then_compute", "compute_then_aggregate")
#: What a derived entry's ``catalog`` block must say (the release writer checks the rest).
DERIVED_CATALOG_FIELDS = ("measure_kind", "segment", "continuity")


def load_derived(path: Path | None = None) -> list[dict]:
    """The table's Derived series: its optional ``derived`` list, checked. Each entry names a
    key, a frequency, a name, a unit, a Recipe over other entries of the table and a ``catalog``
    block. Structure only: computing a Recipe is the engine's alone (ADR 0003). A table with no
    such list has none. Raises ``SeriesTableError``, naming the cycle if the Recipes have one."""
    stored = {entry["key"] for entry in load_series(path)}
    table, path = _table(path)
    entries = table.get("derived", [])
    if not isinstance(entries, list):
        raise SeriesTableError(f"{path}: its derived list is not a list")
    inputs: dict[str, list[str]] = {}
    for entry in entries:
        key = entry.get("key") if isinstance(entry, dict) else None
        if not isinstance(key, str) or not _KEY.fullmatch(key):
            raise SeriesTableError(f"{key!r} is not a Series key")
        if key in stored or key in inputs:
            raise SeriesTableError(f"{key} is in the series table twice")
        if entry.get("freq") not in FREQUENCIES:
            raise SeriesTableError(f"{key}: {entry.get('freq')!r} is not a frequency")
        for name in ("name", "unit"):
            if not isinstance(entry.get(name), str) or not entry[name]:
                raise SeriesTableError(f"{key}: it names no {name}")
        recipe = entry.get("recipe")
        names = recipe.get("inputs") if isinstance(recipe, dict) else None
        arity = RECIPE_ARITY.get(recipe.get("op")) if isinstance(recipe, dict) else None
        lag = recipe.get("params", {}).get("lag") if arity and isinstance(recipe.get("params", {}), dict) else None
        if (arity is None or recipe.get("order") not in RECIPE_ORDERS or not isinstance(names, list)
                or not all(isinstance(name, str) and _KEY.fullmatch(name) for name in names)
                or len(names) < arity[0] or (arity[1] is not None and len(names) > arity[1])
                or set(recipe) - {"op", "inputs", "order", "params"}
                or (recipe["op"] == "pct_change") != ("params" in recipe)
                or (recipe["op"] == "pct_change" and (type(lag) is not int or lag < 1
                                                      or set(recipe["params"]) != {"lag"}))):
            raise SeriesTableError(f"{key}: its recipe is not one the release contract describes "
                                   "(op, inputs, order, and params.lag for pct_change)")
        block = entry.get("catalog")
        missing = [name for name in DERIVED_CATALOG_FIELDS if not isinstance(block, dict) or name not in block]
        if missing:
            raise SeriesTableError(f"{key}: its catalog block does not give {', '.join(missing)}")
        inputs[key] = list(names)
    for key, names in inputs.items():
        for name in names:
            if name not in stored and name not in inputs:
                raise SeriesTableError(f"{key} takes {name}, which is not in the series table")
    cycle = recipe_cycle(inputs)
    if cycle:
        raise SeriesTableError(f"the recipes go round in a circle: {' → '.join(cycle)}")
    return entries


def recipe_cycle(inputs: dict[str, list[str]]) -> list[str] | None:
    """A cycle among Recipes, from a key back to itself, or None. ``inputs`` maps each Derived
    key to what it takes; anything else is a stored Series and ends the walk."""
    done: set[str] = set()

    def walk(key: str, path: list[str]) -> list[str] | None:
        if key in path:
            return [*path[path.index(key):], key]
        if key in done or key not in inputs:
            return None
        for name in inputs[key]:
            found = walk(name, [*path, key])
            if found:
                return found
        done.add(key)
        return None

    for key in inputs:
        found = walk(key, [])
        if found:
            return found
    return None


def _declared(entry: dict, when: str) -> dict:
    """The declared metadata in force at an instant."""
    version = [v for v in entry["metadata"] if v["from"] is None or v["from"] <= when][-1]
    return {name: value for name, value in version.items() if name != "from"}


@dataclass
class ReplayResult:
    exit_code: int = 0
    lines: list[str] = field(default_factory=list)
    changes: list[ChangeSet] = field(default_factory=list)


def _describe(change: ChangeSet, retrieved_at: str) -> str:
    parts = [f"{name} {', '.join(periods) if len(periods) <= 6 else f'{len(periods)} Periods'}"
             for name, periods in (("added", change.added), ("revised", change.revised),
                                   ("withdrawn", change.withdrawn), ("relabelled", change.relabelled))
             if periods]
    if change.metadata_changed:
        parts.append("metadata changed")
    what = {"first": "first capture", "revision": "revision", "metadata": "metadata revision",
            "none": "unchanged (capture confirmation)"}[change.change]
    return f"{change.key} {retrieved_at}: {what}" + (f"; {'; '.join(parts)}" if parts else "")


def replay(captures: Path, store: Path, table: object, series: list[dict]) -> ReplayResult:
    """Record every Capture in ``captures`` that ``store`` does not hold yet. Refusals, an
    altered blob and a locked store are results, not exceptions."""
    captures, store, result = Path(captures), Path(store), ReplayResult()
    problems: list[str] = []
    fetches = S.read_fetch_log(captures, problems)
    result.lines.extend(problems)
    if not (captures / S.FETCH_LOG).exists():
        result.lines.append(f"REFUSED: {captures} has no fetch log; there is nothing to replay")
        result.exit_code = 1
        return result

    bound: dict[str, list[dict]] = {}
    for entry in series:
        bound.setdefault(entry["endpoint"], []).append(entry)
    whole = sorted((line for line in fetches if line.get("outcome") == "captured"),
                   key=lambda line: (line["retrieved_at"], line["capture_id"]))
    for line in fetches:
        if line.get("outcome") == "incomplete":
            why = "; ".join((line.get("evidence") or {}).get("problems", []))
            result.lines.append(f"SKIPPED {line['capture_id']}: the capture is incomplete ({why}) "
                                "and is never the state of a Series")
    work = []
    for endpoint in sorted({line["endpoint"] for line in whole}):
        lines = [line for line in whole if line["endpoint"] == endpoint]
        adapter = ADAPTERS.get(lines[0]["adapter"]["name"])
        if not hasattr(adapter, "parse"):
            result.lines.append(f"SKIPPED {endpoint}: {len(lines)} capture(s) kept; the "
                                f"{lines[0]['adapter']['name']} adapter has no parser yet, so they wait")
        elif endpoint not in bound:
            result.lines.append(f"SKIPPED {endpoint}: {len(lines)} capture(s) kept; no Series is "
                                "bound to it in the series table")
        else:
            work.extend(lines)
    work.sort(key=lambda line: (line["retrieved_at"], line["capture_id"]))

    # Rights first, for everything that would be written, before anything is.
    gate, refused = RightsGate(table), {}
    for line in work:
        for entry in bound[line["endpoint"]]:
            if entry["dataset"] not in line["datasets"]:
                reason = (f"its dataset, {entry['dataset']}, is not one {line['endpoint']} "
                          "was captured for")
            else:
                decision = gate.may_store(line["origin"], entry["dataset"], line["channel"])
                reason = None if decision.allowed else decision.reason
            if reason:
                refused.setdefault(entry["key"], reason)
    if refused:
        result.lines.extend(f"REFUSED {key}: {reason}" for key, reason in sorted(refused.items()))
        result.lines.append("A Series whose Origin is not cleared for storage fails the replay. "
                            "Nothing was written.")
        result.exit_code = 1
        return result

    store.mkdir(parents=True, exist_ok=True)
    try:
        with S.locked(store):
            _record(captures, VintageStore(store), work, bound, result)
    except S.StoreLocked:
        result.lines.append(f"REFUSED: another run holds this store ({store / 'LOCK'}). "
                            "Nothing was written.")
        result.exit_code = 1
    return result


def _record(captures: Path, vintages: VintageStore, work: list[dict], bound: dict, result: ReplayResult) -> None:
    held = {entry["key"]: vintages.captures(entry["key"]) for entries in bound.values() for entry in entries}
    recorded = late = 0
    for line in work:
        entries = bound[line["endpoint"]]
        todo = []
        for entry in entries:
            log = held[entry["key"]]
            if any(done["capture_id"] == line["capture_id"] for done in log):
                continue
            if log and (log[-1]["retrieved_at"], log[-1]["capture_id"]) >= (line["retrieved_at"], line["capture_id"]):
                late += 1
                result.lines.append(
                    f"WARNING {entry['key']}: capture {line['capture_id']} ({line['retrieved_at']}) is "
                    "older than what is recorded and was passed over; replay into a new store to "
                    "include it")
                continue
            todo.append(entry)
        if not todo:
            continue
        try:
            capture = load_capture(captures, line)
        except (ValueError, OSError, EOFError) as error:
            # Later captures would be recorded as if this one had never been: stop here.
            result.lines.append(f"ALTERED {line['capture_id']}: its kept bytes cannot be read "
                                f"({error}). The replay stopped; nothing later was recorded.")
            result.exit_code = 1
            return
        adapter = ADAPTERS[line["adapter"]["name"]]
        state = adapter.parse(capture)
        if not state.complete:
            result.lines.append(f"INCOMPLETE {line['capture_id']}: today's {adapter.name} adapter "
                                f"does not read it as whole ({'; '.join(state.problems)}); "
                                "nothing was recorded from it")
            result.exit_code = 1
            continue
        scope = adapter.coverage(state.scope)
        ref = CaptureRef(line["capture_id"], S.unstamp(line["retrieved_at"]), line["channel"],
                         line["endpoint"], line.get("real_bytes", True) is not False,
                         {"name": adapter.name, "version": adapter.version})
        for entry in todo:
            key = entry["key"]
            try:
                if entry["origin_id"] not in state.series:
                    raise StoreError(f"{key}: {entry['origin_id']} is not in the answer")
                observations = []
                for observation in state.series[entry["origin_id"]]:
                    if observation["status"] not in STATUS:
                        raise StoreError(f"{key}: the adapter's status {observation['status']!r} "
                                         "has no place in the log's vocabulary")
                    observations.append({"period": observation["period"], "value": observation["value"],
                                         "status": STATUS[observation["status"]]})
                metadata = {
                    **_declared(entry, line["retrieved_at"]),
                    "source": {"origin": {"producer": line["origin"], "dataset": entry["dataset"],
                                          "origin_id": entry["origin_id"], "url": entry.get("url")},
                               "channel": {"via": line["channel"], "adapter": adapter.name,
                                           "endpoint": line["endpoint"]}},
                    "rights": line.get("rights"),
                }
                change = vintages.record(SeriesState(key, entry["freq"], True, scope, observations,
                                                     metadata), ref)
            except StoreError as error:
                result.lines.append(f"REFUSED {error}")
                result.exit_code = 1
                continue
            held[key] = vintages.captures(key)
            result.changes.append(change)
            result.lines.append(_describe(change, line["retrieved_at"]))
            recorded += 1
    if not recorded and not late and result.exit_code == 0:
        result.lines.append(f"nothing new: every capture is already recorded in {vintages.dir}")
