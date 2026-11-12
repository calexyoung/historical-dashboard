"""The release writer's commands (PLAN M9):

    python -m atlas release --profile local          write and promote a Release into $ATLAS_LOCAL
    python -m atlas release --profile public         ... into $ATLAS_PUBLIC, from the rights allowlist
    python -m atlas release --profile P --reuse-data a content-only Release on the current data
    python -m atlas rollback ID --profile P          name an earlier Release in CURRENT
    python -m atlas pin ID --profile P --reason WHY  keep a Release through retention
    python -m atlas unpin ID --profile P
    python -m atlas save ADDRESS --profile local --note WHY   keep an Explorer view, pinned
    python -m atlas save --list | --remove ID --profile local
    python -m atlas withdraw KEY --profile P --reason WHY
                                                     take a Series down and retire what held it
    python -m atlas doctor                           the health of the roots and the store
    python -m atlas doctor --surface production      the preflight before a production deploy

A release run fetches nothing. The order of a refresh is ``atlas capture``, ``atlas replay``,
``atlas release``. Exit status 0 means the command did what it says; 1 means it was refused,
rejected or failed, and CURRENT is as it was (or, for a withdrawal that could write no
replacement, removed).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import pin, release, rollback, save, unpin, unsave, withdraw
from . import root as R
from .doctor import SURFACES, doctor

COMMANDS = ("release", "rollback", "pin", "unpin", "save", "withdraw", "doctor")


def _common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--profile", required=True, choices=("public", "local"),
                        help="which kind of Release, and so which root")
    parser.add_argument("--out", help="the release root (default $ATLAS_PUBLIC or $ATLAS_LOCAL, "
                                      "else var/public or var/local)")
    parser.add_argument("--store", help="the store (default $ATLAS_STORE, else var/store)")
    parser.add_argument("--register", help="a rights register file (default schema/rights-register.json). "
                                           "A Release decided by another file never goes into "
                                           "$ATLAS_PUBLIC or $ATLAS_LOCAL")


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    parser = argparse.ArgumentParser(prog="atlas", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("release", help="write, check and promote a Release from the vintage store")
    _common(p)
    p.add_argument("--series", help="a catalog directory or a series table file (default catalog/series)")
    p.add_argument("--reuse-data", action="store_true",
                   help="keep the current Release's data files (hard links); rewrite only its content")
    p.add_argument("--no-legacy", action="store_true",
                   help="local profile: do not add v1's legacy Series")
    for name, what in (("rollback", "name an earlier Release of the root in CURRENT"),
                       ("pin", "keep a Release through retention"), ("unpin", "let retention take it")):
        p = sub.add_parser(name, help=what)
        p.add_argument("release_id")
        _common(p)
        if name == "pin":
            p.add_argument("--reason", required=True, help="what names this Release")
    p = sub.add_parser("save", help="keep an Explorer view with a Pin and a note (a saved query); local root only")
    p.add_argument("address", nargs="?", help="the link the Explorer's \"Copy link\" gives, or its query string")
    _common(p)
    p.add_argument("--note", help="what the view is for: one line")
    p.add_argument("--list", action="store_true", help="list the root's saved queries")
    p.add_argument("--remove", metavar="ID", help="remove a saved query; its Release is then kept only if something else names it")
    p = sub.add_parser("withdraw", help="take a Series down and retire the Releases that held it")
    p.add_argument("key")
    _common(p)
    p.add_argument("--reason", required=True)
    p = sub.add_parser("doctor", help="is a release root fit to serve?")
    p.add_argument("--surface", choices=SURFACES,
                   help="production or staging: the preflight, against the committed rights register")
    p.add_argument("--root", help="the root to look at (default $ATLAS_PUBLIC for the preflight)")
    p.add_argument("--store", help="the store (default $ATLAS_STORE, else var/store)")
    args = parser.parse_args(argv)

    if args.command == "doctor":
        status, lines = doctor(surface=args.surface, root=Path(args.root) if args.root else None,
                               store=Path(args.store) if args.store else None)
        print("\n".join(lines))
        return status
    common = {"profile": args.profile,
              "root": Path(args.out) if args.out else R.home(args.profile),
              "store": Path(args.store) if args.store else R.home("store"),
              "register": Path(args.register) if args.register else None}
    if args.command == "release":
        if args.no_legacy and args.profile == "public":
            parser.error("--no-legacy goes with --profile local: a public release never holds v1's Series")
        result = release(series=Path(args.series) if args.series else None, reuse_data=args.reuse_data,
                         legacy=False if args.no_legacy else None, **common)
    elif args.command == "rollback":
        result = rollback(release_id=args.release_id, **common)
    elif args.command == "pin":
        result = pin(release_id=args.release_id, reason=args.reason, **common)
    elif args.command == "unpin":
        result = unpin(release_id=args.release_id, **common)
    elif args.command == "save":
        if args.list:
            entries = R.saved(common["root"])
            for entry in entries:
                print(f"{entry.get('id')}  {entry.get('saved_at')}  {entry.get('release_id')}\n  {entry.get('note')}\n  /explore?{entry.get('query')}")
            print(f"{len(entries)} saved {'query' if len(entries) == 1 else 'queries'} in {common['root']}")
            return 0
        if args.remove:
            result = unsave(saved_id=args.remove, **common)
        elif not args.address or not args.note:
            parser.error("save needs an address and --note (or --list, or --remove ID)")
        else:
            result = save(address=args.address, note=args.note, **common)
    else:
        result = withdraw(key=args.key, reason=args.reason, **common)
    print("\n".join(result.lines))
    if result.outcome == "promoted":
        print(f"  {common['root'] / 'releases' / result.release_id}")
        if args.profile == "local":
            print("  Local profile: not for publication.")
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
