"""`atlas check`, `atlas add series` and `atlas catalog` (PLAN 5, M12)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..rights import RightsGate, load_register
from . import add as A
from . import check as C
from . import table as T
from .load import CatalogError, load_catalog

FREQUENCIES = ("daily", "business_daily", "weekly", "monthly", "quarterly", "annual", "irregular")


def check_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="atlas check",
        description="Validate the Catalog in layers: schema, references, semantics, rights. "
                    "Reads files only. Exits 1 if any layer finds something.")
    parser.add_argument("--catalog", help="a catalog directory (default catalog/series)")
    parser.add_argument("--register", help="a rights register (default schema/rights-register.json)")
    args = parser.parse_args(argv)
    report = C.check(Path(args.catalog) if args.catalog else None,
                     Path(args.register) if args.register else None)
    print(C.render(report))
    return 0 if report.ok else 1


def add_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="atlas add", description="Write a draft file. Never commits, never fetches.")
    kinds = parser.add_subparsers(dest="kind", required=True)
    p = kinds.add_parser("series", help="a draft Series in catalog/series/{key}.json")
    p.add_argument("key")
    for name in ("name", "unit"):
        p.add_argument(f"--{name}", required=True)
    p.add_argument("--unit-kind", required=True, choices=["percent", "percentage_points", "index",
                                                           "currency", "count", "ratio", "physical", "other"])
    p.add_argument("--measure-kind", required=True, choices=["stock", "flow", "rate", "index", "annualized"])
    p.add_argument("--freq", required=True, choices=FREQUENCIES)
    p.add_argument("--agg", choices=["mean", "last", "sum", "none"],
                   help="how finer Periods combine (default none: never combined)")
    p.add_argument("--continuity", default="discrete", choices=["discrete", "held"])
    p.add_argument("--seasonal-adjustment", required=True, choices=["sa", "nsa", "saar", "not_applicable"])
    p.add_argument("--price-basis", required=True, choices=["nominal", "real", "not_applicable"])
    p.add_argument("--country", required=True, help="ISO 3166-1 alpha-3, or EA, EU, G20, WLD")
    p.add_argument("--segment", required=True, choices=list(T.SEGMENTS))
    p.add_argument("--topic", action="append", help="a topic slug; may be given more than once")
    p.add_argument("--description")
    p.add_argument("--base-period")
    p.add_argument("--refresh", choices=["daily", "weekly", "monthly", "quarterly", "annual", "irregular", "none"])
    p.add_argument("--max-lag", help="such as P3M")
    p.add_argument("--producer", help="the Origin: the organisation that produces it")
    p.add_argument("--dataset")
    p.add_argument("--origin-id")
    p.add_argument("--url")
    p.add_argument("--via", default="direct", help="the Channel proposed (default direct)")
    p.add_argument("--no-channel", metavar="REASON", help="there is no publishable route, and why")
    p.add_argument("--no-channel-kind", default="no_route_established",
                   choices=["rights_restriction", "no_route_established", "discontinued"])
    p.add_argument("--recipe", choices=["ratio", "difference", "sum", "product", "pct_change"],
                   help="a Derived series: the operation")
    p.add_argument("--inputs", nargs="+", help="the Recipe's inputs, in order")
    p.add_argument("--order", default="aggregate_then_compute",
                   choices=["aggregate_then_compute", "compute_then_aggregate"])
    p.add_argument("--lag", type=int)
    p.add_argument("--catalog", help="a catalog directory (default catalog/series)")
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:
        return int(stop.code or 0)
    table = load_register()
    try:
        _, said = A.add_series(args, table, RightsGate(table))
    except A.AddRefused as refused:
        print(f"atlas add: {refused}", file=sys.stderr)
        return 1
    print("\n".join(said))
    return 0


def catalog_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="atlas catalog",
        description="What is proposed for every Series, and what the rights gate would show today. "
                    "--write regenerates docs/v2/catalog-migration.md.")
    parser.add_argument("--write", action="store_true", help="write docs/v2/catalog-migration.md")
    parser.add_argument("--check", action="store_true", help="exit 1 if that file is out of date")
    parser.add_argument("--list", action="store_true", help="one line per Series")
    args = parser.parse_args(argv)
    try:
        entries = load_catalog()
    except CatalogError as error:
        print(f"atlas catalog: {error}", file=sys.stderr)
        return 1
    table = load_register()
    if args.write:
        print(f"wrote {T.write_table(entries, table)}")
    if args.check:
        current = T.TABLE_PATH.read_text(encoding="utf-8") if T.TABLE_PATH.exists() else ""
        if current != T.render_table(entries, table):
            print(f"{T.TABLE_PATH} is out of date: run python -m atlas catalog --write", file=sys.stderr)
            return 1
    if args.list:
        gate = RightsGate(table)
        for key, entry in entries.items():
            p = T.proposal(entry, entries, table, gate)
            shown = "gate: shown" if T.gate_shows(entry, entries, gate) else "gate: not shown"
            print(f"{key:14} {entry['status']:8} {p.text}  [{shown}]")
    print(T.summary(entries, table))
    return 0
