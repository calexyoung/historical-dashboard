"""The rights gate contract: ``permits(rights_used, surface)`` (PLAN 4.2 and 6.1, ADR 0006).

This is the one piece of code tracks A and B share. Every export, twin and query asks it before
anything leaves the process. M0 ships the contract with its default body: allow on the local
surface, deny on every other. M6 replaces the body with the rights register table, behind the same
signature. The TypeScript twin is ``packages/core/src/rights.ts``; both run
``checks/permits-cases.json``.

Vocabulary (CONTEXT.md): a *Surface* is where a build is reachable. Each row of ``rights_used``
names one Origin and Channel a value actually came through and the *Permission* being asked for.
``permission`` is the action requested, never a grant: a caller cannot give itself a right by
writing one here.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Optional

SURFACES = ("local", "staging", "production")
PERMISSIONS = ("display", "redistribute", "ml_use")
REPRESENTATIONS = ("native", "legacy_monthly_rounded")
_ROW_FIELDS = ("origin", "dataset", "channel", "representation", "permission")


@dataclass(frozen=True)
class Decision:
    """allow, or deny with a reason. Read ``.allowed``; a Decision has no truth value."""

    allowed: bool
    reason: Optional[str] = None

    def __bool__(self) -> bool:
        raise TypeError("a rights Decision has no truth value; read .allowed")


def _allow() -> Decision:
    return Decision(True)


def _deny(reason: str) -> Decision:
    return Decision(False, reason)


def _row_problem(row: object) -> Optional[str]:
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


def permits(rights_used: Iterable[Mapping[str, str]], surface: str) -> Decision:
    """May what ``rights_used`` describes be shown or handed out on ``surface``?

    ``rights_used`` must be the complete lineage: one row per Origin and Channel used, including
    every input of a Derived series. Fails closed: anything malformed or unknown is a denial,
    never an exception.
    """
    if surface not in SURFACES:
        return _deny(f"unknown surface {surface!r}: only {', '.join(SURFACES)} exist")
    try:
        rows = list(rights_used)
    except TypeError:
        return _deny("no rights lineage was given")
    if not rows:
        return _deny("no rights lineage was given: nothing is shown without saying where it came from")
    for row in rows:
        problem = _row_problem(row)
        if problem:
            return _deny(problem)
    # Default body (M0). M6 replaces everything below with the rights register table.
    if surface == "local":
        return _allow()
    return _deny(
        f"the rights register is not in force yet, so nothing is permitted on the {surface} surface"
    )
