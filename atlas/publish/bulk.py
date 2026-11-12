"""Bulk files (PLAN 4.4 step 5, section 7 and M25; ADR 0039; ``docs/method/bulk-files.md``): a
public-profile Release's Observations and versions as files a reader takes away whole.

    downloads/observations.parquet | .csv.gz | .ndjson.gz    one table, three formats
    downloads/vintages.parquet                               every version the Release holds
    downloads/observations.{licence}.…, vintages.{licence}.parquet     the same rows, by licence
    downloads/datapackage.json                               Frictionless Data Package v2

``build`` makes them from the files the Release is about to hold and from nothing else: it reads
no store, so a content-only Release and a withdrawal write theirs the same way. A file that
leaves the site needs the Permission to **redistribute**, so a Series is in the tables only when
the gate permits that, on the production Surface, for its own Origin, dataset and Channel and
for those of every Series it is computed from, to any depth. Its history is in
``vintages.parquet`` only when the gate permits it for every Origin, dataset and Channel the
history came through. A Withheld Series has no file to read, and v1's legacy representation is
refused here whatever the gate says. Leaving out is the only way anything is kept out: nothing
writes a row and then hides it.

``problems`` is the writer's check, asked of the bytes about to be staged and not of what
``build`` meant to write: every table is read back, the formats must hold the same rows, and no
row may be of a Series the gate would not hand out.

Only a public-profile Release has bulk files (PLAN M25). Nothing here is called for a local one.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
from dataclasses import dataclass, field
from datetime import date

from ..release import CATALOG, LEGACY, MANIFEST
from ..rights import RightsGate
from .export import RIGHTS_ORDER, dump, history_lineages, lineage

FOLDER = "downloads"
DATAPACKAGE = f"{FOLDER}/datapackage.json"
PROFILE = "https://datapackage.org/profiles/2.0/datapackage.json"
SURFACE = "production"
CHECK = "bulk files"

OBSERVATION_COLUMNS = ("key", "period", "period_start", "period_end", "value", "status", "frequency",
                       "kind", "unit", "licence")
VINTAGE_COLUMNS = ("key", "period", "period_start", "period_end", "value", "status", "deleted",
                   "recorded_from", "recorded_to", "provider_from", "provider_to", "provider_precision",
                   "channel", "origin", "unit", "licence")
_TYPES = {"period_start": "date", "period_end": "date", "value": "number", "deleted": "boolean"}
_ABOUT = {
    "key": "The Series' permanent key.",
    "period": "The Period's label; its shape follows the Series' native frequency.",
    "period_start": "First calendar day of the Period, inclusive.",
    "period_end": "Last calendar day of the Period, inclusive.",
    "value": "The value as published, not rounded. Empty when the Period has none.",
    "status": "The Observation's data state: final, preliminary, revised, estimate, projected or missing.",
    "frequency": "The Series' native frequency.",
    "kind": "stored (as the Origin published it) or derived (computed by a Recipe).",
    "unit": "The unit of the value.",
    "licence": "The licence class of the rights register row the value is under.",
    "deleted": "True when the Origin stopped listing the Period: the version records that it was gone.",
    "recorded_from": "When Macro Atlas first held this version (UTC).",
    "recorded_to": "When Macro Atlas stopped holding it (UTC); empty for the version held now.",
    "provider_from": "When the Origin published this version, where the Origin says; else empty.",
    "provider_to": "When the Origin replaced it, where the Origin says; else empty.",
    "provider_precision": "How exactly the Origin dates the version (for example to the day).",
    "channel": "The route the version was fetched through.",
    "origin": "The Origin recorded with the version.",
}
#: Open Definition licence ids (the Data Package's ``licenses[].name``), by licence class. The
#: class is the register's; the id says only "public domain", "attribution" or "not open".
_OPEN_DEFINITION = {"public_domain": "other-pd", "cc_by": "other-at", "citation_required": "other-at"}
_CLASS_WORDS = {"public_domain": "Public domain", "cc_by": "CC BY", "citation_required": "Citation required",
                "permission_required": "Permission required", "no_redistribution": "No redistribution",
                "unknown": "Not settled"}
_FORMATS = {
    "parquet": {"format": "parquet", "mediatype": "application/vnd.apache.parquet"},
    "csv.gz": {"format": "csv", "mediatype": "application/gzip", "encoding": "utf-8", "compression": "gzip"},
    "ndjson.gz": {"format": "ndjson", "mediatype": "application/gzip", "encoding": "utf-8", "compression": "gzip"},
}


@dataclass
class Bulk:
    """The data files, and what the datapackage will say of them."""

    files: dict[str, bytes] = field(default_factory=dict)
    resources: list[dict] = field(default_factory=list)
    #: Series the Release publishes and the tables do not hold, with the gate's reason.
    left_out: list[dict] = field(default_factory=list)
    #: Series in ``observations`` whose history is not in ``vintages``, with the reason.
    without_history: list[dict] = field(default_factory=list)

    def datapackage(self, release_id: str, created: str, register: dict) -> bytes:
        """``datapackage.json``. With ``release_id`` empty it is what the release id is made
        from, so the id covers everything the descriptor says but its own name."""
        licences = sorted({name for r in self.resources for name in r["licences"]}, key=_class_order)
        return dump({
            "$schema": PROFILE,
            "name": f"macro-atlas-{release_id.lower()}" if release_id else "macro-atlas",
            "title": "Macro Atlas: bulk files",
            "description": ("Every Series of this Release that may be redistributed, at its native frequency "
                            "and not rounded: the Observations as one long table in three formats, and every "
                            "version held of each Period. The same rows are also given by licence class. "
                            "A Series that may be shown but not handed out, and a Withheld Series, are in no file."),
            "release_id": release_id, "created": created, "version": release_id,
            "rights_register": {"version": register.get("version"), "sha256": register.get("sha256")},
            "licenses": _licenses([lic for r in self.resources if "licence" not in r for lic in r["licenses"]]),
            "licences": licences,
            "left_out": self.left_out, "without_history": self.without_history,
            "resources": self.resources,
        })


def _class_order(name: str) -> int:
    return RIGHTS_ORDER.index(name) if name in RIGHTS_ORDER else len(RIGHTS_ORDER)


def _licenses(found: list[dict]) -> list[dict]:
    seen, out = set(), []
    for item in found:
        mark = json.dumps(item, sort_keys=True)
        if mark not in seen:
            seen.add(mark)
            out.append(item)
    return out


def _reached(catalog: dict[str, dict], key: str) -> set[str]:
    reached, stack = set(), [key]
    while stack:
        name = stack.pop()
        if name not in reached:
            reached.add(name)
            stack.extend(catalog.get(name, {}).get("recipe", {}).get("inputs", []))
    return reached


def refusal(files: dict[str, bytes], catalog: dict[str, dict], key: str, gate: RightsGate) -> str | None:
    """Why the Series' values may not be handed out in a file, or None when they may."""
    if gate.problem is not None:
        return f"the rights register cannot be trusted ({gate.problem})"
    reached = _reached(catalog, key)
    missing = sorted(name for name in reached if name not in catalog)
    if missing:
        return f"it rests on {', '.join(missing)}, which the catalog does not describe"
    if any(catalog[name].get("representation") != "native" for name in reached):
        return "v1's legacy representation is in no bulk file"
    decision = gate.permits([lineage(catalog[name], "redistribute") for name in sorted(reached)], SURFACE)
    return None if decision.allowed else decision.reason


def _history_refusal(history: dict, gate: RightsGate) -> str | None:
    try:
        rows = [{**row, "permission": "redistribute"} for row in history_lineages(history)]
    except (ValueError, KeyError, TypeError, AttributeError):
        return "a line of its history does not name its Origin, dataset and Channel"
    if history.get("representation") != "native":
        return "v1's legacy representation is in no bulk file"
    decision = gate.permits(rows, SURFACE)
    return None if decision.allowed else decision.reason


def _number(value) -> float | None:
    return None if value is None else float(value)


def _observation_rows(files: dict[str, bytes], catalog: dict[str, dict], keys: list[str]) -> list[dict]:
    rows = []
    for key in keys:
        folder = "derived" if f"derived/{key}.json" in files else "series"
        document, entry = json.loads(files[f"{folder}/{key}.json"]), catalog[key]
        for o in document["observations"]:
            rows.append({"key": key, "period": o["period"], "period_start": o["period_start"],
                         "period_end": o["period_end"], "value": _number(o["value"]), "status": o["status"],
                         "frequency": document["freq"], "kind": "derived" if folder == "derived" else "stored",
                         "unit": entry.get("unit"), "licence": entry["rights"]["status"]})
    return rows


def _vintage_rows(key: str, history: dict, entry: dict) -> list[dict]:
    """One row per version, each under the metadata recorded with it: the unit, the Origin and
    the licence class a version carries are those of its own day, not today's."""
    lines = {line["hash"]: line["metadata"] for line in history["metadata"]}
    rows = []
    for index, v in enumerate(history["rows"]):
        metadata = lines.get(v["metadata"]) or {}
        rights = metadata.get("rights") or {}
        rows.append({"key": key, "period": v["period"], "period_start": v["period_start"],
                     "period_end": v["period_end"], "value": _number(v["value"]), "status": v["status"],
                     "deleted": bool(v["deleted"]), "recorded_from": v["recorded_from"],
                     "recorded_to": v["recorded_to"], "provider_from": v["provider_from"],
                     "provider_to": v["provider_to"], "provider_precision": v["provider_precision"],
                     "channel": v["channel"],
                     "origin": ((metadata.get("source") or {}).get("origin") or {}).get("producer"),
                     "unit": metadata.get("unit"),
                     "licence": rights.get("licence_class") or entry["rights"]["status"], "_n": index})
    # The order of the file is the order of the versions; a stable sort keeps it within a Period.
    rows.sort(key=lambda r: (r["period_start"], r["recorded_from"], r["_n"]))
    for row in rows:
        del row["_n"]
    return rows


# --- the three formats ----------------------------------------------------------------------------


def _schema(columns: tuple[str, ...]):
    import pyarrow as pa

    types = {"date": pa.date32(), "number": pa.float64(), "boolean": pa.bool_()}
    return pa.schema([pa.field(name, types.get(_TYPES.get(name, ""), pa.string())) for name in columns])


def _parquet(rows: list[dict], columns: tuple[str, ...]) -> bytes:
    import pyarrow as pa
    import pyarrow.parquet as pq

    arrays = {}
    for name in columns:
        values = [row[name] for row in rows]
        if _TYPES.get(name) == "date":
            values = [date.fromisoformat(v) for v in values]
        arrays[name] = values
    table = pa.Table.from_pydict(arrays, schema=_schema(columns))
    sink = io.BytesIO()
    pq.write_table(table, sink, compression="zstd", version="2.6", write_statistics=True)
    return sink.getvalue()


def _text(value) -> str:
    """A cell of the CSV. A number is written as JSON writes it, so it reads back as the same
    double; a boolean as true or false; nothing as nothing."""
    if value is None:
        return ""
    if isinstance(value, bool | float | int):
        return json.dumps(value)
    return str(value)


def _gz(text: str) -> bytes:
    return gzip.compress(text.encode("utf-8"), compresslevel=9, mtime=0)


def _csv(rows: list[dict], columns: tuple[str, ...]) -> bytes:
    sink = io.StringIO()
    writer = csv.writer(sink, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_text(row[name]) for name in columns])
    return _gz(sink.getvalue())


def _ndjson(rows: list[dict], columns: tuple[str, ...]) -> bytes:
    return _gz("".join(json.dumps({name: row[name] for name in columns}, ensure_ascii=False,
                                  separators=(",", ":"), allow_nan=False) + "\n" for row in rows))


_WRITERS = {"parquet": _parquet, "csv.gz": _csv, "ndjson.gz": _ndjson}


def read_table(name: str, data: bytes) -> list[tuple]:
    """A bulk file's rows as plain tuples in the column order, whichever format it is in: dates
    as text, numbers as floats, nothing as None. What the check and the tests compare."""
    table, extension = name.split(".", 1)
    extension = extension.split(".", 1)[1] if extension.split(".", 1)[0] in RIGHTS_ORDER else extension
    columns = VINTAGE_COLUMNS if table == "vintages" else OBSERVATION_COLUMNS

    def cell(column: str, value):
        kind = _TYPES.get(column)
        if value is None or value == "" and extension == "csv.gz":
            return None
        if kind == "number":
            return float(value)
        if kind == "boolean":
            return value if isinstance(value, bool) else {"true": True, "false": False}[value]
        return str(value)

    if extension == "parquet":
        import pyarrow.parquet as pq

        found = pq.read_table(io.BytesIO(data))
        if tuple(found.column_names) != columns:
            raise ValueError("its columns are not the table's")
        return [tuple(cell(c, row[c]) for c in columns) for row in found.to_pylist()]
    text = gzip.decompress(data).decode("utf-8")
    if extension == "csv.gz":
        lines = list(csv.reader(io.StringIO(text)))
        if not lines or tuple(lines[0]) != columns:
            raise ValueError("its header is not the table's columns")
        if any(len(line) != len(columns) for line in lines):
            raise ValueError("a line does not have the table's columns")
        return [tuple(cell(c, v) for c, v in zip(columns, line, strict=True)) for line in lines[1:]]
    rows = [json.loads(line) for line in text.splitlines()]
    if any(tuple(row) != columns for row in rows):
        raise ValueError("a line does not have the table's columns")
    return [tuple(cell(c, row[c]) for c in columns) for row in rows]


# --- build ----------------------------------------------------------------------------------------


def _resource(path: str, data: bytes, table: str, extension: str, rows: list[dict], entries: list[dict],
              licence: str | None) -> dict:
    columns = VINTAGE_COLUMNS if table == "vintages" else OBSERVATION_COLUMNS
    classes = sorted({row["licence"] for row in rows}, key=_class_order)
    licenses = _licenses([
        {**({"name": _OPEN_DEFINITION[e["rights"]["status"]]} if e["rights"]["status"] in _OPEN_DEFINITION
            else {"name": "other-closed"}),
         "title": _CLASS_WORDS.get(e["rights"]["status"], e["rights"]["status"]),
         **({"path": e["rights"]["terms_url"]} if e["rights"].get("terms_url") else {})}
        for e in entries])
    what = "every version held of each Period" if table == "vintages" else "the Observations, one a row"
    return {
        "name": path.replace(".", "-").replace("_", "-"), "path": path, "type": "table",
        "title": f"{'Versions' if table == 'vintages' else 'Observations'}"
                 f"{f' ({_CLASS_WORDS.get(licence, licence)})' if licence else ''}, {extension}",
        "description": f"{what[0].upper()}{what[1:]}"
                       f"{f', for the Series whose licence class is {licence}' if licence else ''}.",
        **_FORMATS[extension], "bytes": len(data), "hash": "sha256:" + hashlib.sha256(data).hexdigest(),
        "rows": len(rows), "series": sorted({row["key"] for row in rows}),
        **({"licence": licence} if licence else {}), "licences": classes,
        "licenses": licenses,
        "sources": _licenses([{"title": e["rights"]["owner"], **({"path": e["rights"]["terms_url"]}
                               if e["rights"].get("terms_url") else {})} for e in entries]),
        "attributions": sorted({e["rights"]["attribution"] for e in entries if e["rights"].get("attribution")}),
        "schema": {"fields": [{"name": name, "type": _TYPES.get(name, "string"), "description": _ABOUT[name]}
                              for name in columns]},
    }


def build(files: dict[str, bytes], gate: RightsGate) -> Bulk:
    """The bulk data files of the Release whose other files are ``files``. Empty when nothing
    it holds may be handed out."""
    catalog = {entry["key"]: entry for entry in json.loads(files[CATALOG])["series"]}
    bulk, allowed = Bulk(), []
    for folder in ("series", "derived"):
        for path in sorted(p for p in files if p.startswith(f"{folder}/")):
            key = path[len(folder) + 1:-len(".json")]
            if json.loads(files[path]).get("representation") == LEGACY:
                reason = "v1's legacy representation is in no bulk file"
            else:
                reason = refusal(files, catalog, key, gate)
            if reason is None:
                allowed.append(key)
            else:
                bulk.left_out.append({"key": key, "reason": reason})
    allowed.sort()
    bulk.left_out.sort(key=lambda row: row["key"])
    if not allowed:
        return bulk
    observations = _observation_rows(files, catalog, allowed)
    versions: list[dict] = []
    for key in allowed:
        path = f"vintages/{key}.json"
        if path not in files:
            if f"series/{key}.json" in files:
                bulk.without_history.append({"key": key, "reason": "the Release holds no history for it"})
            continue
        history = json.loads(files[path])
        reason = _history_refusal(history, gate)
        if reason is None:
            versions.extend(_vintage_rows(key, history, catalog[key]))
        else:
            bulk.without_history.append({"key": key, "reason": reason})

    def add(table: str, rows: list[dict], licence: str | None) -> None:
        columns = VINTAGE_COLUMNS if table == "vintages" else OBSERVATION_COLUMNS
        entries = [catalog[key] for key in sorted({row["key"] for row in rows})]
        for extension in (("parquet",) if table == "vintages" else tuple(_WRITERS)):
            name = f"{table}{f'.{licence}' if licence else ''}.{extension}"
            data = _WRITERS[extension](rows, columns)
            bulk.files[f"{FOLDER}/{name}"] = data
            bulk.resources.append(_resource(name, data, table, extension, rows, entries, licence))

    for table, rows in (("observations", observations), ("vintages", versions)):
        if not rows:  # no history that may be handed out: no file, rather than an empty one
            continue
        add(table, rows, None)
        for licence in sorted({row["licence"] for row in rows}, key=_class_order):
            add(table, [row for row in rows if row["licence"] == licence], licence)
    return bulk


def report(bulk: Bulk) -> dict:
    """The line of the check report that says what the bulk files hold and what they leave out."""
    if not bulk.files:
        return {"check": CHECK, "outcome": "warn",
                "detail": "none written: no Series of this Release may be redistributed"
                          + (f" ({bulk.left_out[0]['key']}: {bulk.left_out[0]['reason']})" if bulk.left_out else "")}
    notes = []
    if bulk.left_out:
        notes.append("not in any bulk file: " + ", ".join(row["key"] for row in bulk.left_out[:8])
                     + (f" and {len(bulk.left_out) - 8} more" if len(bulk.left_out) > 8 else "")
                     + f" ({bulk.left_out[0]['reason']})")
    refused = [row for row in bulk.without_history if row["reason"] != "the Release holds no history for it"]
    if refused:
        notes.append("history not in vintages.parquet: " + ", ".join(row["key"] for row in refused[:8])
                     + f" ({refused[0]['reason']})")
    return {"check": CHECK, "outcome": "warn", "detail": "; ".join(notes)[:2000]} if notes else {
        "check": CHECK, "outcome": "pass"}


# --- the check ------------------------------------------------------------------------------------


def problems(files: dict[str, bytes], gate: RightsGate) -> list[str]:
    """Why the bulk files in ``files`` are not what a public Release may hold. Read from the
    bytes: each table again, in every format; the rows the Release's own files give; and the
    gate, asked afresh about every Series a row names."""
    paths = sorted(p for p in files if p.startswith(f"{FOLDER}/") and p != DATAPACKAGE)
    if not paths and DATAPACKAGE not in files:
        return []
    if json.loads(files[MANIFEST]).get("profile") != "public" if MANIFEST in files else False:
        return ["bulk files are written only for a public-profile release"]
    catalog = {entry["key"]: entry for entry in json.loads(files[CATALOG])["series"]}
    found: list[str] = []
    tables: dict[str, list[tuple]] = {}
    for path in paths:
        name = path[len(FOLDER) + 1:]
        try:
            tables[name] = read_table(name, files[path])
        except Exception as error:  # noqa: BLE001 - whatever stops a file being read is the finding
            found.append(f"{name}: cannot be read as its table ({error})")
    if found:
        return found
    refused: dict[str, str | None] = {}
    for name, rows in tables.items():
        history = name.startswith("vintages")
        for key in sorted({row[0] for row in rows}):
            if key not in refused:
                held = f"series/{key}.json" in files or f"derived/{key}.json" in files
                refused[key] = refusal(files, catalog, key, gate) if held and key in catalog else (
                    "the Release publishes no such Series")
            reason = refused[key]
            if reason is None and history:
                path = f"vintages/{key}.json"
                reason = _history_refusal(json.loads(files[path]), gate) if path in files else (
                    "the Release holds no history for it")
            if reason is not None:
                found.append(f"{name}: holds {key}, which may not be in it: {reason}")
    if found:
        return found
    # What the Release's own files give under this gate, written out again and compared row for
    # row: a Series left out of a table is found as surely as one that should not be in it.
    keys = sorted(
        path.split("/")[1][:-len(".json")] for path in files
        if path.startswith(("series/", "derived/"))
        and json.loads(files[path]).get("representation") != LEGACY
        and refusal(files, catalog, path.split("/")[1][:-len(".json")], gate) is None)
    expected = {"observations": [tuple(row[c] for c in OBSERVATION_COLUMNS)
                                 for row in _observation_rows(files, catalog, keys)]}
    versions = []
    for key in keys:
        path = f"vintages/{key}.json"
        if path in files and _history_refusal(json.loads(files[path]), gate) is None:
            versions.extend(_vintage_rows(key, json.loads(files[path]), catalog[key]))
    expected["vintages"] = [tuple(row[c] for c in VINTAGE_COLUMNS) for row in versions]
    for table in ("observations", "vintages"):
        if expected[table] and f"{table}.parquet" not in tables:
            found.append(f"{table}.parquet: is missing")
    for name, rows in sorted(tables.items()):
        parts = name.split(".")
        table, licence = parts[0], parts[1] if parts[1] in RIGHTS_ORDER else None
        want = [row for row in expected[table] if licence is None or row[-1] == licence]
        if rows != want:
            found.append(f"{name}: its rows are not the Release's own ({len(rows)} rows, {len(want)} expected"
                         f"{'' if len(rows) != len(want) else ', a value differs'})")
    for extension in ("csv.gz", "ndjson.gz"):
        for name in sorted(n for n in tables if n.startswith("observations") and n.endswith(".parquet")):
            other = name[:-len("parquet")] + extension
            if other not in tables:
                found.append(f"{other}: is missing, and {name} is there")
    return found
