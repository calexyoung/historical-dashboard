"""The rights gate: ``permits(rights_used, surface)`` over the rights register (PLAN 6, 6.1, M6;
ADR 0006, ADR 0020).

This is the one piece of code tracks A and B share. Every export, twin and query asks it before
anything leaves the process. The register is one table, ``schema/rights-register.json``; this
module reads it, and ``packages/core/src/rights.ts`` reads a copy generated from it. Both run
``checks/permits-cases.json``.

Vocabulary (CONTEXT.md): a *Surface* is where a build is reachable. Each row of ``rights_used``
names one Origin and Channel a value actually came through and the *Permission* being asked for.
``permission`` is the action requested, never a grant: a caller cannot give itself a right by
writing one here. A grant exists only as a decision Alex has signed on a row of the register.

What the gate does on a public Surface (staging and production; the gate knows nothing of a
password), for every row of the lineage, most restrictive wins:

- the legacy representation is refused, whatever the register says;
- the Origin and dataset need a row, signed, that allows the Permission;
- a Channel other than ``direct`` and Macro Atlas's own (computed, hand entered, fixture) is an
  intermediary: it needs its own row, signed, that allows the Permission, and a dated amendment
  to ADR 0006 named in the table. The origin's row is still needed.

A table that cannot be read or trusted permits nothing on a public Surface.
"""
from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path

SURFACES = ("local", "staging", "production")
PERMISSIONS = ("display", "redistribute", "ml_use")
REPRESENTATIONS = ("native", "legacy_monthly_rounded")
_ROW_FIELDS = ("origin", "dataset", "channel", "representation", "permission")

REGISTER_PATH = Path(__file__).resolve().parents[1] / "schema" / "rights-register.json"
REGISTER_FORMAT = 1
#: The only person whose signature makes a decision (CONTEXT.md, Rights register).
SIGNER = "Alex"
#: What a signed decision says yes or no to. ``store`` is asked by the capture job, not by a page.
GRANTS = ("display", "redistribute", "store", "ml_use")
DIRECT = "direct"
#: Routes that are Macro Atlas's own work and so have no terms of their own. Every other Channel
#: but ``direct`` is an intermediary. This is fixed here, not in the table, so that editing the
#: table cannot turn an intermediary into something else.
OWN_CHANNELS = ("computed", "hand_entered", "fixture")


@dataclass(frozen=True)
class Decision:
    """allow, or deny with a reason. Read ``.allowed``; a Decision has no truth value."""

    allowed: bool
    reason: str | None = None

    def __bool__(self) -> bool:
        raise TypeError("a rights Decision has no truth value; read .allowed")


def _allow() -> Decision:
    return Decision(True)


def _deny(reason: str) -> Decision:
    return Decision(False, reason)


def _row_problem(row: object) -> str | None:
    if not isinstance(row, Mapping):
        return "a rights lineage row is not an object"
    for field in _ROW_FIELDS:
        if not isinstance(row.get(field), str) or not row[field]:
            return f"a rights lineage row has no {field}"
    if row["permission"] not in PERMISSIONS:
        return f"unknown permission {row['permission']!r}"
    if row["representation"] not in REPRESENTATIONS:
        return f"unknown representation {row['representation']!r}"
    return None


def _is_text(value: object) -> bool:
    return isinstance(value, str) and value != ""


def _is_date(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        return date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def _decision_problem(decision: object) -> str | None:
    if decision is None:
        return None
    if not isinstance(decision, Mapping):
        return "its decision is neither null nor an object"
    for grant in GRANTS:
        if not isinstance(decision.get(grant), bool):
            return f"its decision does not say true or false for {grant}"
    if decision.get("signed_by") != SIGNER:
        return f"its decision is not signed by {SIGNER}"
    if not _is_date(decision.get("signed_on")):
        return "its decision has no real signing date"
    return None


def table_problem(table: object) -> str | None:
    """Why ``table`` cannot be trusted as a rights register, or None. The TypeScript twin applies
    the same rules in the same order."""
    if not isinstance(table, Mapping):
        return "it is not a table"
    if isinstance(table.get("format"), bool) or table.get("format") != REGISTER_FORMAT:
        return f"its format is not {REGISTER_FORMAT}"
    if not _is_text(table.get("version")):
        return "it has no version"
    rows = table.get("rows")
    if not isinstance(rows, list):
        return "it has no rows"
    ids: set[str] = set()
    channels: set[str] = set()
    claimed: dict[str, list[object]] = {}
    for row in rows:
        if not isinstance(row, Mapping) or not _is_text(row.get("id")):
            return "a row has no id"
        name = row["id"]
        if name in ids:
            return f"two rows are called {name}"
        ids.add(name)
        if "decision" not in row:
            return f"row {name} has no decision field (null means not decided)"
        problem = _decision_problem(row["decision"])
        if problem:
            return f"row {name}: {problem}"
        if row.get("kind") == "origin":
            origins, datasets = row.get("origins"), row.get("datasets")
            if not isinstance(origins, list) or not origins or not all(map(_is_text, origins)):
                return f"row {name} does not name its origins"
            if datasets != "*" and (
                not isinstance(datasets, list) or not datasets or not all(map(_is_text, datasets))
            ):
                return f'row {name} names neither "*" nor a list of datasets'
            for origin in origins:
                for other in claimed.get(origin, []):
                    if other == "*" or datasets == "*" or set(other) & set(datasets):
                        return f"row {name} overlaps another row for {origin}"
                claimed.setdefault(origin, []).append(datasets)
        elif row.get("kind") == "channel":
            channel = row.get("channel")
            if not _is_text(channel):
                return f"row {name} does not name its channel"
            if channel == DIRECT or channel in OWN_CHANNELS:
                return f"row {name}: the {channel} channel has no terms of its own and takes no row"
            if channel in channels:
                return f"two rows are for the {channel} channel"
            channels.add(channel)
        else:
            return f"row {name} is neither an origin row nor a channel row"
    cleared = table.get("cleared_intermediaries")
    if not isinstance(cleared, list):
        return "it has no list of cleared intermediaries"
    for entry in cleared:
        if not isinstance(entry, Mapping) or not _is_text(entry.get("channel")):
            return "a cleared intermediary does not name its channel"
        if entry["channel"] not in channels:
            return f"the cleared intermediary {entry['channel']} has no row"
        if not _is_date(entry.get("adr_0006_amendment")):
            return f"the cleared intermediary {entry['channel']} does not date its ADR 0006 amendment"
        if entry.get("approved_by") != SIGNER:
            return f"the clearance of {entry['channel']} is not approved by {SIGNER}"
    return None


class RightsGate:
    """The gate over one rights register table. ``permits`` at module level is this, over the
    committed register."""

    def __init__(self, table: object):
        self.problem: str | None = table_problem(table)
        self._rows: list[dict] = []
        self._cleared: frozenset[str] = frozenset()
        if self.problem is None:
            # A private copy: signing a row in the caller's table later opens nothing here.
            self._rows = copy.deepcopy(list(table["rows"]))
            self._cleared = frozenset(e["channel"] for e in table["cleared_intermediaries"])

    def _grant_problem(self, origin: str, dataset: str, channel: str, grant: str) -> str | None:
        """Why the register does not grant ``grant`` for this Origin, dataset and Channel."""
        matches = [
            row
            for row in self._rows
            if row["kind"] == "origin"
            and origin in row["origins"]
            and (row["datasets"] == "*" or dataset in row["datasets"])
        ]
        if not matches:
            return f"{origin} ({dataset}) is not in the rights register"
        for row in matches:
            if row["decision"] is None:
                return f"the rights register row for {origin} ({row['id']}) is not signed"
            if not row["decision"][grant]:
                return f"the rights register row for {origin} ({row['id']}) does not allow {grant}"
        if channel == DIRECT or channel in OWN_CHANNELS:
            return None
        row = next((r for r in self._rows if r["kind"] == "channel" and r["channel"] == channel), None)
        if row is None:
            return f"the {channel} channel is not in the rights register"
        if row["decision"] is None:
            return f"the rights register row for the {channel} channel ({row['id']}) is not signed"
        if not row["decision"][grant]:
            return f"the rights register row for the {channel} channel ({row['id']}) does not allow {grant}"
        if channel not in self._cleared:
            return (
                f"the {channel} channel is an intermediary that no amendment to ADR 0006 has cleared"
            )
        return None

    def permits(self, rights_used: Iterable[Mapping[str, str]], surface: str) -> Decision:
        """May what ``rights_used`` describes be shown or handed out on ``surface``?

        ``rights_used`` must be the complete lineage: one row per Origin and Channel used,
        including every input of a Derived series. Fails closed: anything malformed or unknown is
        a denial, never an exception.
        """
        if surface not in SURFACES:
            return _deny(f"unknown surface {surface!r}: only {', '.join(SURFACES)} exist")
        try:
            rows = list(rights_used)
        except TypeError:
            return _deny("no rights lineage was given")
        if not rows:
            return _deny(
                "no rights lineage was given: nothing is shown without saying where it came from"
            )
        for row in rows:
            problem = _row_problem(row)
            if problem:
                return _deny(problem)
        if surface == "local":
            return _allow()  # not a public Surface (PLAN 6.1, point 3)
        if self.problem is not None:
            return _deny(
                f"the rights register cannot be trusted ({self.problem}), "
                f"so nothing is permitted on the {surface} surface"
            )
        for row in rows:
            if row["representation"] != "native":
                return _deny(
                    f"the legacy representation is never permitted on the {surface} surface"
                )
        for row in rows:
            problem = self._grant_problem(
                row["origin"], row["dataset"], row["channel"], row["permission"]
            )
            if problem:
                return _deny(f"{problem}, so it is not permitted on the {surface} surface")
        return _allow()

    def may_store(self, origin: str, dataset: str, channel: str) -> Decision:
        """May the capture job keep what this Origin serves through this Channel? There is no
        Surface in the question: running on one machine clears nothing (PLAN M7, ADR 0012)."""
        if self.problem is not None:
            return _deny(f"the rights register cannot be trusted ({self.problem})")
        if not all(map(_is_text, (origin, dataset, channel))):
            return _deny("storage was asked about without an origin, a dataset and a channel")
        problem = self._grant_problem(origin, dataset, channel, "store")
        return _deny(problem) if problem else _allow()


def load_register(path: Path | None = None) -> object:
    """The register as written. Raises if the file is missing or is not JSON."""
    return json.loads((path or REGISTER_PATH).read_text(encoding="utf-8"))


def register_identity(path: Path | None = None) -> dict[str, str]:
    """What a Release records of the register it was built against: the table's version and the
    SHA-256 of the file's bytes (ADR 0020)."""
    data = (path or REGISTER_PATH).read_bytes()
    return {"version": json.loads(data)["version"], "sha256": hashlib.sha256(data).hexdigest()}


_committed: RightsGate | None = None


def committed_gate() -> RightsGate:
    """The gate over the committed register. A missing or unreadable file gives a gate that
    permits nothing on a public Surface; it does not raise."""
    global _committed
    if _committed is None:
        try:
            table = load_register()
        except (OSError, ValueError):
            table = None
        _committed = RightsGate(table)
    return _committed


def permits(rights_used: Iterable[Mapping[str, str]], surface: str) -> Decision:
    """``RightsGate.permits`` over the committed rights register."""
    return committed_gate().permits(rights_used, surface)


def _grants_text(grants: Mapping[str, object] | None) -> str:
    if grants is None:
        return "not decided"
    allowed = [grant for grant in GRANTS if grants[grant]]
    return ", ".join(allowed) if allowed else "nothing"


def report(path: Path | None = None) -> tuple[int, str]:
    """``atlas rights``: every row with its proposal and whether Alex has signed it. Returns the
    exit status (1 when the gate cannot trust the table) and the text."""
    path = path or REGISTER_PATH
    try:
        table = load_register(path)
    except (OSError, ValueError) as error:
        return 1, f"the rights register at {path} cannot be read: {error}"
    gate = RightsGate(table)
    if gate.problem is not None:
        return 1, f"the rights register at {path} cannot be trusted: {gate.problem}"
    rows = table["rows"]
    signed = [row for row in rows if row["decision"] is not None]
    lines = [f"Rights register {table['version']} ({path})", ""]
    width = max(len(row["id"]) for row in rows)
    for row in rows:
        lines.append(
            f"  {row['id']:<{width}}  {row['kind']:<7}  {row.get('licence_class', ''):<19}  "
            f"proposed: {_grants_text(row.get('proposal')):<37}  decision: {_grants_text(row['decision'])}"
        )
    cleared = sorted(gate._cleared)
    lines += [
        "",
        (f"{len(signed)} of {len(rows)} rows signed by {SIGNER}. "
        f"Intermediary channels cleared by an ADR 0006 amendment: {', '.join(cleared) or 'none'}."),
    ]
    if not signed:
        lines.append("Until a row is signed, nothing is permitted on staging or production.")
    lines.append("Terms, quotations and how to sign: docs/v2/rights-register.md")
    return 0, "\n".join(lines)
