"""The Node step of a release run (PLAN 4.2, 4.4 step 4, M11; ADR 0002, 0003, 0025).

Python never computes a Derived series. It stages the Catalog and the stored Series in a fresh
directory inside the root's staging area, says which Recipes to compute, and runs the one
engine there::

    node packages/core/bin/atlas-core.mjs verify --release {root}/.staging/engine-XXXX --spot checks/spot.json

The step may leave exactly two kinds of file in that directory: ``derived/{key}.json`` for a
key it was asked for, and ``engine-report.json``. ``run`` believes none of it until it has
looked: every file there must be a plain file that was handed in unchanged, or one of those
two; each Derived file must be the bytes the report hashed; each key asked for must be either
written or reported empty. Then the directory is removed, whatever happened. What comes back
is bytes in memory, which the publisher checks against the release contract like any other
file and writes into the Release itself.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from ..release import CATALOG

REPO = Path(__file__).resolve().parents[2]
CLI = REPO / "packages" / "core" / "bin" / "atlas-core.mjs"
SPOT = REPO / "checks" / "spot.json"
REQUEST, REPORT = "engine-request.json", "engine-report.json"
CHECK = "engine: derived series"
#: Seconds the step may take (``ATLAS_ENGINE_TIMEOUT`` overrides it).
TIMEOUT = 300


class EngineError(Exception):
    """The step did not do what it was asked, or what it left cannot be believed."""


@dataclass
class Outcome:
    files: dict[str, bytes] = field(default_factory=dict)      # derived/{key}.json -> bytes
    empty: dict[str, str] = field(default_factory=dict)        # key -> why its Recipe gave no value
    semantics_version: str = ""
    checks: list[dict] = field(default_factory=list)           # the step's own check lines


def node() -> str:
    return os.environ.get("ATLAS_NODE") or shutil.which("node") or "node"


def _timeout() -> float:
    try:
        return float(os.environ.get("ATLAS_ENGINE_TIMEOUT", TIMEOUT))
    except ValueError:
        return TIMEOUT


def run(staging: Path, files: dict[str, bytes], keys: list[str], *, spot: Path | None = None) -> Outcome:
    """Compute the Derived series ``keys`` from the Catalog and stored Series in ``files``.
    ``staging`` is the root's staging area; the work is done in a new directory inside it.
    Raises ``EngineError``; the work directory is gone either way."""
    staging.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="engine-", dir=staging))
    try:
        handed = {path: data for path, data in files.items() if path == CATALOG or path.startswith("series/")}
        handed[REQUEST] = (json.dumps({"format": 1, "materialise": keys}) + "\n").encode()
        for path, data in handed.items():
            target = work / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        command = [node(), str(CLI), "verify", "--release", str(work), "--spot", str(spot or SPOT)]
        try:
            done = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=_timeout(),
                                  check=False, stdin=subprocess.DEVNULL)
        except FileNotFoundError:
            raise EngineError(f"Node is needed to compute Derived series and was not found ({command[0]})") from None
        except subprocess.TimeoutExpired:
            raise EngineError(f"the engine step did not finish in {_timeout():g} seconds") from None
        except OSError as error:
            raise EngineError(f"Node could not be run ({command[0]}): {error}") from None
        if done.returncode != 0:
            said = "; ".join(line.strip() for line in done.stderr.splitlines() if line.strip())[:1500]
            raise EngineError(said or f"the engine step ended with status {done.returncode} and said nothing")
        return _read_back(work, handed, keys)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _read_back(work: Path, handed: dict[str, bytes], keys: list[str]) -> Outcome:
    wanted = {f"derived/{key}.json": key for key in keys}
    left: dict[str, bytes] = {}
    for path in sorted(work.rglob("*")):
        name = path.relative_to(work).as_posix()
        if path.is_symlink():
            raise EngineError(f"the engine step left a link at {name}; nothing is read through a link")
        if path.is_dir():
            if name not in {str(Path(known).parent) for known in (*handed, *wanted)}:
                raise EngineError(f"the engine step left {name}/, which it was not asked for")
            continue
        if not path.is_file() or path.stat().st_nlink != 1:
            raise EngineError(f"the engine step left {name}, which is not a plain file of its own")
        if name in handed:
            if path.read_bytes() != handed[name]:
                raise EngineError(f"the engine step changed {name}, which it was only to read")
        elif name in wanted or name == REPORT:
            left[name] = path.read_bytes()
        else:
            raise EngineError(f"the engine step left {name}, which it was not asked for")
    missing = sorted(set(handed) - {p.relative_to(work).as_posix() for p in work.rglob("*")})
    if missing:
        raise EngineError(f"the engine step removed {missing[0]}, which it was only to read")
    if REPORT not in left:
        raise EngineError("the engine step left no report")
    try:
        report = json.loads(left.pop(REPORT))
        version, described, empty, checks = (report["semantics_version"], report["derived"],
                                             report["empty"], report["checks"])
        if (report.get("format") != 1 or not isinstance(version, str) or not version
                or not isinstance(described, dict) or not isinstance(empty, list) or not isinstance(checks, list)):
            raise ValueError
        outcome = Outcome(semantics_version=version)
        outcome.empty = {row["key"]: str(row["message"]) for row in empty}
        outcome.checks = [{"check": str(c["check"]), "outcome": str(c["outcome"]),
                           **({"detail": str(c["detail"])} if c.get("detail") else {}),
                           **({"reason": str(c["reason"])} if c.get("reason") else {})} for c in checks]
        hashes = {key: row["sha256"] for key, row in described.items()}
    except (ValueError, KeyError, TypeError, AttributeError):
        raise EngineError("the engine step's report cannot be read") from None
    if any(c["outcome"] == "fail" for c in outcome.checks):
        raise EngineError("; ".join(f"{c['check']}: {c.get('detail', '')}" for c in outcome.checks
                                    if c["outcome"] == "fail")[:1500])
    for path, key in wanted.items():
        written, reported_empty = path in left, key in outcome.empty
        if written == reported_empty:
            raise EngineError(f"{key}: the engine step's report says nothing of it" if not written
                              else f"{key}: the engine step wrote it and called it empty")
        if written:
            if hashes.get(key) != hashlib.sha256(left[path]).hexdigest():
                raise EngineError(f"{key}: derived/{key}.json is not the file the report describes")
            outcome.files[path] = left[path]
    return outcome
