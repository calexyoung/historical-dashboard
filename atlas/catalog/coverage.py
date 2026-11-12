"""Coverage matrices (PLAN M14; ADR 0028): countries by indicators, each cell naming the Series
of the Catalog that fills it, or saying why none does.

A matrix is declared in ``catalog/coverage/{name}.json`` (``schema/coverage.schema.json``). The
declaration says only *which* Series belongs in a cell. Everything a reader is told about that
Series is worked out here from the Catalog and the rights register each time the page is
written: whether an adapter captures it, what is proposed for a draft and what is still open,
why a withheld Series is withheld, and what the rights gate would show today. Nothing in a
matrix grants anything, and it holds no data.

``atlas check`` holds every matrix to the Catalog (the schema and references layers).
``atlas catalog --write`` writes ``docs/v2/g20-coverage.md`` from the matrix called ``g20``.
"""
from __future__ import annotations

import json
from functools import cache
from pathlib import Path

from jsonschema import Draft202012Validator

from ..rights import RightsGate
from .load import ROOT, CatalogError, Problem, _no_repeated_keys, _where, leaves, register_row
from .table import _cell, gate_shows, proposal

COVERAGE_DIR = ROOT / "catalog" / "coverage"
COVERAGE_SCHEMA = ROOT / "schema" / "coverage.schema.json"
COVERAGE_PAGE = ROOT / "docs" / "v2" / "g20-coverage.md"


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(COVERAGE_SCHEMA.read_text(encoding="utf-8")))


def read_coverage(directory: Path | None = None) -> tuple[dict[str, dict], list[Problem]]:
    """Every matrix that is a valid one, by its file's name, and what is wrong with the files
    that are not. A directory that does not exist holds no matrix."""
    directory = Path(directory) if directory else COVERAGE_DIR
    found: dict[str, dict] = {}
    problems: list[Problem] = []
    if not directory.is_dir():
        return found, problems
    for path in sorted(directory.iterdir()):
        if path.name.startswith("."):
            continue

        def problem(message: str, path: Path = path) -> None:
            problems.append(Problem("schema", str(path), message))

        if path.suffix != ".json" or not path.is_file():
            problem("a coverage directory holds only {name}.json files")
            continue
        try:
            declared = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_no_repeated_keys)
        except (OSError, ValueError) as error:
            problem(f"it cannot be read as JSON: {error}")
            continue
        errors = sorted(_validator().iter_errors(declared), key=lambda e: list(map(str, e.absolute_path)))
        if errors:
            for error in errors[:5]:
                problem(f"{_where(error)}: {error.message[:300]}")
            continue
        names = [column["id"] for column in declared["columns"]]
        twice = next((name for name in names if names.count(name) > 1), None)
        if twice:
            problem(f"two columns are called {twice}")
            continue
        found[path.stem] = declared
    return found, problems


def load_coverage(directory: Path | None = None) -> dict[str, dict]:
    """The matrices by name. Raises ``CatalogError`` if a file is not a valid matrix."""
    found, problems = read_coverage(directory)
    if problems:
        raise CatalogError(f"the coverage matrices cannot be read: {problems[0]}; run python -m atlas check")
    return found


def _resolved(declared: dict, row: dict, column: dict) -> dict | None:
    """The cell of a row and column: the row's own, else the column's default, else None."""
    return row["cells"].get(column["id"]) or column.get("default")


def coverage_references(found: dict[str, dict], entries: dict[str, dict], directory: Path) -> list[Problem]:
    """What a matrix points at exists and fits: a cell's Series is in the Catalog and is a
    Series of the row's country (or, shared, of the group the row says it is a member of);
    every cell of every row is filled or has a default; a Series fills one cell of a row."""
    out: list[Problem] = []
    for name, declared in found.items():
        def problem(message: str, name: str = name) -> None:
            out.append(Problem("references", str(Path(directory) / f"{name}.json"), message))

        columns = {column["id"]: column for column in declared["columns"]}
        seen: set[str] = set()
        for row in declared["rows"]:
            if row["country"] in seen:
                problem(f"{row['country']} has two rows")
                continue
            seen.add(row["country"])
            for extra in row["cells"]:
                if extra not in columns:
                    problem(f"{row['name']}: {extra} is not a column of the matrix")
            placed: dict[str, str] = {}
            for column in declared["columns"]:
                where = f"{row['name']}, {column['id']}"
                cell = _resolved(declared, row, column)
                if cell is None:
                    problem(f"{where}: the cell is not filled and the column has no default")
                    continue
                key = cell.get("series") or cell.get("shared")
                if key is None:
                    continue
                if "shared" in cell and "member_of" not in row:
                    problem(f"{where}: a shared Series needs the row to say what it is a member of")
                    continue
                owner = row["member_of"] if "shared" in cell else row["country"]
                if key not in entries:
                    problem(f"{where}: {key} is not in the catalog")
                elif entries[key]["country"] != owner:
                    problem(f"{where}: {key} is a Series of {entries[key]['country']}, not of {owner}")
                elif key in placed:
                    problem(f"{where}: {key} is already the {placed[key]} cell of {row['name']}")
                placed.setdefault(key, column["id"])
    return out


# --- the page ----------------------------------------------------------------------------------


def _state(entry: dict, entries: dict[str, dict], table: object, gate: RightsGate) -> str:
    """``pipeline`` (an adapter captures it, or the engine computes it from what one captures),
    ``draft`` (declared; nothing is fetched), ``withheld`` (no route is known) or ``retired``."""
    if entry["status"] == "retired":
        return "retired"
    if entry["status"] == "active":
        return "pipeline"
    return "withheld" if proposal(entry, entries, table, gate).label == "withheld" else "draft"


def render_coverage(entries: dict[str, dict], table: object, declared: dict) -> str:
    """The coverage page of one matrix, from the Catalog and the register as they stand."""
    gate = RightsGate(table)
    columns, rows = declared["columns"], declared["rows"]
    grid: dict[tuple[str, str], tuple[str, dict, dict | None]] = {}
    for row in rows:
        for column in columns:
            cell = _resolved(declared, row, column)
            key = cell.get("series") or cell.get("shared")
            entry = entries[key] if key else None
            grid[row["country"], column["id"]] = (_state(entry, entries, table, gate) if entry else "none", cell, entry)

    def shown(row: dict, column: dict) -> str:
        state, cell, entry = grid[row["country"], column["id"]]
        if entry is None:
            return "—"
        text = f"`{entry['key']}`"
        if "shared" in cell:
            text += f" ({row['member_of']})"
        return text if state == "pipeline" else f"{text} ({state})"

    lines = [
        f"# G20 coverage: {declared['title'][0].lower()}{declared['title'][1:]}",
        "",
        "<!-- GENERATED by `python -m atlas catalog --write` from catalog/coverage/g20.json, catalog/series",
        "     and schema/rights-register.json. Do not edit: change the matrix, a Series file or the register. -->",
        "",
        declared["about"],
        "",
        "**This page is not permission and holds no data.** It says which Series of the Catalog fills",
        "each cell and what state that Series is in. Whether a value may be shown on a public Surface",
        "is the rights gate's answer, from rows Alex has signed; that answer for today is given below.",
        "",
        "## The matrix",
        "",
        "| Country | " + " | ".join(_cell(column["name"]) for column in columns) + " |",
        "|---|" + "---|" * len(columns),
    ]
    lines += [f"| {_cell(row['name'])} | " + " | ".join(shown(row, column) for column in columns) + " |"
              for row in rows]
    lines += [
        "",
        "How to read a cell:",
        "",
        "- `key` alone: the Series is **in the pipeline**. An adapter captures it from its Origin, or",
        "  the engine computes it from Series that are captured.",
        "- `key` (draft): the Series is declared in the Catalog and nothing fetches it yet.",
        "- `key` (withheld): no publishable route to it is known.",
        "- `key` (EA): the Series of the euro area, which the country is a member of.",
        "- —: no Series. The reason is under \"Why a cell is not live\".",
        "",
        "| Indicator | In the pipeline | Draft | Withheld | No Series |",
        "|---|---|---|---|---|",
    ]
    for column in columns:
        states = [grid[row["country"], column["id"]][0] for row in rows]
        lines.append(f"| {_cell(column['name'])} | {states.count('pipeline')} | {states.count('draft')} "
                     f"| {states.count('withheld')} | {states.count('none')} |")

    live = list(dict.fromkeys(entry["key"] for state, _, entry in grid.values() if state == "pipeline"))
    allowed = sum(gate_shows(entries[key], entries, gate) for key in live)
    by_row: dict[str, tuple[dict, set[str]]] = {}
    for key in live:
        for leaf in leaves(key, entries):
            origin = entries[leaf]["source"]["origin"]
            row = register_row(table, gate, origin["producer"], origin["dataset"])
            if row is not None:
                by_row.setdefault(row["id"], (row, set()))[1].add(key)
    lines += [
        "",
        "## In the pipeline, and what the rights gate says today",
        "",
        f"The rights gate would show {allowed} of the {len(live)} Series in the pipeline on production today.",
        "A Series is shown only when the register row of every Origin it rests on is signed and allows display.",
        "",
        "| Origin | Register row | Decision | Series of this matrix resting on it |",
        "|---|---|---|---|",
    ]
    for row, keys in by_row.values():
        decision = row.get("decision")
        said = "not signed" if decision is None else (
            f"signed {decision['signed_on']}: display {'allowed' if decision.get('display') is True else 'refused'}")
        lines.append(f"| {_cell(row['name'])} | `{row['id']}` | {said} | {len(keys)} |")

    lines += ["", "## Why a cell is not live", ""]
    for column in columns:
        items: list[str] = []
        absent: dict[tuple[str, str | None], list[str]] = {}
        for row in rows:
            state, cell, entry = grid[row["country"], column["id"]]
            if state == "none":
                absent.setdefault((cell["none"], cell.get("waits_for")), []).append(row["name"])
            elif state != "pipeline":
                p = proposal(entry, entries, table, gate)
                text = p.text.rstrip(".")
                still = f" Still open: {'; '.join(p.open)}." if p.open else ""
                shared = f" ({row['member_of']})" if "shared" in cell else ""
                items.append(f"- **{_cell(row['name'])}**, `{entry['key']}`{shared} ({state}): {_cell(text)}.{_cell(still)}")
        for (reason, waits), names in absent.items():
            waiting = f" Waits for {waits}." if waits else ""
            items.append(f"- **{', '.join(names)}**: no Series. {_cell(reason.rstrip('.'))}.{waiting}")
        lines += [f"### {_cell(column['name'])}", "", *(items or ["Every cell is in the pipeline."]), ""]

    notes = [f"- `{entry['key']}` ({_cell(row['name'])}, {_cell(column['name'])}): {_cell(cell['note'])}"
             for row in rows for column in columns
             for _, cell, entry in [grid[row["country"], column["id"]]] if entry and cell.get("note")]
    if notes:
        lines += ["## Notes", "", *notes, ""]
    return "\n".join(lines)


def write_coverage(entries: dict[str, dict], table: object, declared: dict) -> Path:
    COVERAGE_PAGE.write_text(render_coverage(entries, table, declared), encoding="utf-8")
    return COVERAGE_PAGE
