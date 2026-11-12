"""`python -m atlas check`: the Catalog validated in layers (PLAN 5, M12; ADR 0026).

Four layers, in order. A layer runs only when every layer before it found nothing, so a
reader is shown a problem and never its consequences:

1. **schema**: every file is strict JSON, a valid Series, and named for its key.
2. **references**: what an entry points at exists. A Recipe's inputs; an alias that is no other
   Series' key; the Endpoint a Series is bound to, on the register row of its own Origin, for
   its own dataset, bound once.
3. **semantics**: what an entry says makes sense. The aggregation its Measure kind allows; the
   Recipe graph has no cycle (the cycle is named) and never asks for a finer result than an
   input; a difference or a sum takes inputs in one unit, as the engine requires; a Series in
   the pipeline is bound; the dated
   metadata versions are in order.
4. **rights**: the register is one the gate trusts, and no Series in the pipeline comes
   through an intermediary Channel that has not been cleared (ADR 0006, PLAN 6.1). An entry
   cannot state Rights or a Permission at all: the schema has no place for either.

Claims, Events and Topics add their own layers when they arrive (M19, M20).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..capture import store as S
from ..rights import DIRECT, OWN_CHANNELS, RightsGate, load_register
from ..vintage.replay import recipe_cycle
from .load import CATALOG_DIR, Problem, read_catalog

LAYERS = ("schema", "references", "semantics", "rights")
#: What each Measure kind may be combined by: packages/core/src/aggregate.ts, ALLOWED_AGGREGATION.
#: "none" (never combined) is allowed for any kind. A test keeps the two tables the same.
ALLOWED_AGGREGATION = {"stock": ("last", "mean"), "flow": ("sum",), "rate": ("mean",),
                       "index": ("mean", "last"), "annualized": ("mean",)}
#: Frequencies from the finest to the coarsest; an irregular Series has no place in the order.
FINENESS = {"daily": 0, "business_daily": 0, "weekly": 1, "monthly": 2, "quarterly": 3, "annual": 4}


#: The frequencies a Series may have for each way a Board package names time (FedBoardAdapter).
FED_FREQUENCIES = {"day": ("daily", "business_daily"), "week": ("weekly",), "month": ("monthly",),
                   "quarter": ("quarterly",)}


@dataclass
class Layer:
    name: str
    ran: bool = False
    problems: list[Problem] = field(default_factory=list)


@dataclass
class Report:
    directory: Path
    count: int
    layers: list[Layer]

    @property
    def ok(self) -> bool:
        return all(layer.ran and not layer.problems for layer in self.layers)


def _references(entries: dict[str, dict], directory: Path, table: object) -> list[Problem]:
    from ..capture.run import RegisterError, endpoints_from_register

    out: list[Problem] = []

    def problem(key: str, message: str) -> None:
        out.append(Problem("references", str(directory / f"{key}.json"), message))

    try:
        endpoints = {e.id: e for e in endpoints_from_register(table)}
    except RegisterError:
        endpoints = None  # the rights layer says what is wrong with the register
    rows = table.get("rows", []) if isinstance(table, dict) else []
    aliases: dict[str, str] = {}
    bound: dict[tuple[str, str | None], str] = {}
    for key, entry in entries.items():
        for alias in entry.get("aliases", []):
            if alias in entries:
                problem(key, f"its alias {alias} is another Series' key")
            elif alias in aliases:
                problem(key, f"its alias {alias} is also an alias of {aliases[alias]}")
            aliases.setdefault(alias, key)
        for name in entry.get("recipe", {}).get("inputs", []):
            if name not in entries:
                problem(key, f"its recipe takes {name}, which is not in the catalog")
        channel = entry.get("source", {}).get("channel") or {}
        name = channel.get("endpoint")
        if name is None or endpoints is None:
            continue
        origin = entry["source"]["origin"]
        endpoint = endpoints.get(name)
        if endpoint is None:
            problem(key, f"it is bound to the endpoint {name}, which the rights register does not list")
            continue
        row = next((r for r in rows if isinstance(r, dict) and r.get("id") == endpoint.source), {})
        if origin["producer"] not in row.get("origins", []):
            problem(key, f"its Origin is {origin['producer']}, and the endpoint {name} is on the "
                         f"register row of {row.get('name', endpoint.source)}")
        if origin["dataset"] not in endpoint.datasets:
            problem(key, f"its dataset {origin['dataset']} is not one the endpoint {name} fetches "
                         f"({', '.join(endpoint.datasets)})")
        if channel.get("adapter") not in (None, endpoint.adapter):
            problem(key, f"it names the adapter {channel['adapter']}, and the endpoint {name} is "
                         f"fetched by {endpoint.adapter}")
        if channel["via"] != endpoint.channel:
            problem(key, f"its Channel is {channel['via']}, and the endpoint {name} fetches "
                         f"through {endpoint.channel}")
        if origin["origin_id"] is None:
            problem(key, f"it is bound to the endpoint {name} without the Origin's identifier")
        # What the endpoint asks for by name: BLS series, the value fields of a Treasury table,
        # the columns of a Board package.
        listed = endpoint.params.get("expect" if endpoint.adapter == "fed_board" else "series")
        if isinstance(listed, list) and origin["origin_id"] not in (None, *listed):
            problem(key, f"the endpoint {name} does not ask for {origin['origin_id']}")
        elif endpoint.adapter == "fed_board" and origin["origin_id"] is not None:
            if origin["origin_id"] not in endpoint.params.get("labels", {}):
                problem(key, f"the endpoint {name} does not say what unit and multiplier the Board "
                             f"labels {origin['origin_id']} with (its labels)")
            kind = endpoint.params.get("period", "day")
            if entry["freq"] not in FED_FREQUENCIES[kind]:
                problem(key, f"it is {entry['freq']}, and the endpoint {name} is read by {kind}")
        binding = (name, origin["origin_id"])
        if binding in bound:
            problem(key, f"{origin['origin_id']} of {name} is already bound to {bound[binding]}")
        bound.setdefault(binding, key)
    return out


def _metadata_problem(entry: dict) -> str | None:
    versions = entry.get("earlier_metadata")
    if not versions:
        return None
    if versions[0]["from"] is not None:
        return 'its first metadata version must be in force from the start ("from": null)'
    starts = [version["from"] for version in versions[1:]] + [entry["metadata_from"]]
    for start in starts:
        try:
            exact = start is not None and S.stamp(S.unstamp(start)) == start
        except (TypeError, ValueError):
            exact = False
        if not exact:
            return "a metadata version does not say from when, written exactly like 2026-04-01T00:00:00Z"
    if starts != sorted(set(starts)):
        return "its metadata versions are not in order of time"
    return None


def _semantics(entries: dict[str, dict], directory: Path) -> list[Problem]:
    out: list[Problem] = []

    def problem(key: str, message: str) -> None:
        out.append(Problem("semantics", str(directory / f"{key}.json"), message))

    recipes = {key: list(entry["recipe"]["inputs"]) for key, entry in entries.items() if "recipe" in entry}
    cycle = recipe_cycle(recipes)
    if cycle:
        problem(cycle[0], f"the recipes go round in a circle: {' → '.join(cycle)}")
    for key, entry in entries.items():
        kind, agg = entry["measure_kind"], entry["agg"]
        if agg != "none" and agg not in ALLOWED_AGGREGATION[kind]:
            allowed = " or ".join(ALLOWED_AGGREGATION[kind])
            problem(key, f"a {kind} is combined by {allowed}, not by {agg} (or say \"none\")")
        if entry["freq"] == "irregular" and agg != "none":
            problem(key, "an irregular Series has no Periods to combine: its agg is \"none\"")
        bounds = entry.get("range")
        if bounds and not bounds[0] < bounds[1]:
            problem(key, f"its range runs from {bounds[0]} to {bounds[1]}")
        said = _metadata_problem(entry)
        if said:
            problem(key, said)
        if "recipe" not in entry:
            channel = entry["source"]["channel"] or {}
            if entry["status"] == "active" and not channel.get("endpoint"):
                problem(key, "it is active and names no Endpoint: a Series is active once an "
                             "adapter fetches it, and a draft until then")
            continue
        recipe = entry["recipe"]
        inputs = [entries[name] for name in recipe["inputs"]]
        if entry["freq"] not in FINENESS:
            problem(key, "a Derived series has a regular frequency")
            continue
        for one in inputs:
            if one["freq"] not in FINENESS:
                problem(key, f"its input {one['key']} is irregular, which no Recipe can take")
            elif FINENESS[entry["freq"]] < FINENESS[one["freq"]]:
                problem(key, f"it is {entry['freq']}, finer than its input {one['key']} ({one['freq']})")
            if entry["status"] != "draft" and one["status"] == "draft":
                problem(key, f"it is {entry['status']} and its input {one['key']} is a draft")
            elif (entry["status"] != "draft" and "recipe" not in one
                  and not (one["source"]["channel"] or {}).get("endpoint")):
                # Otherwise the series table would hold the Recipe and not what it takes.
                problem(key, f"it is {entry['status']} and its input {one['key']} names no Endpoint, "
                             "so nothing is recorded for it to be computed from")
        if recipe["op"] in ("difference", "sum"):
            # The engine's own rule (packages/core/src/recipe.ts): one unit, in words and in kind.
            kinds = {one["unit_kind"] for one in inputs}
            units = {one["unit"] for one in inputs}
            if len(kinds) > 1:
                problem(key, f"a {recipe['op']} takes inputs of the same kind of unit, not "
                             f"{' and '.join(sorted(kinds))}")
            elif len(units) > 1:
                problem(key, f"a {recipe['op']} takes inputs in one unit, not "
                             f"{' and '.join(sorted(units))}")
            elif recipe["op"] == "difference" and kinds == {"percent"}:
                if entry["unit_kind"] != "percentage_points":
                    problem(key, "the difference of two percentages is in percentage points")
            elif entry["unit_kind"] not in kinds:
                problem(key, f"a {recipe['op']} of {next(iter(kinds))} values is in the same kind "
                             f"of unit, not {entry['unit_kind']}")
        if recipe["op"] == "pct_change" and entry["unit_kind"] != "percent":
            problem(key, "a percent change is in percent")
    return out


def _rights(entries: dict[str, dict], directory: Path, table: object, register: Path | None) -> list[Problem]:
    gate = RightsGate(table)
    where = str(register) if register else "schema/rights-register.json"
    if gate.problem is not None:
        return [Problem("rights", where, f"the rights register cannot be trusted ({gate.problem}), "
                                         "so nothing in the catalog can be published")]
    cleared = {e["channel"] for e in table["cleared_intermediaries"]}
    out = []
    for key, entry in entries.items():
        channel = entry.get("source", {}).get("channel")
        if not channel or entry["status"] == "draft":
            continue
        via = channel["via"]
        if via != DIRECT and via not in OWN_CHANNELS and via not in cleared:
            out.append(Problem("rights", str(directory / f"{key}.json"),
                               f"it is {entry['status']} and comes through {via}, an intermediary "
                               "Channel that no amendment to ADR 0006 has cleared (PLAN 6.1): "
                               "nothing is fetched through it"))
    return out


def check(directory: Path | None = None, register: Path | None = None) -> Report:
    """Run the layers over a catalog directory (default ``catalog/series``) against a rights
    register (default the committed one). Reads files; fetches and writes nothing."""
    directory = Path(directory) if directory else CATALOG_DIR
    entries, problems = read_catalog(directory)
    layers = [Layer(name) for name in LAYERS]
    report = Report(directory, len(entries), layers)
    layers[0].ran, layers[0].problems = True, problems
    if problems:
        return report
    try:
        table = load_register(register)
    except (OSError, ValueError):
        table = None
    steps = (lambda: _references(entries, directory, table), lambda: _semantics(entries, directory),
             lambda: _rights(entries, directory, table, register))
    for layer, step in zip(layers[1:], steps, strict=True):
        layer.ran, layer.problems = True, step()
        if layer.problems:
            break
    return report


def render(report: Report) -> str:
    lines = [f"checking {report.count} Series in {report.directory}"]
    for layer in report.layers:
        if not layer.ran:
            lines.append(f"{layer.name}: not run (an earlier layer failed)")
            continue
        n = len(layer.problems)
        lines.append(f"{layer.name}: ok" if not n else f"{layer.name}: {n} error{'s' if n > 1 else ''}")
        lines.extend(f"  ERROR {problem}" for problem in layer.problems)
    lines.append("check: nothing wrong" if report.ok else "check: failed")
    return "\n".join(lines)
