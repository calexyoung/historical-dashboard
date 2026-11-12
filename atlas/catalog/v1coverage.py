"""The v1 coverage report (PLAN M16): every series v1 showed, accounted for as one of three.

- **live from origin**: the pipeline reads it from the organisation that produces it (a direct
  Channel, or a hand-entered file read through the capture kit), or computes it only from
  Series that are.
- **live via a cleared channel**: it is read through an intermediary Channel that Alex cleared
  by a signed register row and a dated amendment to ADR 0006 (PLAN 6.1, point 4). Today there
  is no such Channel and so no such Series.
- **withheld**, with the reason: everything else. The Series stays in the Catalog by name.

"Live" says what the pipeline reads, from the Catalog and the register's endpoint lists. It is
not a statement about a public Surface: what may be shown there is the rights gate's answer,
from signed rows, and the page says what that answer is today.

Worked out here from the Catalog and the register and typed nowhere, like the migration table
beside it (``table.py``). ``python -m atlas catalog --write`` writes ``docs/v2/v1-coverage.md``.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..rights import DIRECT, OWN_CHANNELS, RightsGate
from .load import ROOT, leaves, register_row
from .table import NO_CHANNEL_WORDS, SEGMENTS, _cell, gate_shows

COVERAGE_PATH = ROOT / "docs" / "v2" / "v1-coverage.md"
CLASSES = ("live from origin", "live via a cleared channel", "withheld")
_RANK = {name: n for n, name in enumerate(CLASSES)}
RELATIONS = {"same": "the same figure", "representation": "the same quantity in another representation",
             "different": "a different quantity from v1's"}


@dataclass(frozen=True)
class Row:
    key: str
    klass: str
    reads: str | None  # where a live Series is read from
    reason: str | None  # why a withheld one is withheld
    relation: str | None = None  # how the figure relates to v1's


def _cleared(table: object, gate: RightsGate) -> set[str]:
    return {e["channel"] for e in table["cleared_intermediaries"]} if gate.problem is None else set()


def _stored(entry: dict, table: object, gate: RightsGate) -> tuple[str, str]:
    """(class, where it is read from or why it is withheld) for a stored Series."""
    source = entry["source"]
    origin, channel = source["origin"], source["channel"]
    planned = entry.get("migration", {}).get("milestone")
    if channel is None:
        said = source["no_channel"]
        return CLASSES[2], f"{NO_CHANNEL_WORDS[said['kind']]}: {said['reason']}"
    via = channel["via"]
    intermediary = via != DIRECT and via not in OWN_CHANNELS
    if intermediary and via not in _cleared(table, gate):
        return CLASSES[2], (f"{via} is an intermediary Channel that is not cleared (no signed row with an "
                            "amendment to ADR 0006): nothing is fetched through it")
    row = register_row(table, gate, origin["producer"], origin["dataset"])
    if entry["status"] != "draft" and channel.get("endpoint"):
        where = f"{origin['producer']}: {origin['dataset']}"
        if origin["origin_id"]:
            where += f" (`{origin['origin_id']}`)"
        if intermediary:
            return CLASSES[1], f"{where}, through {via}"
        return CLASSES[0], where + (", entered by hand with a citation for each value" if via == "hand_entered" else "")
    if row is None:
        return CLASSES[2], (f"the rights register has no row for {origin['producer']}, so its terms are not "
                            "read and nothing is proposed; no reader is built for it")
    if (row.get("proposal") or {}).get("display") is not True:
        unread = " (its terms are not read)" if row.get("licence_class") == "unknown" else ""
        return CLASSES[2], f"the register proposes no display for {row['name']}{unread}"
    if via == "hand_entered":
        return CLASSES[2], (f"its values are entered by hand from the record of {origin['producer']}, and "
                            "none is entered until Alex has decided that row of the register (the reader of "
                            "hand-entered files exists)")
    return CLASSES[2], ("no reader is built for it yet" + (f" (planned for {planned})" if planned else "")
                        + f"; it is published by {origin['producer']}")


def account(entries: dict[str, dict], table: object) -> dict[str, Row]:
    """Every Series carried over from v1 (an entry with ``migration``), each in one class."""
    gate = RightsGate(table)
    out: dict[str, Row] = {}
    for key in sorted(entries):
        entry = entries[key]
        if "migration" not in entry:
            continue
        relation = RELATIONS.get(entry["migration"].get("change"))
        if "recipe" not in entry:
            klass, said = _stored(entry, table, gate)
        else:
            below = {name: _stored(entries[name], table, gate) for name in leaves(key, entries)}
            worst = max((_RANK[k] for k, _ in below.values()), default=2)
            inputs = ", ".join(f"`{name}`" for name in entry["recipe"]["inputs"])
            if not below:
                klass, said = CLASSES[2], "its recipe reaches no stored Series"
            elif worst == 2:
                name = next(n for n, (k, _) in below.items() if k == CLASSES[2])
                klass, said = CLASSES[2], f"it is computed from `{name}`, which is withheld: {below[name][1]}"
            elif entry["status"] == "draft":
                klass, said = CLASSES[2], f"it is computed from {inputs} and is not computed yet (a draft)"
            else:
                klass, said = CLASSES[worst], f"computed from {inputs}"
        live = klass != CLASSES[2]
        out[key] = Row(key, klass, said if live else None, None if live else said, relation)
    return out


def render_v1_coverage(entries: dict[str, dict], table: object) -> str:
    """docs/v2/v1-coverage.md, from the Catalog and the register."""
    gate = RightsGate(table)
    rows = account(entries, table)
    counts = {name: sum(row.klass == name for row in rows.values()) for name in CLASSES}
    live = [key for key, row in rows.items() if row.klass != CLASSES[2]]
    shown = sum(gate_shows(entries[key], entries, gate) for key in live)
    cleared = sorted(_cleared(table, gate))
    lines = [
        "# v1 coverage: what became of each of v1's series",
        "",
        "<!-- GENERATED by `python -m atlas catalog --write` from catalog/series and",
        "     schema/rights-register.json. Do not edit: change a Series file or the register. -->",
        "",
        f"v1 showed {len(rows)} series. This page accounts for every one of them (PLAN M16) as one of three:",
        "",
        "| Class | v1 series | Meaning |",
        "|---|---|---|",
        (f"| live from origin | {counts[CLASSES[0]]} | The pipeline reads it from the organisation that produces "
         "it, by an adapter with a captured-fixture test, or computes it only from Series that are. |"),
        (f"| live via a cleared channel | {counts[CLASSES[1]]} | It is read through an intermediary Channel "
         "(FRED, Yahoo) that Alex has cleared by a signed register row and a dated amendment to ADR 0006. "
         f"Cleared today: {', '.join(cleared) or 'none'}, so no adapter for one was built. |"),
        (f"| withheld | {counts[CLASSES[2]]} | Everything else, each with its reason. It stays in the Catalog by "
         "name and is listed as withheld wherever Series are listed. |"),
        "",
        "**What \"live\" means here.** It says what the pipeline reads and from whom: capture, the vintage",
        "store and the release writer run for these Series, and v1's own copy of them (which came through",
        "FRED and Yahoo) is not what is read. It is not a statement about a public Surface. A public",
        "Release holds a Series only when the rights register row it rests on is signed, and no builder",
        f"signs one. The rights gate would show {shown} of them on production today.",
        "",
        "Whether each live Series says what v1 said is the comparison in `docs/v2/v1-overlap.md`, which",
        "holds counts and differences and no agency's figures. What is proposed for each Series, and",
        "what is still open on its register row, is `docs/v2/catalog-migration.md`.",
        "",
    ]
    for klass in CLASSES[:2]:
        keys = [key for key, row in rows.items() if row.klass == klass]
        lines += [f"## {klass.capitalize()} ({len(keys)})", ""]
        if not keys:
            lines += ["None. No intermediary Channel is cleared (D2 is open), and v2 does not fetch from FRED or",
                      "Yahoo (PLAN 6.1, point 7).", ""]
            continue
        lines += ["| Key | Name | v1 took it from | Read from | The figure, beside v1's |", "|---|---|---|---|---|"]
        for key in keys:
            entry, row = entries[key], rows[key]
            lines.append(f"| `{key}` | {_cell(entry['name'])} | {_cell(entry['migration']['v1_source'])} "
                         f"| {_cell(row.reads)} | {row.relation or '—'} |")
        lines.append("")
    keys = [key for key, row in rows.items() if row.klass == CLASSES[2]]
    lines += [f"## Withheld ({len(keys)})", ""]
    for segment, title in SEGMENTS.items():
        of_segment = [key for key in keys if entries[key]["segment"] == segment]
        if not of_segment:
            continue
        lines += [f"### {title}", "", "| Key | Name | v1 took it from | Why it is withheld |", "|---|---|---|---|"]
        for key in of_segment:
            entry = entries[key]
            lines.append(f"| `{key}` | {_cell(entry['name'])} | {_cell(entry['migration']['v1_source'])} "
                         f"| {_cell(rows[key].reason)} |")
        lines.append("")
    return "\n".join(lines)


def write_v1_coverage(entries: dict[str, dict], table: object, path: Path | None = None) -> Path:
    path = path or COVERAGE_PATH
    path.write_text(render_v1_coverage(entries, table), encoding="utf-8")
    return path
