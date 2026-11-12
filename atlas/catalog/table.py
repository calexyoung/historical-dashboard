"""The migration table (PLAN M12; ADR 0026): every Series of the Catalog with what v1 took it
from, the Source proposed for it, and one of three proposals.

- **re-source from X**: an Origin publishes it over a direct Channel (or it is entered by hand
  from one), and the rights register *proposes* to allow that Origin's data to be shown.
- **needs D2**: the route depends on a decision the register does not propose a yes to: an
  intermediary Channel, an Origin with no row yet, or a row whose proposal is no display.
- **withheld**: no route is known. The entry says which: a rights restriction, no route
  established, or discontinued.

The proposal is worked out here from the entry and the register's rows and is typed nowhere.
It reads proposals, never decisions: it is advice for Alex and authorises nothing. What may
actually be shown is the rights gate's answer, which needs a signed row (ADR 0020).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..rights import DIRECT, OWN_CHANNELS, RightsGate
from .load import ROOT, leaves, register_row

TABLE_PATH = ROOT / "docs" / "v2" / "catalog-migration.md"
RANK = {"re-source": 0, "needs D2": 1, "withheld": 2}
NO_CHANNEL_WORDS = {"rights_restriction": "rights restriction", "no_route_established": "no route established",
                    "discontinued": "discontinued"}
SEGMENTS = {"economy_jobs": "Economy & jobs", "markets_money": "Markets & money",
            "infrastructure": "Infrastructure", "governance_politics": "Governance & politics",
            "disasters_health": "Disasters & health", "us_in_the_world": "The US in the world"}


@dataclass(frozen=True)
class Proposal:
    label: str  # "re-source", "needs D2" or "withheld"
    text: str
    open: list[str] = field(default_factory=list)
    origins: tuple[str, ...] = ()


def _stored(entry: dict, table: object, gate: RightsGate) -> Proposal:
    source = entry["source"]
    origin, channel = source["origin"], source["channel"]
    if channel is None:
        said = source["no_channel"]
        return Proposal("withheld", f"withheld ({NO_CHANNEL_WORDS[said['kind']]}): {said['reason']}")
    still = []
    if not channel.get("endpoint"):
        planned = entry.get("migration", {}).get("milestone")
        still.append(f"adapter not built (planned for {planned})" if planned else "adapter not built")
    if origin["origin_id"] is None:
        still.append("identifier not settled")
    change = entry.get("migration", {}).get("change")
    if change == "representation":
        still.append("the same quantity in another representation than v1's")
    elif change == "different":
        still.append("a different quantity from v1's")
    via = channel["via"]
    row = register_row(table, gate, origin["producer"], origin["dataset"])
    if row is not None and row.get("open_questions"):
        n = len(row["open_questions"])
        still.append(f"{n} open question{'s' if n > 1 else ''} on the register row")
    if via != DIRECT and via not in OWN_CHANNELS:
        return Proposal("needs D2", f"needs D2: {via} is an intermediary Channel; it needs a decision "
                                    "on its own register row and an amendment to ADR 0006", still)
    if row is None:
        return Proposal("needs D2", f"needs D2: the register has no row for {origin['producer']}", still)
    if (row.get("proposal") or {}).get("display") is not True:
        unread = " (its terms are not read)" if row.get("licence_class") == "unknown" else ""
        return Proposal("needs D2", f"needs D2: the register proposes no display for {row['name']}{unread}", still)
    how = ", entered by hand" if via == "hand_entered" else ""
    return Proposal("re-source", f"re-source from {row['name']}{how}", still, (row["name"],))


def proposal(entry: dict, entries: dict[str, dict], table: object, gate: RightsGate) -> Proposal:
    """What is proposed for a Series. A Derived series takes the least favourable proposal
    among the stored Series it rests on."""
    if "recipe" not in entry:
        return _stored(entry, table, gate)
    known = {**entries, entry["key"]: entry}
    below = {key: _stored(known[key], table, gate) for key in leaves(entry["key"], known)}
    if not below:
        return Proposal("withheld", "withheld: its recipe reaches no stored Series")
    worst = max(RANK[p.label] for p in below.values())
    blocking = [key for key, p in below.items() if RANK[p.label] == worst]
    # What stands in the way of a Derived series is what stands in the way of each Series it
    # rests on, named, and what its own entry records.
    still = []
    change = entry.get("migration", {}).get("change")
    if change == "representation":
        still.append("the same quantity in another representation than v1's")
    elif change == "different":
        still.append("a different quantity from v1's")
    still += [f"{key}: {item}" for key, p in below.items() for item in p.open]
    if worst == 0:
        origins = tuple(dict.fromkeys(name for p in below.values() for name in p.origins))
        return Proposal("re-source", f"re-source from {' and '.join(origins)} (computed from "
                                     f"{', '.join(below)})", still, origins)
    label = "needs D2" if worst == 1 else "withheld"
    why = below[blocking[0]].text.split(": ", 1)[1] if ": " in below[blocking[0]].text else below[blocking[0]].text
    return Proposal(label, f"{label}: it is computed from {', '.join(blocking)} ({why.rstrip('.')})", still)


def gate_shows(entry: dict, entries: dict[str, dict], gate: RightsGate) -> bool:
    """Would the rights gate let this Series be displayed on production today? The live answer,
    from decisions; the table above is only what is proposed."""
    known = {**entries, entry["key"]: entry}
    lineage = []
    for key in leaves(entry["key"], known):
        source = known[key]["source"]
        if source["channel"] is None:
            return False
        lineage.append({"origin": source["origin"]["producer"], "dataset": source["origin"]["dataset"],
                        "channel": source["channel"]["via"], "representation": "native",
                        "permission": "display"})
    return bool(lineage) and gate.permits(lineage, "production").allowed


def _cell(text: object) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def _source_cell(entry: dict) -> str:
    if "recipe" in entry:
        recipe = entry["recipe"]
        lag = f", {recipe['params']['lag']} Periods earlier" if "params" in recipe else ""
        return f"Recipe: {recipe['op']} of {', '.join(f'`{k}`' for k in recipe['inputs'])}{lag}"
    origin, channel = entry["source"]["origin"], entry["source"]["channel"]
    text = f"{origin['producer']}: {origin['dataset']}"
    if origin["origin_id"]:
        text += f" (`{origin['origin_id']}`)"
    if channel is None:
        return text + "; no Channel"
    return text + ("" if channel["via"] == DIRECT else f"; {channel['via'].replace('_', ' ')}")


def render_table(entries: dict[str, dict], table: object) -> str:
    """docs/v2/catalog-migration.md, from the Catalog and the register's rows."""
    gate = RightsGate(table)
    proposed = {key: proposal(entry, entries, table, gate) for key, entry in entries.items()}
    from_v1 = [key for key, entry in entries.items() if "migration" in entry]
    new = sorted(key for key in entries if key not in from_v1)
    counts = {label: sum(proposed[key].label == label for key in from_v1) for label in RANK}
    missing: dict[str, list[str]] = {}
    for key, entry in entries.items():
        if "source" in entry and entry["source"]["channel"] is not None:
            origin = entry["source"]["origin"]
            if register_row(table, gate, origin["producer"], origin["dataset"]) is None:
                missing.setdefault(origin["producer"], []).append(key)
    lines = [
        "# Catalog migration: every v1 series and what is proposed for it",
        "",
        "<!-- GENERATED by `python -m atlas catalog --write` from catalog/series and the rows of",
        "     schema/rights-register.json. Do not edit: change a Series file or the register. -->",
        "",
        "v1 showed 126 series: 123 in its output and three entered by hand. Each is a Series of",
        "the Catalog now, under the same key (`catalog/series/{key}.json`), with the Source",
        "proposed for it. This table is the answer M12 owes to \"what happens to each of them\".",
        "",
        "**This is advice, not permission.** A proposal is worked out from the entry and from what",
        "each register row *proposes*; it never reads a decision. Nothing reaches a public Surface",
        "until Alex has decided the row it rests on, and the rights gate answers that question",
        "separately (`python -m atlas catalog` prints its answer for today). An identifier or a",
        "route written here is what the migration proposes, to be confirmed with a captured",
        "fixture by the milestone that builds the adapter.",
        "",
        "| Proposal | v1 series | Meaning |",
        "|---|---|---|",
        (f"| re-source from an Origin | {counts['re-source']} | An Origin publishes it over a direct "
         "Channel (or it is entered by hand from one) and the register proposes to allow that "
         "Origin's data to be shown. |"),
        (f"| needs D2 | {counts['needs D2']} | The route depends on a decision the register does not "
         "propose a yes to: an Origin with no row yet, a row whose proposal is no display, or an "
         "intermediary Channel. |"),
        (f"| withheld | {counts['withheld']} | No route is known: a rights restriction, no route "
         "established yet, or discontinued. The Series stays in the Catalog by name. |"),
        "",
        (f"{len(new)} Series were never in v1: {', '.join(f'`{key}`' for key in new)}. `cpi_nsa` (M8) is "
         "what `cpi_yoy` is computed from (ADR 0025); the others arrived with the adapter that "
         f"reads them (M13, ADR 0027). {len(entries)} Series in all."),
        "",
    ]
    if missing:
        lines += ["## Origins the register has no row for", "",
                  ("Each needs a row, with its terms read, before anything can be decided for the "
                   "Series named."), ""]
        lines += [f"- **{producer}**: {', '.join(f'`{k}`' for k in keys)}" for producer, keys in sorted(missing.items())]
        lines.append("")
    lines += ["## The table", ""]
    for segment, title in SEGMENTS.items():
        keys = [key for key in sorted(entries) if entries[key]["segment"] == segment]
        if not keys:
            continue
        lines += [f"### {title}", "",
                  "| Key | Name | v1 took it from | Proposed Source | Proposal | Still open |",
                  "|---|---|---|---|---|---|"]
        for key in keys:
            entry, p = entries[key], proposed[key]
            v1 = entry.get("migration", {}).get("v1_source", "not in v1")
            lines.append(f"| `{key}` | {_cell(entry['name'])} | {_cell(v1)} | {_cell(_source_cell(entry))} "
                         f"| {_cell(p.text)} | {_cell('; '.join(p.open) or '—')} |")
        lines.append("")
    notes = [(key, entries[key]["migration"]["note"]) for key in sorted(entries)
             if entries[key].get("migration", {}).get("note")]
    if notes:
        lines += ["## Notes on single Series", ""]
        lines += [f"- `{key}`: {_cell(note)}" for key, note in notes]
        lines.append("")
    return "\n".join(lines)


def summary(entries: dict[str, dict], table: object) -> str:
    gate = RightsGate(table)
    proposed = {key: proposal(entry, entries, table, gate) for key, entry in entries.items()}
    shown = sum(gate_shows(entry, entries, gate) for entry in entries.values())
    lines = [f"{len(entries)} Series in the catalog"]
    for label in RANK:
        keys = [key for key, p in proposed.items() if p.label == label]
        lines.append(f"  {label}: {len(keys)}")
    in_pipeline = sorted(key for key, entry in entries.items() if entry["status"] != "draft"
                         and ("recipe" in entry or (entry["source"]["channel"] or {}).get("endpoint")))
    lines.append(f"  captured or computed now: {', '.join(in_pipeline) or 'none'}")
    lines.append(f"{shown} the rights gate would show on production today"
                 + ("" if gate.problem is None else f" (the register cannot be trusted: {gate.problem})"))
    return "\n".join(lines)


def write_table(entries: dict[str, dict], table: object, path: Path | None = None) -> Path:
    path = path or TABLE_PATH
    path.write_text(render_table(entries, table), encoding="utf-8")
    return path
