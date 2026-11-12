"""Catalog entries for tests: one invented stored Series and one Derived series over it."""
from __future__ import annotations

import json
from pathlib import Path


def stored(key: str = "fx_price", **changes) -> dict:
    entry = {
        "key": key,
        "name": "Fixture price index",
        "unit": "index, 2020 = 100",
        "unit_kind": "index",
        "measure_kind": "index",
        "freq": "monthly",
        "continuity": "discrete",
        "agg": "mean",
        "seasonal_adjustment": "nsa",
        "price_basis": "not_applicable",
        "country": "USA",
        "segment": "economy_jobs",
        "refresh": "monthly",
        "status": "draft",
        "source": {
            "origin": {"producer": "Macro Atlas fixture (synthetic)", "dataset": "Fixture prices",
                       "origin_id": "FXPRICE", "url": None},
            "channel": {"via": "direct"},
        },
    }
    entry.update(changes)
    return {name: value for name, value in entry.items() if value is not ...}


def derived(key: str = "fx_price_yoy", inputs: tuple[str, ...] = ("fx_price",), **changes) -> dict:
    entry = stored(key, name="Fixture price index, change from a year earlier",
                   unit="percent change from a year earlier", unit_kind="percent",
                   measure_kind="rate", agg="none", source=...,
                   recipe={"op": "pct_change", "inputs": list(inputs),
                           "order": "aggregate_then_compute", "params": {"lag": 12}})
    entry.update(changes)
    return {name: value for name, value in entry.items() if value is not ...}


def write(directory: Path, *entries: dict) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        (directory / f"{entry['key']}.json").write_text(json.dumps(entry, indent=2) + "\n")
    return directory
