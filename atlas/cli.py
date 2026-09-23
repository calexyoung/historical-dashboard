"""`python -m atlas fetch|build|check|serve`."""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import logging
import sys

from . import build as B
from .check import run_checks


def cmd_fetch(a) -> int:
    catalog = B.load_catalog()
    raw, failures, _ = B.fetch_all(catalog, force=a.force, use_seed=False)
    print(f"Fetched {len(raw)}/{len(catalog)} source series into data/raw/")
    for k, why in sorted(failures.items()):
        print(f"  FAILED {k}: {why}")
    return 0  # fail soft


def cmd_build(a) -> int:
    B.build(force=a.force, cache_only=a.offline)
    return 0


def cmd_check(a) -> int:
    if not B.DATA_JSON.exists():
        print("data/atlas.json missing — run `python -m atlas build` first")
        return 1
    data = B.with_politics(B.with_approval(json.loads(B.DATA_JSON.read_text()), B.load_approval()), B.load_politics())
    errors, warnings = run_checks(data, B.load_catalog(), B.load_events())
    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print(f"check: {len(errors)} errors, {len(warnings)} warnings, {len(data['series'])} series")
    return 1 if errors else 0


def cmd_serve(a) -> int:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(B.DIST.parent))
    print(f"Serving dist/ at http://localhost:{a.port}")
    http.server.ThreadingHTTPServer(("", a.port), handler).serve_forever()
    return 0


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="atlas")
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download source series into data/raw (cached)")
    f.add_argument("--force", action="store_true", help="bypass the cache")
    b = sub.add_parser("build", help="assemble data/atlas.json and render dist/index.html")
    b.add_argument("--force", action="store_true", help="refetch everything")
    b.add_argument("--offline", action="store_true", help="use cached raw files only")
    sub.add_parser("check", help="data QA")
    s = sub.add_parser("serve", help="serve dist/")
    s.add_argument("--port", type=int, default=8000)
    a = p.parse_args(argv)
    return {"fetch": cmd_fetch, "build": cmd_build, "check": cmd_check, "serve": cmd_serve}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
