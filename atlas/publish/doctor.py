"""``atlas doctor`` (PLAN M9, 4.8, 6.1 point 5 "Deploy"): is a release root fit to serve?

    doctor()                          the health of this machine's roots and store
    doctor(surface="production")      the preflight before a production deploy

The preflight refuses a root when anything a production build could open from it is not fit
for a public Surface. A reader opens any Release by id (the current one, a pinned one, one
rolled back to), so every Release in ``releases/`` is checked, not only the one CURRENT names:

* its Profile is ``public`` and its manifest names a signed rights register;
* no Series in it is in v1's legacy representation;
* every Series, and every input of every Derived series, is permitted for display on
  production by the **committed** rights register as it reads today. There is no option to
  name another register: what a Release's own manifest says was allowed is not asked;
* no Series that was withdrawn is in it;
* the root itself is a public-profile root of values an agency served (not invented ones),
  apart from ``$ATLAS_LOCAL``, with no link in it.

Staging is held to the same rule (ADR 0015). Serving a local-profile Release on staging
behind a password is something only the deploy step can prove (PLAN M27), not this command.

Doctor changes nothing.
"""
from __future__ import annotations

import fcntl
import json
from pathlib import Path

from ..capture import store as S
from ..release import CATALOG, LEGACY, MANIFEST, validate_files
from ..rights import RightsGate, load_register
from ..staging import STAGING
from . import root as R

SURFACES = ("local", "staging", "production")


class _Report:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.failures = 0

    def ok(self, text: str) -> None:
        self.lines.append(f"OK    {text}")

    def warn(self, text: str) -> None:
        self.lines.append(f"WARN  {text}")

    def fail(self, text: str) -> None:
        self.failures += 1
        self.lines.append(f"FAIL  {text}")


def _committed_gate() -> RightsGate:
    try:
        return RightsGate(load_register())
    except (OSError, ValueError):
        return RightsGate(None)


def _lock_is_free(directory: Path) -> bool:
    try:
        with open(directory / "LOCK") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
            fcntl.flock(handle, fcntl.LOCK_UN)
    except OSError:
        pass
    return True


def _structure(root: Path, profile: str, report: _Report) -> dict[str, dict[str, bytes]]:
    """What holds for a root on any Surface. Returns the files of each Release that could be
    read and is valid."""
    good: dict[str, dict[str, bytes]] = {}
    for name in ("releases", STAGING, R.TRASH):
        if (root / name).is_symlink():
            report.fail(f"{root / name} is a link; a release root holds real directories only")
    found = R.marker(root)
    if found is not None and found.get("profile") != profile:
        report.fail(f"the root says it is for {found.get('profile')}-profile releases, not {profile}")
    gone = R.withdrawn(root)
    for release_id in R.release_ids(root):
        files = R.read_release(root, release_id)
        if isinstance(files, str):
            report.fail(files)
            continue
        issues = validate_files(release_id, files)
        if issues:
            report.fail(f"release {release_id} breaks the contract: {issues[0]}")
            continue
        manifest = json.loads(files[MANIFEST])
        if manifest["profile"] != profile:
            report.fail(f"release {release_id} has profile {manifest['profile']!r} in a {profile} root")
            continue
        held = sorted(key for key in gone if R.holds(files, key))
        if held:
            report.fail(f"release {release_id} holds {', '.join(held)}, withdrawn and not yet retired: "
                        f"run atlas withdraw {held[0]} again")
            continue
        good[release_id] = files
    current = R.current(root)
    if current is None:
        report.fail(f"{root / 'CURRENT'} names no release")
    elif current in good:
        report.ok(f"CURRENT names {current}, a valid {profile}-profile release "
                  f"({len(json.loads(good[current][MANIFEST])['series'])} series)")
    elif current not in R.release_ids(root):
        report.fail(f"CURRENT names {current}, which is not in releases/")
    retired = {release_id for record in gone.values() for release_id in record.get("retired", [])}
    for pinned in R.pins(root):
        release_id = pinned["release_id"]
        if release_id in retired:
            report.warn(f"pinned release {release_id} was retired by a withdrawal")
        elif release_id not in R.release_ids(root):
            report.fail(f"pinned release {release_id} is not in releases/")
    last = R.status(root)
    if last is None:
        report.warn("no STATUS.json: no run has been recorded in this root")
    elif last.get("outcome") in ("running", "promoting"):
        if _lock_is_free(root):
            report.warn(f"the run that started {last.get('started')} did not finish; the next run "
                        "puts the root right")
        else:
            report.warn("a run is in progress")
    elif last.get("outcome") in ("failed", "rejected", "refused"):
        report.warn(f"the last run ({last.get('started')}) was {last['outcome']}: {last.get('reason')}")
    else:
        report.ok(f"the last run ({last.get('started')}) was {last.get('outcome')}")
    if (root / STAGING).is_dir() and any((root / STAGING).iterdir()) and _lock_is_free(root):
        report.warn("an unfinished run left files in .staging/; the next run removes them")
    trash = R.release_ids(root, R.TRASH)
    report.ok(f"{len(R.release_ids(root))} release(s) kept, {len(R.pins(root))} pinned, "
              f"{len(trash)} in the trash")
    return good


def _public_surface(root: Path, surface: str, good: dict[str, dict[str, bytes]], report: _Report) -> None:
    gate = _committed_gate()
    if gate.problem is not None:
        report.fail(f"the committed rights register cannot be trusted ({gate.problem})")
    if R.overlaps(root, R.home("local")):
        report.fail(f"{root} overlaps $ATLAS_LOCAL ({R.home('local')})")
    found = R.marker(root)
    if found is None:
        report.fail("the root has no root.json: the release writer did not make it, so where its "
                    "values came from is not known")
    elif found.get("real_bytes") is not True:
        report.fail(f"the root holds invented values; they are not served on the {surface} surface")
    refused = 0
    for release_id, files in sorted(good.items()):
        manifest = json.loads(files[MANIFEST])
        problems = []
        if manifest["rights_register"]["signed"] is not True:
            problems.append("its manifest names an unsigned rights register")
        entries = json.loads(files[CATALOG])["series"]
        legacy = sorted({e["key"] for e in entries if e["representation"] == LEGACY}
                        | {k for k, row in manifest["series"].items() if row["representation"] == LEGACY})
        if legacy:
            problems.append(f"it holds v1's legacy representation ({', '.join(legacy[:3])})")
        problems.extend(R.rights_problems(files, gate, "production"))
        for problem in problems[:6]:
            report.fail(f"release {release_id}: {problem}")
        if len(problems) > 6:
            report.fail(f"release {release_id}: and {len(problems) - 6} more")
        refused += bool(problems)
    if good and not refused and not report.failures:
        report.ok(f"every release in the root ({len(good)}) is public-profile, holds no legacy "
                  f"Series, and is permitted by the committed rights register on the {surface} surface")


def doctor(*, surface: str | None = None, root: Path | None = None, store: Path | None = None
           ) -> tuple[int, list[str]]:
    """Returns the exit status (1 for any failure) and the report's lines."""
    report = _Report()
    if surface is not None and surface not in SURFACES:
        return 1, [f"FAIL  unknown surface {surface!r}: only {', '.join(SURFACES)} exist"]
    if surface in ("staging", "production"):
        root = Path(root) if root else R.home("public")
        report.lines.append(f"Preflight for the {surface} surface: {root}")
        if not root.is_dir():
            report.fail(f"{root} does not exist: there is no release to serve")
        else:
            _public_surface(root, surface, _structure(root, "public", report), report)
        if surface == "staging":
            report.lines.append("      Staging is held to production's rule here. A local-profile release "
                                "behind a password is the deploy step's to prove, not doctor's.")
    else:
        roots = [(Path(root), (R.marker(Path(root)) or {}).get("profile", "local"))] if root else [
            (R.home("local"), "local")] + ([] if surface == "local" else [(R.home("public"), "public")])
        for path, profile in roots:
            report.lines.append(f"The {profile}-profile root: {path}")
            if not path.is_dir():
                report.warn("it does not exist yet: nothing has been released into it")
                continue
            _structure(path, profile, report)
            if profile == "public":
                report.lines.append("      Rights are checked by the preflight: atlas doctor --surface production")
        store = Path(store) if store else R.home("store")
        report.lines.append(f"The store: {store}")
        if not store.is_dir():
            report.warn("it does not exist yet: nothing has been captured")
        else:
            runs = [run for run in S.read_release_runs(store) if run.get("event") == "finished"]
            if runs:
                report.ok(f"last release run: {runs[-1].get('command')} {runs[-1].get('outcome')} "
                          f"(started {runs[-1].get('started_at')})")
            rejected = sorted((store / "rejected").glob("*.json")) if (store / "rejected").is_dir() else []
            if rejected:
                report.warn(f"{len(rejected)} rejected release report(s) in {store / 'rejected'}")
    report.lines.append(f"doctor: {report.failures} failure(s)" if report.failures else "doctor: nothing wrong")
    return (1 if report.failures else 0), report.lines
