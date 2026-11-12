"""Shared pieces for the release writer's tests (PLAN M9): a vintage store built from M8's
three-fetch fixture by the real capture kit and replay, and the register it is released under.

Every value is invented and the one Origin is made up. A decision in a register here is test
data: nothing in these tests says what Alex has decided for any source."""
from __future__ import annotations

import copy
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path

from atlas.capture.cli import main as capture_main
from atlas.vintage.cli import main as replay_main

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "vintage"
THREE = FIXTURE / "three-fetch"
SERIES = FIXTURE / "series.json"
FETCHES = ("1-initial", "2-revision", "3-withdrawal")
#: A day after the fixture's last fetch (2026-05-12).
NOW = datetime(2026, 5, 13, 15, 7, 11, tzinfo=UTC)
ORIGIN = "Macro Atlas fixture (synthetic)"


def _fixture_module():
    spec = importlib.util.spec_from_file_location("make_vintage_fixtures", FIXTURE / "make_fixtures.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MAKE = _fixture_module()


def write_register(path: Path, table: dict | None = None) -> Path:
    path.write_text(json.dumps(table if table is not None else MAKE.register()))
    return path


def fixture_table(**changes) -> dict:
    """The fixture's register with its one row changed: ``decision=None`` unsigns it,
    ``datasets=[...]`` narrows it."""
    table = copy.deepcopy(MAKE.register())
    table["rows"][0].update(changes)
    return table


def build_store(store: Path, register: Path, *fetches: str, series: Path = SERIES) -> Path:
    """Capture the named fixture fetches and replay them into the vintage store."""
    for name in fetches or FETCHES:
        assert capture_main(["--store", str(store), "--register", str(register),
                             "--replay", str(THREE / name)]) == 0
    assert replay_main(["--store", str(store), "--register", str(register),
                        "--series", str(series)]) == 0
    return store


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def current(root: Path) -> str | None:
    try:
        return (Path(root) / "CURRENT").read_text().strip()
    except FileNotFoundError:
        return None


def all_bytes(directory: Path) -> bytes:
    """Every byte of every file under a directory, with the file names, for grep tests."""
    return b"\n".join(path.relative_to(directory).as_posix().encode() + b"\n" + path.read_bytes()
                      for path in sorted(Path(directory).rglob("*")) if path.is_file())


RECIPES = FIXTURE / "recipes.json"


def series_with_recipes(path: Path, derived: list[dict] | None = None, drop: tuple[str, ...] = ()) -> Path:
    """The fixture's series table with a ``derived`` list: the committed two recipes
    (fixtures/vintage/recipes.json) unless others are given."""
    table = read_json(SERIES)
    table["derived"] = [entry for entry in (derived if derived is not None else read_json(RECIPES)["derived"])
                        if entry["key"] not in drop]
    path.write_text(json.dumps(table))
    return path
