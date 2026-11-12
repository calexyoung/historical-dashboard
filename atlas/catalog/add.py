"""`python -m atlas add series`: a draft Series file (PLAN 5, M12).

It writes one file, ``catalog/series/{key}.json``, with ``status: draft``. It fetches nothing,
commits nothing and never overwrites a file. A draft is a declaration only: nothing is captured,
replayed or released for it until an adapter is built and the entry is made active. It cannot
state Rights; it prints what the rights register says of the Origin instead.
"""
from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator

from .load import CATALOG_DIR, SCHEMA_PATH, register_row

REFRESH_OF = {"daily": "daily", "business_daily": "daily", "weekly": "weekly", "monthly": "monthly",
              "quarterly": "quarterly", "annual": "annual", "irregular": "irregular"}


class AddRefused(Exception):
    """The draft was not written."""


def draft(args) -> dict:
    """The entry the options describe, in the schema's own order."""
    entry = {
        "key": args.key, "name": args.name, "description": args.description, "unit": args.unit,
        "unit_kind": args.unit_kind, "measure_kind": args.measure_kind,
        "agg": args.agg or "none", "freq": args.freq, "continuity": args.continuity,
        "seasonal_adjustment": args.seasonal_adjustment, "price_basis": args.price_basis,
        "base_period": args.base_period, "country": args.country, "segment": args.segment,
        "topics": args.topic or None,
        "refresh": args.refresh or REFRESH_OF[args.freq], "max_lag": args.max_lag, "status": "draft",
    }
    if args.recipe:
        if args.producer or args.dataset:
            raise AddRefused("a Derived series names a recipe and no Source: its lineage is its inputs")
        if not args.inputs:
            raise AddRefused("--recipe needs --inputs")
        recipe = {"op": args.recipe, "inputs": list(args.inputs), "order": args.order}
        if args.recipe == "pct_change":
            if args.lag is None:
                raise AddRefused("a pct_change recipe needs --lag, a number of Periods")
            recipe["params"] = {"lag": args.lag}
        entry["recipe"] = recipe
    else:
        if not args.producer or not args.dataset:
            raise AddRefused("a stored Series needs --producer and --dataset (or --recipe and --inputs)")
        origin = {"producer": args.producer, "dataset": args.dataset, "origin_id": args.origin_id,
                  "url": args.url}
        if args.no_channel:
            entry["source"] = {"origin": origin, "channel": None,
                               "no_channel": {"kind": args.no_channel_kind, "reason": args.no_channel}}
        else:
            entry["source"] = {"origin": origin, "channel": {"via": args.via}}
    order = list(json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["properties"])
    return {name: entry[name] for name in order if entry.get(name) is not None}


def add_series(args, table: object, gate) -> tuple[Path, list[str]]:
    """Write the draft and say what the register holds for its Origin. Raises ``AddRefused``."""
    directory = Path(args.catalog) if args.catalog else CATALOG_DIR
    entry = draft(args)
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)
                    .iter_errors(entry), key=lambda e: list(map(str, e.absolute_path)))
    if errors:
        where = "/".join(str(part) for part in errors[0].absolute_path) or "the entry"
        raise AddRefused(f"that is not a Series: {where}: {errors[0].message[:200]}")
    if not directory.is_dir():
        raise AddRefused(f"there is no catalog directory at {directory}")
    path = directory / f"{entry['key']}.json"
    try:
        with open(path, "x", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, indent=2, ensure_ascii=False) + "\n")
    except FileExistsError:
        raise AddRefused(f"{path} already exists; edit it, or choose another key (a key is permanent)") from None
    said = [f"wrote {path} (status: draft; nothing is fetched or published for a draft)"]
    if "source" in entry and entry["source"]["channel"] is not None:
        origin = entry["source"]["origin"]
        row = register_row(table, gate, origin["producer"], origin["dataset"])
        if row is None:
            said.append(f"rights: the register has no row for {origin['producer']}. It needs one, with "
                        "its terms read, before this Series can leave the local Surface.")
        else:
            decided = "signed" if row.get("decision") else "not signed"
            said.append(f"rights: register row {row['id']} ({row['name']}), {row.get('licence_class')}, "
                        f"{decided}. Nothing is typed into the Series: the gate reads that row.")
    said.append("next: python -m atlas check")
    return path, said
