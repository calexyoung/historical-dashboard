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


def cmd_legacy_release(a) -> int:
    from . import legacy  # v2 (PLAN M2): reads v1's committed output; fetches nothing

    return legacy.main()


def cmd_rights(a) -> int:
    from pathlib import Path

    from . import rights  # v2 (PLAN M6): the rights register; reads one file, fetches nothing

    status, text = rights.report(Path(a.register) if a.register else None)
    print(text, file=sys.stderr if status else sys.stdout)
    return status


def cmd_capture(argv) -> int:
    from .capture.cli import main as capture_main  # v2 (PLAN M7): raw capture; its own options

    return capture_main(argv)


def cmd_replay(argv) -> int:
    from .vintage.cli import main as replay_main  # v2 (PLAN M8): the vintage store; its own options

    return replay_main(argv)


def cmd_publish(argv) -> int:
    from .publish.cli import main as publish_main  # v2 (PLAN M9): the release writer; its own options

    return publish_main(argv)


def cmd_catalog(argv) -> int:
    """v2 (PLAN M12): the Catalog. `check` is the layered validation; v1's data check, which
    this name used to run, is `check --v1` (the Makefile's `check` target, until cutover)."""
    from .catalog import cli as catalog_cli

    name, rest = argv[0], argv[1:]
    return {"check": catalog_cli.check_main, "add": catalog_cli.add_main,
            "catalog": catalog_cli.catalog_main}[name](rest)


PUBLISH_COMMANDS = ("release", "rollback", "pin", "unpin", "save", "withdraw", "doctor")


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    if argv[:1] and argv[0] in PUBLISH_COMMANDS:
        return cmd_publish(argv)
    if argv[:1] and argv[0] in ("add", "catalog") or (argv[:1] == ["check"] and "--v1" not in argv):
        return cmd_catalog(argv)
    if argv[:1] == ["crosscheck"]:
        from .crosscheck import main as crosscheck_main  # v2 (PLAN M14): one source against another

        return crosscheck_main(argv[1:])
    if argv[:1] == ["replay"]:
        return cmd_replay(argv[1:])
    if argv[:1] == ["capture"]:
        # `atlas capture` is `python -m atlas.capture`, which also runs where v1's pipeline
        # is not installed; its options are parsed there.
        return cmd_capture(argv[1:])
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="atlas")
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download source series into data/raw (cached)")
    f.add_argument("--force", action="store_true", help="bypass the cache")
    b = sub.add_parser("build", help="assemble data/atlas.json and render dist/index.html")
    b.add_argument("--force", action="store_true", help="refetch everything")
    b.add_argument("--offline", action="store_true", help="use cached raw files only")
    c = sub.add_parser("check", help="v2: validate the Catalog in layers (see python -m atlas check "
                                     "--help); with --v1, v1's data QA")
    c.add_argument("--v1", action="store_true", help="run v1's data QA on data/atlas.json")
    sub.add_parser("add", help="v2: write a draft file, such as `add series KEY ...`")
    sub.add_parser("catalog", help="v2: what is proposed for every Series; --write the migration table")
    s = sub.add_parser("serve", help="serve dist/")
    s.add_argument("--port", type=int, default=8000)
    sub.add_parser(
        "legacy-release",
        help="v2: convert v1's committed output into a local-profile release under $ATLAS_LOCAL",
    )
    r = sub.add_parser("rights", help="v2: list the rights register, each row's proposal and what is signed")
    r.add_argument("--register", help="another register file to check (default schema/rights-register.json)")
    sub.add_parser("capture", help="v2: fetch rights-cleared agency endpoints and keep the raw bytes "
                                   "(see python -m atlas.capture --help)")
    sub.add_parser("crosscheck", help="v2: compare one source with another (japan-cpi: the IMF's index "
                                      "for Japan against the Statistics Bureau's file)")
    sub.add_parser("replay", help="v2: build the vintage store from kept captures, with their "
                                  "original retrieval times (see python -m atlas replay --help)")
    for name, text in (("release", "write, check and promote a Release from the vintage store"),
                       ("rollback", "name an earlier Release in CURRENT"),
                       ("pin", "keep a Release through retention"), ("unpin", "undo a pin"),
                       ("save", "keep an Explorer view with a Pin and a note (a saved query)"),
                       ("withdraw", "take a Series down and retire the Releases that held it"),
                       ("doctor", "is a release root fit to serve? (--surface production: the preflight)")):
        sub.add_parser(name, help=f"v2: {text} (see python -m atlas {name} --help)")
    a = p.parse_args(argv)
    commands = {"fetch": cmd_fetch, "build": cmd_build, "check": cmd_check, "serve": cmd_serve,
                "legacy-release": cmd_legacy_release, "rights": cmd_rights}
    return commands[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
