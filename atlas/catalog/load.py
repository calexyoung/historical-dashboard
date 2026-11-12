"""Reading the Catalog (PLAN 5, M12; ADR 0026).

The Catalog is one JSON file per Series, ``catalog/series/{key}.json``, each valid against
``schema/series.schema.json``. This module reads them strictly and answers two questions the
rest of the writer asks:

- ``series_table``: which Series are captured and recorded, in the shape the vintage store has
  replayed since M8 (the endpoint a Series is bound to, the Origin's identifier, the declared
  metadata as dated versions) and which Derived series are computed. A draft is in neither.
- ``rights_block``: the Rights of a Series, looked up in the rights register for its Origin and
  dataset. An entry holds no Rights and no Permission of its own, so nothing typed into the
  Catalog can grant anything (ADR 0006, ADR 0020).

Hidden here: the file layout, strict JSON, the schema, and how an entry's flat fields and its
``earlier_metadata`` become the store's dated versions.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
CATALOG_DIR = ROOT / "catalog" / "series"
SCHEMA_PATH = ROOT / "schema" / "series.schema.json"
#: A table of this format is what ``atlas.vintage.replay`` checks and replays.
TABLE_FORMAT = 1
#: What a Release's Catalog entry takes from a Series beyond its recorded metadata, in the
#: order the release writer has always written them (``atlas.publish.export.CATALOG_FIELDS``).
RELEASE_FIELDS = ("measure_kind", "unit_kind", "segment", "continuity", "agg", "max_lag", "range",
                  "price_basis", "base_period", "country", "topics", "definition", "aliases", "breaks")
#: The declared metadata the vintage store records as history (ADR 0022).
RECORDED = ("name", "unit", "seasonal_adjustment")


class CatalogError(ValueError):
    """The Catalog cannot be used."""


@dataclass(frozen=True)
class Problem:
    layer: str
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


@cache
def _validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def _no_repeated_keys(pairs):
    seen = {}
    for name, value in pairs:
        if name in seen:
            raise ValueError(f"it says {name!r} twice")
        seen[name] = value
    return seen


def _where(error) -> str:
    return "/".join(str(part) for part in error.absolute_path) or "the entry"


def read_catalog(directory: Path | None = None) -> tuple[dict[str, dict], list[Problem]]:
    """Every entry that is a valid Series, by key, and what is wrong with the files that are
    not (the schema layer of ``atlas check``). Never raises for what a file says."""
    directory = Path(directory) if directory else CATALOG_DIR
    entries: dict[str, dict] = {}
    problems: list[Problem] = []

    def problem(path: Path, message: str) -> None:
        problems.append(Problem("schema", str(path), message))

    if not directory.is_dir():
        return {}, [Problem("schema", str(directory), "there is no such catalog directory")]
    for path in sorted(directory.iterdir()):
        if path.name.startswith("."):
            continue
        if path.suffix != ".json" or not path.is_file():
            problem(path, "a catalog directory holds only {key}.json files")
            continue
        try:
            entry = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_repeated_keys)
        except (OSError, ValueError) as error:
            problem(path, f"it cannot be read as JSON: {error}")
            continue
        errors = sorted(_validator().iter_errors(entry), key=lambda e: list(map(str, e.absolute_path)))
        if errors:
            for error in errors[:5]:
                problem(path, f"{_where(error)}: {error.message[:300]}")
            continue
        if entry["key"] != path.stem:
            problem(path, f"it holds the Series {entry['key']}; a file is named for its key")
            continue
        entries[entry["key"]] = entry
    return entries, problems


def load_catalog(directory: Path | None = None) -> dict[str, dict]:
    """The Catalog's entries by key. Raises ``CatalogError`` if any file is not a valid Series."""
    entries, problems = read_catalog(directory)
    if problems:
        more = f" (and {len(problems) - 1} more)" if len(problems) > 1 else ""
        raise CatalogError(f"the catalog cannot be read: {problems[0]}{more}; run python -m atlas check")
    return entries


# --- the series table --------------------------------------------------------------------------


def _versions(entry: dict) -> list[dict]:
    """Every version says the same three things, the current one exactly as an earlier one
    does, so that moving a version into ``earlier_metadata`` changes nothing it recorded."""
    own = {"from": entry.get("metadata_from"), **{name: entry[name] for name in RECORDED}}
    return [*({"from": v["from"], **{name: v[name] for name in RECORDED}}
              for v in entry.get("earlier_metadata", [])), own]


def _release_block(entry: dict) -> dict:
    return {name: entry[name] for name in RELEASE_FIELDS if name in entry}


def series_table(entries: dict[str, dict]) -> dict:
    """The series table of M8 (``atlas.vintage.replay``), from the Catalog: every stored Series
    that is bound to an Endpoint and is not a draft, and every Derived series that is not a
    draft. A retired Series stays, so that its history is still replayed and shown."""
    series, derived = [], []
    for key in sorted(entries):
        entry = entries[key]
        if entry["status"] == "draft":
            continue
        if "recipe" in entry:
            row = {"key": key, "freq": entry["freq"], "name": entry["name"], "unit": entry["unit"],
                   "seasonal_adjustment": entry["seasonal_adjustment"]}
            derived.append({**row, "recipe": entry["recipe"], "catalog": _release_block(entry)})
            continue
        channel = entry["source"]["channel"]
        if not channel or not channel.get("endpoint"):
            continue
        origin = entry["source"]["origin"]
        series.append({"key": key, "freq": entry["freq"], "endpoint": channel["endpoint"],
                       "origin_id": origin["origin_id"], "dataset": origin["dataset"],
                       "url": origin["url"], "metadata": _versions(entry),
                       "catalog": _release_block(entry)})
    return {"format": TABLE_FORMAT, "series": series, "derived": derived}


# --- rights, looked up -------------------------------------------------------------------------


def register_row(table: object, gate, producer: str, dataset: str) -> dict | None:
    """The register's row for an Origin and dataset, or None. A register the gate does not
    trust has no rows."""
    rows = table["rows"] if gate.problem is None else []
    return next((r for r in rows if r["kind"] == "origin" and producer in r["origins"]
                 and (r["datasets"] == "*" or dataset in r["datasets"])), None)


def leaves(key: str, entries: dict[str, dict]) -> list[str]:
    """The stored Series a Series rests on, in the order its Recipes reach them. A stored
    Series rests on itself. An input that is not in the Catalog, or a Recipe that comes back
    to itself, ends the walk there (the references and semantics layers report those)."""
    found: list[str] = []

    def walk(name: str, path: tuple[str, ...]) -> None:
        entry = entries.get(name)
        if entry is None or name in path:
            return
        if "recipe" not in entry:
            if name not in found:
                found.append(name)
            return
        for each in entry["recipe"]["inputs"]:
            walk(each, (*path, name))

    walk(key, ())
    return found


def rights_block(entry: dict, entries: dict[str, dict], table: object, gate) -> dict:
    """The Rights of a Series as the register reads today: for a stored Series, its Origin's
    row; for a Derived series, the most restrictive status among the stored Series it rests on
    with all their owners and attributions (ADR 0025). Never read from the entry."""
    from ..publish.export import _register_rights, combined_rights

    def stored(one: dict) -> dict:
        origin = one["source"]["origin"]
        return _register_rights(table, gate, origin["producer"], origin["dataset"])

    if "recipe" not in entry:
        return stored(entry)
    rests_on = [entries[key] for key in leaves(entry["key"], {**entries, entry["key"]: entry})]
    if not rests_on:
        return {"owner": "Macro Atlas", "terms_url": None, "status": "unknown", "attribution": None,
                "reviewed": None}
    return combined_rights([stored(one) for one in rests_on])
