"""``atlas claims compute | relock | list`` (PLAN 4.5 and M20; ADR 0011, ADR 0034).

    python -m atlas claims compute ID --profile local     compute a Claim's evidence and freeze it (v1)
    python -m atlas claims relock ID --profile local --reason WHY
                                                          record it afresh: a new version beside the old
    python -m atlas claims list --profile local           every Claim, its status and its locks

``compute`` reads the Claim's file, has the engine compute each Reading's *then* and *now
when checked* rows on the root's current Release (``atlas-core claim``; Python computes no
figure), and writes a Claim lock. It never overwrites one: a Claim that has a lock is recorded
afresh with ``relock``, which needs a reason and leaves every earlier version as it was.

Where the lock goes follows the Profile, and so does what is asked:

``--profile public``
    ``content/claims/locks/`` in the repository, for a person to commit. A lock there is a
    file of values, so the rights gate must permit display and redistribution, on production,
    of everything the numbers came through. No row of the register is signed today, so no
    real lock can be written here yet.
``--profile local``
    ``{local root}/locks/``, which is git-ignored with the root and never committed. No
    signature is asked: this is how a Claim is tried before any row is signed.

Either way the Release the numbers came from is pinned, so retention keeps it. A Claim on a
Series held in v1's legacy representation is refused, whatever the Profile.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from ..content import claims as K
from ..content.compile import CONTENT_DIR
from ..release import CATALOG, LEGACY, MANIFEST
from . import engine
from . import root as R
from .run import Result, _guarded, _opened, _Refusal


def _locks_dir(profile: str, root: Path, content: Path) -> Path:
    return content / "claims" / K.LOCKS if profile == "public" else Path(root) / R.LOCKS


def _write_new(path: Path, data: bytes) -> None:
    """Write a lock whole or not at all, and never over another: the bytes go to a temporary
    file beside it, which is then linked to the lock's name. A link to a name that exists
    fails; a run killed half way leaves no file of that name."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".lock-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            raise _Refusal(f"{path} already exists: a lock is never overwritten") from None
    finally:
        with contextlib.suppress(OSError):
            os.unlink(temporary)


def _lock(*, claim_id: str, reason: str | None, relocking: bool, profile: str, root: Path, store: Path,
          register: Path | None, content: Path | None, now: datetime | None) -> Result:
    content = Path(content) if content else CONTENT_DIR

    def command() -> Result:
        if relocking and not (reason or "").strip():
            raise _Refusal("a relock gives its reason (--reason): why the Claim is recorded afresh")
        path = content / "claims" / f"{claim_id}.md"
        if not path.is_file():
            raise _Refusal(f"there is no Claim {claim_id} ({path})")
        claim, problems = K.read_claim(path.read_bytes(), path.name)
        if claim is None:
            raise _Refusal(f"{path.name} is not a Claim: {problems[0]}")
        if not claim["readings"]:
            raise _Refusal(f"{claim_id} has no reading to measure: add one under readings: in its file")
        with _opened("claims relock" if relocking else "claims compute", profile=profile, root=root, store=store,
                     register=register, now=now) as run:
            run.recover()   # a Release a killed run left unnamed is not one to lock against
            directory = _locks_dir(profile, run.root, content)
            repo_locks, _, repo_problems = K.load_locks(content / "claims" / K.LOCKS)
            held, _, found = (repo_locks, None, repo_problems) if profile == "public" else K.load_locks(directory)
            if found or repo_problems:
                raise _Refusal(f"the locks already kept cannot all be read: {(found or repo_problems)[0]}")
            if profile == "local" and claim_id in repo_locks:
                raise _Refusal(f"{claim_id} is locked in the repository (content/claims/locks), and every Release "
                               "reads that lock: record it afresh with --profile public, or not at all")
            earlier = held.get(claim_id, [])
            if earlier and not relocking:
                raise _Refusal(f"{claim_id} already has a lock (v{earlier[-1]['version']}); compute never overwrites "
                               f"one. To record the Claim afresh: python -m atlas claims relock {claim_id} "
                               f"--profile {profile} --reason WHY")
            if relocking and not earlier:
                raise _Refusal(f"{claim_id} has no lock to follow; its first is written by: python -m atlas claims "
                               f"compute {claim_id} --profile {profile}")
            today = K.new_york_day(run.now)
            if claim["checked_on"] != today:
                raise _Refusal(f"the Claim says it was checked on {claim['checked_on']} (checked_on), and it is being "
                               f"checked now, on {today} in New York. The now-when-checked row is today's: set "
                               f"checked_on to {today} in {path.name}")
            release_id = R.current(run.root)
            if release_id is None:
                raise _Refusal(f"{run.root} has no current Release to compute against: python -m atlas release "
                               f"--profile {profile}")
            problems = R.release_problems(run.root, release_id, run.profile, run.gate)
            if problems:
                raise _Refusal(problems[0])
            files = R.read_release(run.root, release_id)
            manifest = json.loads(files[MANIFEST])
            catalog = {entry["key"]: entry for entry in json.loads(files[CATALOG])["series"]}
            for reading in claim["readings"]:
                entry = catalog.get(reading["series"])
                if entry is None:
                    raise _Refusal(f"reading {reading['id']}: release {release_id} has no Series called "
                                   f"{reading['series']}" + (": it is withheld" if any(
                                       row["key"] == reading["series"] for row in manifest["withheld"]) else ""))
                if entry["representation"] == LEGACY:
                    raise _Refusal(f"reading {reading['id']}: {reading['series']} is held in v1's legacy representation "
                                   f"(monthly, already rounded) in release {release_id}. A Claim is locked only on a "
                                   "Series held as its Origin gives it; it can be locked once the Series is captured "
                                   "from its Origin")
            spec = {name: claim[name] for name in ("said_on", "said_at", "checked_on", "readings") if name in claim}
            try:
                answer = engine.claim_evidence(run.root / "releases" / release_id, release_id, spec)
            except engine.EngineError as error:
                raise _Refusal(f"the engine gave no answer: {error}") from None
            if not answer["ok"]:
                raise _Refusal(f"{claim_id} cannot be locked on release {release_id}: {answer.get('message')}")
            version = earlier[-1]["version"] + 1 if earlier else 1
            lock = K.sealed({
                "format": 1, "claim_id": claim_id, "version": version, "locked_at": run.started,
                "reason": reason.strip() if relocking else None, "supersedes": version - 1 if relocking else None,
                "record": K.record(claim), "record_sha256": K.record_sha256(claim),
                "release": {"release_id": release_id, "created": manifest["created"], "profile": manifest["profile"]},
                "semantics_version": answer["semantics_version"], "rights_used": answer["rights_used"],
                "readings": answer["readings"],
            })
            body = K.lock_bytes(lock)
            name = K.lock_name(claim_id, version)
            _, problems = K.read_lock(body, name)
            if problems:
                raise _Refusal(f"what the engine answered is not a lock: {problems[0]}")
            if profile == "public":
                # A lock in the repository is a file of values (ADR 0031, ADR 0034).
                for permission in ("display", "redistribute"):
                    decision = run.gate.permits(K.lineage_rows(lock, permission), "production")
                    if not decision.allowed:
                        raise _Refusal(f"{name} may not be kept in the repository ({permission}): {decision.reason}. "
                                       "To try the Claim on this machine: --profile local")
            # Pinned first: a pin with no lock keeps a Release it need not; a lock with no pin
            # could lose the Release its numbers came from. The pin names the lock by its hash:
            # a public root holds nothing of a Claim that is not published.
            pins = [pin for pin in R.pins(run.root) if pin["release_id"] != release_id]
            kept = next((pin for pin in R.pins(run.root) if pin["release_id"] == release_id), None)
            pins.append({"release_id": release_id, "pinned_at": (kept or {}).get("pinned_at", run.started),
                         "reason": "; ".join(filter(None, [(kept or {}).get("reason"), f"claim lock {lock['lock_sha256'][:12]}"]))})
            R.replace_json(run.root / R.PINS, {"format": R.FORMAT, "pins": pins})
            _write_new(directory / name, body)
            lines = [*run.lines, f"LOCKED {claim_id} v{version} on release {release_id}", f"  {directory / name}"]
            for reading in lock["readings"]:
                then = reading["then"]
                basis = then["basis"] + (f" ({then['unavailable']['reason']})" if "unavailable" in then else "")
                lines.append(f"  reading {reading['id']}: then {basis}; now when checked "
                             f"{len(reading['now_when_checked']['figures'])} figure(s); "
                             f"{len(reading['alternative_windows'])} alternative window(s)")
            if profile == "public":
                lines.append("  The lock is a file of the repository: commit it with the Claim. It is never edited.")
            else:
                lines.append("  Local profile: the lock stays in the local root and is never committed.")
            lines.append(f"next: python -m atlas release --profile {profile} --reuse-data")
            return Result("locked", 0, release_id, lines)

    return _guarded(command)


def compute(*, claim_id: str, profile: str, root: Path, store: Path, register: Path | None = None,
            content: Path | None = None, now: datetime | None = None) -> Result:
    """Compute a Claim's evidence on the root's current Release and freeze it in its first
    lock. Refuses when the Claim has a lock already."""
    return _lock(claim_id=claim_id, reason=None, relocking=False, profile=profile, root=root, store=store,
                 register=register, content=content, now=now)


def relock(*, claim_id: str, reason: str, profile: str, root: Path, store: Path, register: Path | None = None,
           content: Path | None = None, now: datetime | None = None) -> Result:
    """Record a Claim afresh: a new lock version with a reason, beside the ones before it."""
    return _lock(claim_id=claim_id, reason=reason, relocking=True, profile=profile, root=root, store=store,
                 register=register, content=content, now=now)


def listing(*, profile: str, root: Path, content: Path | None = None) -> list[str]:
    """Every Claim with its status and its locks, as this Profile reads them."""
    content = Path(content) if content else CONTENT_DIR
    claims, problems = K.load_claims(content / "claims")
    repo, _, found = K.load_locks(content / "claims" / K.LOCKS)
    own, _, more = K.load_locks(Path(root) / R.LOCKS) if profile == "local" else ({}, {}, [])
    lines = [f"NOT READ {problem}" for problem in [*problems, *found, *more]]
    for claim in claims:
        locks, where = (repo[claim["id"]], "repository") if claim["id"] in repo else (own.get(claim["id"], []), "local root")
        said = "no lock" if not locks else (
            f"v{locks[-1]['version']} locked {locks[-1]['locked_at']} on release {locks[-1]['release']['release_id']} ({where})")
        stale = K.stale(claim, locks)
        lines.append(f"{claim['id']}  {claim['status']}  {len(claim['readings'])} reading(s)  {said}"
                     + ("  CHANGED SINCE IT WAS LOCKED" if stale else ""))
    lines.append(f"{len(claims)} Claim{'' if len(claims) == 1 else 's'} in {content / 'claims'}")
    return lines


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    parser = argparse.ArgumentParser(prog="atlas claims", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (("compute", "compute a Claim's evidence and freeze it in its first lock"),
                       ("relock", "record a Claim afresh: a new lock version, with a reason"),
                       ("list", "every Claim, its status and its locks")):
        p = sub.add_parser(name, help=text)
        if name != "list":
            p.add_argument("claim_id", help="the Claim's id: its file name without .md")
        if name == "relock":
            p.add_argument("--reason", required=True, help="why the Claim is recorded afresh")
        p.add_argument("--profile", required=True, choices=("public", "local"),
                       help="public: the lock goes into the repository and the rights gate is asked. "
                            "local: it stays in the local root")
        p.add_argument("--out", help="the release root (default $ATLAS_PUBLIC or $ATLAS_LOCAL, else var/public or var/local)")
        p.add_argument("--store", help="the store (default $ATLAS_STORE, else var/store)")
        p.add_argument("--register", help="a rights register file (default schema/rights-register.json)")
        p.add_argument("--content", help="the content directory, which holds claims/ (default content)")
        p.add_argument("--now", help=argparse.SUPPRESS)   # tests: the instant of the run, UTC
    args = parser.parse_args(argv)
    root = Path(args.out) if args.out else R.home(args.profile)
    content = Path(args.content) if args.content else None
    if args.command == "list":
        print("\n".join(listing(profile=args.profile, root=root, content=content)))
        return 0
    common = {"claim_id": args.claim_id, "profile": args.profile, "root": root,
              "store": Path(args.store) if args.store else R.home("store"),
              "register": Path(args.register) if args.register else None, "content": content,
              "now": datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else None}
    result = relock(reason=args.reason, **common) if args.command == "relock" else compute(**common)
    print("\n".join(result.lines))
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
