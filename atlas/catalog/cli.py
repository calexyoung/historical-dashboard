"""`atlas check`, `atlas add series` and `atlas catalog` (PLAN 5, M12)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..content import add as X
from ..rights import RightsGate, load_register
from . import add as A
from . import check as C
from . import coverage as G
from . import table as T
from . import v1coverage as V
from .load import CatalogError, load_catalog

FREQUENCIES = ("daily", "business_daily", "weekly", "monthly", "quarterly", "annual", "irregular")


def check_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="atlas check",
        description="Validate the Catalog in layers (schema, references, semantics, rights) and then "
                    "Macro Atlas's own content (Events and notes). Reads files only. Exits 1 if any "
                    "layer finds something.")
    parser.add_argument("--catalog", help="a catalog directory (default catalog/series)")
    parser.add_argument("--register", help="a rights register (default schema/rights-register.json)")
    parser.add_argument("--content", help="the content directory, which holds events/ (default content)")
    parser.add_argument("--notes", help="the directory of User notes (default notes)")
    args = parser.parse_args(argv)
    report = C.check(Path(args.catalog) if args.catalog else None,
                     Path(args.register) if args.register else None,
                     Path(args.content) if args.content else None,
                     Path(args.notes) if args.notes else None)
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
    e = kinds.add_parser("event", help="a draft Event in content/events/{date}-{slug}.md")
    e.add_argument("date", help="the day (YYYY-MM-DD), month (YYYY-MM) or year (YYYY) it happened or began")
    e.add_argument("title", help="what happened, in a few plain words")
    e.add_argument("--category", required=True, choices=list(X.CATEGORIES))
    e.add_argument("--end", help="the last day, month or year of an Event that spans time")
    e.add_argument("--source", required=True, help="the address where it can be checked (https)")
    e.add_argument("--archive-url", help="an archived copy of that address")
    e.add_argument("--no-archive", metavar="REASON", help="why there is no archived copy")
    e.add_argument("--topic", action="append", help="a topic slug; may be given more than once")
    e.add_argument("--series", action="append", help="a Series key to show beside it; may be given more than once")
    e.add_argument("--description", help="what happened and when, from the cited source")
    e.add_argument("--content", help="the content directory (default content)")
    n = kinds.add_parser("note", help="one user's own draft note in notes/{user}/{date}-{slug}.md")
    n.add_argument("text", help="the remark")
    n.add_argument("--user", required=True, help="whose note it is: a short name in lower case")
    n.add_argument("--about", required=True, metavar="KIND:ID", help="claim:ID, series:KEY or topic:SLUG")
    n.add_argument("--date", help="the day it was written (default today)")
    n.add_argument("--notes", help="the directory of User notes (default notes)")
    if argv[:1] and argv[0] in ("event", "note"):
        args = parser.parse_args(argv)   # a mistake in the options exits, as argparse does
        try:
            if args.kind == "event":
                _, said = X.add_event(args, set(load_catalog()))
            else:
                _, said = X.add_note(args, set(load_catalog()))
        except (X.AddRefused, CatalogError) as refused:
            print(f"atlas add: {refused}", file=sys.stderr)
            return 1
        print("\n".join(said))
        return 0
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
                    "--write regenerates docs/v2/catalog-migration.md, docs/v2/v1-coverage.md and "
                    "docs/v2/g20-coverage.md.")
    parser.add_argument("--write", action="store_true",
                        help="write the three generated pages under docs/v2")
    parser.add_argument("--check", action="store_true", help="exit 1 if a generated page is out of date")
    parser.add_argument("--list", action="store_true", help="one line per Series")
    args = parser.parse_args(argv)
    try:
        entries = load_catalog()
    except CatalogError as error:
        print(f"atlas catalog: {error}", file=sys.stderr)
        return 1
    table = load_register()
    try:
        g20 = G.load_coverage().get("g20")
    except CatalogError as error:
        print(f"atlas catalog: {error}", file=sys.stderr)
        return 1
    if args.write:
        print(f"wrote {T.write_table(entries, table)}")
        print(f"wrote {V.write_v1_coverage(entries, table)}")
        if g20:
            print(f"wrote {G.write_coverage(entries, table, g20)}")
    if args.check:
        pages = [(T.TABLE_PATH, T.render_table(entries, table)),
                 (V.COVERAGE_PATH, V.render_v1_coverage(entries, table))]
        if g20:
            pages.append((G.COVERAGE_PAGE, G.render_coverage(entries, table, g20)))
        for path, text in pages:
            if (path.read_text(encoding="utf-8") if path.exists() else "") != text:
                print(f"{path} is out of date: run python -m atlas catalog --write", file=sys.stderr)
                return 1
    if args.list:
        gate = RightsGate(table)
        for key, entry in entries.items():
            p = T.proposal(entry, entries, table, gate)
            shown = "gate: shown" if T.gate_shows(entry, entries, gate) else "gate: not shown"
            print(f"{key:14} {entry['status']:8} {p.text}  [{shown}]")
    print(T.summary(entries, table))
    return 0
