"""The publisher (PLAN 4.2, 4.4, M9; ADR 0002, ADR 0023): one run that writes a Release,
checks it, promotes it and keeps the root in order, plus the few other things that may change
a root: rolling back, pinning and withdrawing a Series.

    release(...)      export from the vintage store (or reuse the current data), check, promote
    rollback(...)     name an earlier Release of this root in CURRENT
    pin(...), unpin   keep a Release through retention
    withdraw(...)     take a Series down: a new Release without it, the old ones retired

Every one of them holds the root's ``LOCK`` and then the store's, reads the rights register
once, and returns a ``Result``; none raises for a refusal. A run that fails leaves ``CURRENT``
as it was and says why in ``STATUS.json``.

Order inside a release run, and what a kill at each point leaves (``root.recover`` puts each
right at the start of the next run):

1. STATUS ``running``; export; the Node step, in a directory of its own under ``.staging/``
   that is removed as soon as its Derived series are read back (``engine.py``); checks.
   Nothing in the root but STATUS has changed, unless the kill came during the Node step: then
   its directory is left in ``.staging/``, and removed like anything else there.
2. The files are written under ``.staging/``. A kill leaves them there; they are removed.
3. STATUS ``promoting`` with the release id; the directory is renamed into ``releases/``.
   A kill leaves a Release nothing names; it is moved to the trash.
4. ``CURRENT`` is replaced. This is the commit point: from here the Release is live, and a
   failure to write what follows is reported but cannot undo it.
5. STATUS ``promoted``, a line in the store's ``runs.ndjson``, retention.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .. import legacy as L
from ..capture import store as S
from ..release import ANNOTATIONS, CATALOG, MANIFEST, SCHEMA_VERSION, validate_files
from ..rights import REGISTER_PATH, RightsGate
from ..staging import STAGING, PromotionRefused, _no_links, _write_current, promote, stage
from ..vintage.replay import SeriesTableError, load_derived, load_series
from ..vintage.store import VintageStore
from ..content.compile import add_reading_files
from . import bulk as B
from . import engine
from . import root as R
from . import saved as saved_queries
from .export import (
    AGE_NOTE,
    Built,
    ContentRefused,
    ExportError,
    add_content,
    add_derived,
    add_latest,
    build,
    dump,
    lag_limit,
    refresh_ml_use,
    todays_rights,
)

REJECTED, RETIRED = "rejected", "retired"
#: What a root's STATUS.json says when the content could not be compiled. The reason itself
#: may name a draft, so it is printed for the person running the command and written nowhere
#: in the root (PLAN 4.3: a public root holds nothing that is not published).
CONTENT_REFUSED = "REFUSED: the content cannot be compiled; the command's own output says why (python -m atlas check)"


@dataclass
class Result:
    """What a run did. ``outcome`` is ``promoted``, ``rejected`` (a check failed), ``refused``
    (the run was not allowed to start, or had nothing it may publish), ``failed`` (an error),
    or for the other commands ``rolled_back``, ``pinned``, ``unpinned``, ``withdrawn``."""

    outcome: str
    exit_code: int
    release_id: str | None = None
    lines: list[str] = field(default_factory=list)
    failed_checks: list[dict] = field(default_factory=list)


class _Refusal(Exception):
    pass


@dataclass
class _Run:
    command: str
    root: Path
    store: Path
    profile: str
    table: object
    gate: RightsGate
    register: dict
    now: datetime
    lines: list[str] = field(default_factory=list)
    #: What STATUS.json says instead of the first refusal line, when that line may name
    #: something that is not published (a draft's id or words).
    status_reason: str | None = None

    @property
    def started(self) -> str:
        return S.stamp(self.now)

    def journal(self, **record) -> None:
        S.append_line(self.store / S.RUNS, {
            "format": S.LOG_FORMAT, "job": "release", "command": self.command,
            "run_id": f"{self.started}/{self.command}/{os.getpid()}", "root": str(self.root),
            "profile": self.profile, "started_at": self.started, "register": self.register, **record})

    def finish(self, outcome: str, exit_code: int, release_id: str | None = None,
               failed: list[dict] | None = None, **more) -> Result:
        """Say how the run ended, in STATUS.json and the journal. Neither can undo the run:
        if they cannot be written, the result says so."""
        failed = failed or []
        try:
            # The journal first: if only the status then fails, the next run finds the intent
            # still open and records the promotion again, which is better than never.
            self.journal(event="finished", outcome=outcome, release_id=release_id,
                         failed_checks=[check["check"] for check in failed], **more)
            R.write_status(self.root, started=self.started, finished=S.stamp(_clock(None)),
                           outcome=outcome, release_id=release_id, profile=self.profile,
                           command=self.command, failed_checks=failed,
                           reason=(self.status_reason or next((line for line in self.lines if line.startswith(
                               ("REFUSED", "FAILED", "REJECTED"))), None)) if exit_code else None)
        except OSError as error:
            self.lines.append(f"WARNING: the run's record could not be written ({error}); "
                              f"CURRENT names {R.current(self.root)}")
            exit_code = 1
        return Result(outcome, exit_code, release_id, self.lines, failed)


    def recover(self) -> None:
        """Put right what a killed run left (``root.recover``), and give a promotion that was
        cut off before its record the journal line it never got."""
        notes, promoted = R.recover(self.root, self.now)
        self.lines.extend(notes)
        if promoted:
            files = R.read_release(self.root, promoted)
            try:
                rows = {} if isinstance(files, str) else json.loads(files[MANIFEST])["series"]
            except (KeyError, ValueError, TypeError, AttributeError):
                rows = {}  # damaged since: the promotion is still recorded, without its keys
            self.journal(event="finished", outcome="promoted", release_id=promoted, recovered=True,
                         published={key: row.get("state_hash") for key, row in sorted(rows.items())})
            R.close_promotion(self.root, promoted, self.now)


def _guarded(command: Callable[[], Result]) -> Result:
    """A refusal or a failing disk is a result, never an exception out of a command."""
    try:
        return command()
    except _Refusal as refusal:
        return _refused(f"REFUSED: {refusal}")
    except OSError as error:
        return Result("failed", 1, None, [f"FAILED: {error}"])


def _clock(now: datetime | None) -> datetime:
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("the time of a run must carry a time zone")
    return now.astimezone(UTC).replace(microsecond=0)


@contextmanager
def _opened(command: str, *, profile: str, root: Path, store: Path, register: Path | None,
            now: datetime | None) -> Iterator[_Run]:
    """Read the register once, check the root may be used, and hold both locks. Raises
    ``_Refusal`` before anything is changed."""
    root, store = Path(root), Path(store)
    path = Path(register) if register else REGISTER_PATH
    try:
        data = path.read_bytes()
    except OSError as error:
        raise _Refusal(f"the rights register at {path} cannot be read: {error}") from None
    try:
        table = json.loads(data)
    except ValueError:
        table = None
    version = table.get("version") if isinstance(table, dict) else None
    reference = {"version": version if isinstance(version, str) and version else "unreadable",
                 "sha256": hashlib.sha256(data).hexdigest()}
    try:
        committed = data == REGISTER_PATH.read_bytes()
    except OSError:
        committed = False
    try:
        invented = VintageStore(store).holds_real_bytes() is False
        R.separate(root, profile, store, for_tests=invented or not committed)
        found = R.marker(root)
        if found is not None and found.get("profile") != profile:
            raise R.RootRefused(f"{root} is a {found.get('profile')}-profile root, not a {profile} one")
        with R.locked(root):
            R.no_links(root)
            # Read now, so that a file of the root that cannot be read stops the run before it
            # changes anything, and by name.
            R.pins(root), R.saved(root), R.withdrawn(root), R.status(root)
            store.mkdir(parents=True, exist_ok=True)
            try:
                with S.locked(store):
                    yield _Run(command, root, store, profile, table, RightsGate(table), reference,
                               _clock(now))
            except S.StoreLocked:
                raise _Refusal(f"another run holds the store ({store / 'LOCK'}); nothing was "
                               "changed") from None
    except R.RootRefused as refused:
        raise _Refusal(str(refused)) from None


def _refused(lines: list[str] | str) -> Result:
    return Result("refused", 1, None, [lines] if isinstance(lines, str) else lines)


# --- checks --------------------------------------------------------------------------------------


def _checks(run: _Run, built: Built, files: dict[str, bytes], created: datetime) -> list[dict]:
    """The Python checks of PLAN 4.4 step 3 over the files about to be staged. The contract
    itself is checked last, by the caller, once the manifest carries this report."""
    catalog = {entry["key"]: entry for entry in json.loads(files[CATALOG])["series"]}
    today = f"{created:%Y-%m-%d}"
    future, out_of_range, stale = [], [], []
    for path in sorted(files):
        if not path.startswith(("series/", "derived/")):
            continue
        document = json.loads(files[path])
        key, entry = document["key"], catalog.get(document["key"], {})
        late = [o["period"] for o in document["observations"]
                if o["period_start"] > today and o["status"] != "projected"]
        if late:
            future.append(f"{key} ({late[0]})")
        if "range" in entry:
            low, high = entry["range"]
            bad = [o["period"] for o in document["observations"]
                   if o["value"] is not None and not low <= o["value"] <= high]
            if bad:
                out_of_range.append(f"{key} ({bad[0]}{f' and {len(bad) - 1} more' if len(bad) > 1 else ''})")
        limit = lag_limit(document["period_end"], entry.get("max_lag"))
        if limit is not None and today > limit:
            stale.append(key)

    def line(check: str, bad: list[str], outcome: str, what: str) -> dict:
        if not bad:
            return {"check": check, "outcome": "pass"}
        shown = ", ".join(bad[:8]) + (f" and {len(bad) - 8} more" if len(bad) > 8 else "")
        return {"check": check, "outcome": outcome, "detail": f"{what}: {shown}"}

    report = [
        line("no observation after the release", future, "fail",
             "a Period that had not begun when the Release was written, and is not marked projected"),
        line("values within the catalog's range", out_of_range, "fail", "outside the declared range"),
        line("staleness", stale, "warn", "the last Period is older than max_lag allows"),
    ]
    taken_down = sorted(key for key in R.withdrawn(run.root) if R.holds(files, key))
    report.append(line("withdrawn series stay out", taken_down, "fail", "withdrawn and present"))
    if run.profile == "public":
        problems = R.rights_problems(files, run.gate)
        report.append({"check": "rights: every Series and every input is permitted for display",
                       "outcome": "fail" if problems else "pass",
                       **({"detail": "; ".join(problems)[:2000]} if problems else {})})
        problems = B.problems(files, run.gate)
        report.append({"check": "bulk files: every row is one that may be redistributed, in every format",
                       "outcome": "fail" if problems else "pass",
                       **({"detail": "; ".join(problems)[:2000]} if problems else {})})
    return report + built.report


def _manifest(run: _Run, built: Built, release_id: str, created: datetime, report: list[dict],
              signed: bool) -> dict:
    manifest = {
        "schema_version": SCHEMA_VERSION, "semantics_version": built.semantics_version,
        "release_id": release_id, "profile": run.profile, "created": f"{created:%Y-%m-%dT%H:%M:%SZ}",
        "rights_register": {**run.register, "signed": signed},
        "series": dict(sorted(built.rows.items())),
        "withheld": sorted(built.withheld, key=lambda row: row["key"]),
        "checks": {"passed": all(item["outcome"] != "fail" for item in report), "report": report},
    }
    if built.sources:
        manifest["sources"] = built.sources
    if built.inputs:
        manifest["inputs"] = built.inputs
    if built.reused_data_from:
        manifest["reused_data_from"] = built.reused_data_from
    return manifest


def _publish(run: _Run, built: Built, write: Callable[[Path, bytes], None],
             spot: Path | None = None) -> tuple[str, str, list[dict]]:
    """Compute the Derived series (the Node step), then check, stage and promote ``built``.
    Returns (outcome, release id, failed checks); ``promoted`` means CURRENT now names the
    Release. Raises OSError and PromotionRefused only from before the commit point, with the
    staging area cleaned up."""
    created = run.now
    stopped = None
    if built.materialise or built.latest_for:
        # The engine alone computes a Derived value (ADR 0003), and a Claim's latest row (ADR
        # 0034). It works in a directory of its own inside the staging area; what it leaves is
        # checked there and read back as bytes.
        _no_links(run.root)
        try:
            outcome = engine.run(run.root / STAGING, built.files, built.materialise, spot=spot,
                                 claims=built.latest_for)
            if built.materialise:
                add_derived(built, outcome)
            add_latest(built, outcome)
        except engine.EngineError as error:
            stopped = {"check": engine.CHECK, "outcome": "fail", "detail": str(error)[:2000]}
    if stopped is None:
        # Last of all, when the Catalog and the content are what the Release will hold: the
        # headline Series and the search index, both projections of them (M22; ADR 0036).
        built.report.extend(add_reading_files(built.files, built.withheld, built.highlights))
    bulk = None
    if stopped is None and run.profile == "public":
        # Bulk files (PLAN 4.4 step 5, M25; ADR 0039): a public-profile Release's alone, made
        # from the files it is about to hold, under the Permission to redistribute. The release
        # id is made over the descriptor without its own name, then the descriptor is given it.
        bulk = B.build(built.files, run.gate)
        built.files.update(bulk.files)
        built.report.append(B.report(bulk))
        if bulk.files:
            built.files[B.DATAPACKAGE] = bulk.datapackage("", f"{created:%Y-%m-%dT%H:%M:%SZ}", run.register)
    release_id = built.release_id(created)
    if bulk is not None and bulk.files:
        built.files[B.DATAPACKAGE] = bulk.datapackage(release_id, f"{created:%Y-%m-%dT%H:%M:%SZ}", run.register)
    if stopped is not None:
        report = [stopped]      # nothing else is worth checking in a Release that lacks files
    else:
        draft = {**built.files, MANIFEST: dump(_manifest(run, built, release_id, created, [], False))}
        report = _checks(run, built, draft, created)
        # "signed": every row of the register this Release rests on is signed in the file it
        # names (ADR 0020 point 8). It follows from the gate, and authorises nothing by itself.
        signed = run.gate.problem is None and not R.rights_problems(draft, run.gate)
        report.append({"check": "release contract", "outcome": "pass"})
        files = {**built.files, MANIFEST: dump(_manifest(run, built, release_id, created, report, signed))}
        issues = validate_files(release_id, files)
        if issues:
            report[-1] = {"check": "release contract", "outcome": "fail",
                          "detail": "; ".join(str(issue) for issue in issues[:5])[:2000]}
    failed = [item for item in report if item["outcome"] == "fail"]
    if failed:
        R.replace_json(run.store / REJECTED / f"{release_id}.json", {
            "format": R.FORMAT, "release_id": release_id, "profile": run.profile,
            "root": str(run.root), "rejected_at": run.started, "report": report})
        for item in failed:
            run.lines.append(f"FAILED {item['check']}: {item.get('detail', '')}")
        run.lines.append(f"REJECTED {release_id}: {len(failed)} check(s) failed; CURRENT is "
                         f"unchanged. The report is in {run.store / REJECTED / (release_id + '.json')}")
        return "rejected", release_id, failed
    for item in report:
        if item["outcome"] == "warn":
            run.lines.append(f"WARNING {item['check']}: {item.get('detail', '')}")
    for row in built.drift:
        run.lines.append(f"DRIFT {row['claim_id']} v{row['lock_version']}: {row['differences']} place(s) where a row "
                         "computed on this Release is not the locked one (evidence/latest.json). The lock is "
                         "unchanged; only a person re-locks: atlas claims relock")
    directory = stage(run.root, release_id)
    try:
        for path, data in files.items():
            target = directory / path
            target.parent.mkdir(parents=True, exist_ok=True)
            source = built.links.get(path)
            if source is not None:
                try:
                    os.link(source, target)
                    continue
                except OSError:
                    pass  # another filesystem, or one without links: write the same bytes
            write(target, data)
        R.write_status(run.root, started=run.started, finished=None, outcome="promoting",
                       release_id=release_id, profile=run.profile, command=run.command, failed_checks=[])
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    promote(run.root, release_id, profile=run.profile)
    return "promoted", release_id, []


def _write(path: Path, data: bytes) -> None:
    path.write_bytes(data)


# --- release -------------------------------------------------------------------------------------


def _legacy_files(repo: Path | None, now: datetime) -> dict[str, bytes]:
    try:
        return L.build_release(repo or L.ROOT, now)[1]
    except (L.LegacyRefused, OSError) as error:
        raise _Refusal(f"v1's files cannot be converted ({error}); a local release without them "
                       "is asked for with legacy=False (--no-legacy)") from None


def _reuse(run: _Run, legacy: dict[str, bytes] | None, drop: dict[str, str] | None = None,
           content: Path | None = None, manual: Path | None = None) -> Built:
    """A Release that keeps the current one's data files as they are (hard links) and writes
    its content afresh. ``drop`` takes Series out, with the reason, and with them whatever is
    computed from them. The source is always this root's own CURRENT."""
    source = R.current(run.root)
    if source is None:
        raise _Refusal("there is no current release in this root to reuse")
    if drop is None:
        problems = R.release_problems(run.root, source, run.profile, run.gate)
    else:  # a withdrawal starts from a Release that is about to stop being allowed
        files = R.read_release(run.root, source)
        problems = [files] if isinstance(files, str) else [str(i) for i in validate_files(source, files)][:1]
        if not problems and json.loads(files[MANIFEST])["profile"] != run.profile:
            problems = [f"release {source} is not a {run.profile}-profile release"]
    if problems:
        raise _Refusal(f"the current release cannot be reused: {problems[0]}")
    files = R.read_release(run.root, source)
    manifest = json.loads(files[MANIFEST])
    entries = json.loads(files[CATALOG])["series"]
    gone = _with_what_rests_on(entries, set(drop or {}))
    built = Built(reused_data_from=source, semantics_version=manifest["semantics_version"],
                  sources=manifest.get("sources", []), inputs=manifest.get("inputs", []))
    # A reuse does not read the store: when each source was last fetched, and a fetch that
    # failed, are carried over. Whether its newest Period is too old is judged afresh, over
    # the Series this Release still holds and against its own date.
    today = f"{run.now:%Y-%m-%d}"
    for line in built.sources:
        if line.get("outcome") == "failed":
            continue
        # Kept: anything the reused Release said that is not about age (a Capture that had
        # not been replayed is still not in this data). Age is said again, in the same words
        # the export uses, so a reuse of a reuse neither repeats nor keeps an old age note.
        notes = [note for note in line.pop("detail", "").split("; ") if note and AGE_NOTE not in note]
        for entry in sorted(entries, key=lambda e: e["key"]):
            path = f"series/{entry['key']}.json"
            if entry["key"] in gone or path not in files or (
                    entry["source"]["origin"]["producer"], entry["source"]["channel"]["via"]) != (
                    line["producer"], line["via"]):
                continue
            ends = json.loads(files[path])["period_end"]
            limit = lag_limit(ends, entry.get("max_lag"))
            if limit is not None and today > limit:
                notes.append(f"{entry['key']} ends {ends}{AGE_NOTE}{limit}")
        line["outcome"] = "stale" if notes else "ok"
        if notes:
            line["detail"] = "; ".join(notes)
    built.withheld = [row for row in manifest["withheld"] if row["key"] not in gone]
    for key in sorted(gone & {entry["key"] for entry in entries}):
        reason = (drop or {}).get(key) or "computed from a Series that was withdrawn"
        built.withheld.append({"key": key, "reason": reason})
    for path, data in files.items():
        if path.startswith(("series/", "derived/", "vintages/")) and path.split("/")[1][:-len(".json")] not in gone:
            built.files[path] = data
            built.links[path] = run.root / "releases" / source / path
    built.rows = {key: row for key, row in manifest["series"].items() if key not in gone}
    # The values are reused; what the register says of them is read today. A Series whose row
    # has changed (another licence class, other terms) is described by today's, here and in
    # the bulk files made from this Catalog. So is what it says of model training: a Release
    # reused from before contract 0.8.0 states it, and one reused after a signature changed
    # says what the register says now (ADR 0041). Unchanged, the Catalog is the same bytes.
    fresh = [dict(entry) for entry in todays_rights(entries, run.table, run.gate)]
    refresh_ml_use(fresh, run.gate)
    if fresh != entries:
        built.files[CATALOG] = dump({**json.loads(files[CATALOG]), "series": fresh})
        for entry in fresh:
            if "rights_status" in built.rows.get(entry["key"], {}):
                built.rows[entry["key"]] = {**built.rows[entry["key"]], "rights_status": entry["rights"]["status"]}
    else:
        built.files[CATALOG] = files[CATALOG]
    # The content is written afresh from its files. v1's bands and recessions come from the
    # converter when it ran, else from the Release being reused.
    add_content(built, profile=run.profile, gate=run.gate, content=content, manual=manual,
                v1=json.loads((legacy or files)[ANNOTATIONS])["annotations"],
                local_locks=run.root / R.LOCKS, withdrawn=gone | set(R.withdrawn(run.root)))
    return built


def _with_what_rests_on(entries: list[dict], keys: set[str]) -> set[str]:
    gone, changed = set(keys), True
    while changed:
        changed = False
        for entry in entries:
            if entry["key"] not in gone and gone & set(entry.get("recipe", {}).get("inputs", [])):
                gone.add(entry["key"])
                changed = True
    return gone


def release(*, profile: str, root: Path, store: Path, register: Path | None = None,
            series: Path | None = None, now: datetime | None = None, legacy: bool | None = None,
            legacy_repo: Path | None = None, reuse_data: bool = False, keep: int = R.KEEP,
            write: Callable[[Path, bytes], None] = _write, spot: Path | None = None,
            content: Path | None = None, manual: Path | None = None) -> Result:
    """Write, check and promote one Release of ``profile`` into ``root`` from the vintage
    store at ``store``. ``legacy`` (local profile only; default yes) adds v1's Series for the
    keys the store does not hold. ``reuse_data`` keeps the current Release's data files and
    rewrites only its content. ``spot`` is the file of spot values the Node step checks
    (default ``checks/spot.json``)."""
    wants_legacy = profile == "local" and legacy is not False
    if not reuse_data and not wants_legacy and not VintageStore(store).series_keys():
        # Before a directory, a lock or a status file is made for a run with nothing to do.
        return _refused(f"REFUSED: there is nothing to release: {store} holds no Series")
    def command() -> Result:
        with _opened("release", profile=profile, root=root, store=store, register=register, now=now) as run:
            return _release(run, series, legacy, legacy_repo, reuse_data, keep, write, spot, content, manual)

    return _guarded(command)


def _release(run: _Run, series, legacy, legacy_repo, reuse_data, keep, write, spot=None, content=None,
             manual=None) -> Result:
    vintages = VintageStore(run.store)
    real = vintages.holds_real_bytes()
    with_legacy = run.profile == "local" and (legacy if legacy is not None else real is not False)
    if legacy and run.profile == "public":
        raise _Refusal("v1's legacy Series are never part of a public-profile release")
    if with_legacy and real is False:
        raise _Refusal("this store holds invented values; they are never mixed with v1's Series")
    R.claim(run.root, run.profile, real is not False)
    run.recover()
    R.write_status(run.root, started=run.started, finished=None, outcome="running", release_id=None,
                   profile=run.profile, command=run.command, failed_checks=[])
    run.journal(event="started", store=str(run.store))
    release_id = None
    try:
        legacy_files = _legacy_files(legacy_repo, run.now) if with_legacy else None
        if reuse_data:
            built = _reuse(run, legacy_files, content=content, manual=manual)
        else:
            table = load_series(series)
            built = build(profile=run.profile, store=run.store, table=run.table, gate=run.gate,
                          series=table, created=run.now, withdrawn=R.withdrawn(run.root),
                          legacy=legacy_files, derived=load_derived(series), content=content, manual=manual,
                          local_locks=run.root / R.LOCKS)
        for row in built.withheld:
            run.lines.append(f"WITHHELD {row['key']}: {row['reason']}")
        if not built.rows and not built.materialise and not _may_be_empty(run):
            raise _Refusal("there is nothing to release: " + (
                "every Series the store holds is withheld" if built.withheld
                else f"{run.store} holds no Series the series table names"))
        outcome, release_id, failed = _publish(run, built, write, spot)
    except ContentRefused as refusal:
        run.lines.append(f"REFUSED: {refusal}")
        run.status_reason = CONTENT_REFUSED
        return run.finish("refused", 1)
    except (_Refusal, ExportError, SeriesTableError, R.RootRefused) as refusal:
        run.lines.append(f"REFUSED: {refusal}")
        return run.finish("refused", 1)
    except (PromotionRefused, OSError) as error:
        shutil.rmtree(run.root / STAGING, ignore_errors=True)
        run.lines.append(f"FAILED: {error}. CURRENT is unchanged ({R.current(run.root)}).")
        return run.finish("failed", 1)
    if outcome != "promoted":
        return run.finish(outcome, 1, release_id, failed)
    run.lines.append(f"PROMOTED {release_id} ({run.profile} profile): {len(built.rows)} series, "
                     f"{len(built.withheld)} withheld")
    result = run.finish("promoted", 0, release_id, published=built.published(),
                        withheld=[row["key"] for row in built.withheld],
                        reused_data_from=built.reused_data_from)
    try:
        trashed, deleted = R.prune(run.root, run.now, keep)
    except OSError as error:
        result.lines.append(f"WARNING: retention could not finish ({error})")
        result.exit_code = 1
    else:
        if trashed or deleted:
            result.lines.append(f"retention: {len(trashed)} release(s) moved to trash, "
                                f"{len(deleted)} deleted from it")
    return result


def _may_be_empty(run: _Run) -> bool:
    """A Release that publishes no Series is written only to replace one that publishes some:
    that is how values come down when a permission goes. With nothing to replace, there is
    nothing to say."""
    source = R.current(run.root)
    if source is None:
        return False
    files = R.read_release(run.root, source)
    return not isinstance(files, str) and any(p.startswith(("series/", "derived/")) for p in files)


# --- rollback, pins ------------------------------------------------------------------------------


def rollback(*, release_id: str, profile: str, root: Path, store: Path, register: Path | None = None,
             now: datetime | None = None) -> Result:
    """Name an earlier Release of this root in CURRENT. It is checked as if it were new: the
    contract, the root's Profile, no link, nothing withdrawn, and for a public root today's
    register."""
    def command() -> Result:
        with _opened("rollback", profile=profile, root=root, store=store, register=register, now=now) as run:
            run.recover()
            problems = R.release_problems(run.root, release_id, run.profile, run.gate)
            if problems:
                run.lines.extend(f"REFUSED: {problem}" for problem in problems)
                run.lines.append(f"CURRENT is unchanged ({R.current(run.root)}).")
                return run.finish("refused", 1)
            before = R.current(run.root)
            try:
                _write_current(run.root, release_id)
            except OSError as error:
                run.lines.append(f"FAILED: CURRENT could not be replaced ({error}); it is unchanged")
                return run.finish("failed", 1)
            run.lines.append(f"ROLLED BACK to {release_id} (was {before})")
            return run.finish("rolled_back", 0, release_id, previous=before)

    return _guarded(command)


def pin(*, release_id: str, reason: str, profile: str, root: Path, store: Path,
        register: Path | None = None, now: datetime | None = None) -> Result:
    """Keep a Release of this root through retention. Checked as a rollback is."""
    def command() -> Result:
        with _opened("pin", profile=profile, root=root, store=store, register=register, now=now) as run:
            run.recover()  # a Release a killed run left unnamed is not one to pin
            problems = R.release_problems(run.root, release_id, run.profile, run.gate)
            if problems:
                return _refused([*run.lines, *(f"REFUSED: {problem}" for problem in problems)])
            held = [p for p in R.pins(run.root) if p["release_id"] != release_id]
            held.append({"release_id": release_id, "reason": reason, "pinned_at": run.started})
            R.replace_json(run.root / R.PINS, {"format": R.FORMAT, "pins": held})
            return Result("pinned", 0, release_id, [*run.lines, f"PINNED {release_id}: {reason}"])

    return _guarded(command)


def unpin(*, release_id: str, profile: str, root: Path, store: Path, register: Path | None = None,
          now: datetime | None = None) -> Result:
    def command() -> Result:
        with _opened("unpin", profile=profile, root=root, store=store, register=register, now=now) as run:
            held = R.pins(run.root)
            if not any(p["release_id"] == release_id for p in held):
                return _refused(f"REFUSED: {release_id} is not pinned")
            R.replace_json(run.root / R.PINS, {"format": R.FORMAT, "pins": [
                p for p in held if p["release_id"] != release_id]})
            return Result("unpinned", 0, release_id, [f"UNPINNED {release_id}"])

    return _guarded(command)


# --- saved queries -------------------------------------------------------------------------------


def save(*, address: str, note: str, profile: str, root: Path, store: Path, register: Path | None = None,
         now: datetime | None = None) -> Result:
    """Keep an Explorer view with a Pin and a note (PLAN M18; ``saved.py``). The view is pinned
    to the Release its address names, or to the current one; that Release is checked as a pin
    is, and retention keeps it for as long as the saved query exists. A local root only."""
    def command() -> Result:
        if profile != "local":
            raise _Refusal("a saved query carries a note, and a public root holds nothing that is not "
                           "published (PLAN 4.3). Save in the local root; to keep a public Release for a "
                           "link, use: atlas pin ID --profile public --reason WHY")
        problem = saved_queries.note_problem(note)
        if problem:
            raise _Refusal(problem)
        try:
            view, asked = saved_queries.canonical(address)
        except saved_queries.NotSaved as error:
            raise _Refusal(str(error)) from None
        with _opened("save", profile=profile, root=root, store=store, register=register, now=now) as run:
            run.recover()  # a Release a killed run left unnamed is not one to keep
            release_id = asked or R.current(run.root)
            if release_id is None:
                return _refused([*run.lines, "REFUSED: the root has no current Release to pin the view to"])
            problems = R.release_problems(run.root, release_id, run.profile, run.gate)
            if problems:
                return _refused([*run.lines, *(f"REFUSED: {problem}" for problem in problems)])
            entries = saved_queries.read(run.root)
            if len(entries) >= saved_queries.MAX_SAVED:
                return _refused([*run.lines, f"REFUSED: the root already holds {saved_queries.MAX_SAVED} saved queries"])
            query = f"{view}&pin={release_id}"
            entry = {"id": saved_queries.new_id(view, release_id, note, run.started), "note": note,
                     "query": query, "release_id": release_id, "saved_at": run.started}
            saved_queries.write(run.root, [*entries, entry])
            return Result("saved", 0, release_id, [*run.lines, f"SAVED {entry['id']}: {note}",
                                                   f"  /explore?{query}"])

    return _guarded(command)


def unsave(*, saved_id: str, profile: str, root: Path, store: Path, register: Path | None = None,
           now: datetime | None = None) -> Result:
    """Remove a saved query. Its Release is then kept only if something else names it."""
    def command() -> Result:
        with _opened("unsave", profile=profile, root=root, store=store, register=register, now=now) as run:
            entries = saved_queries.read(run.root)
            rest = [entry for entry in entries if entry.get("id") != saved_id]
            if len(rest) == len(entries):
                return _refused(f"REFUSED: there is no saved query {saved_id}")
            saved_queries.write(run.root, rest)
            return Result("unsaved", 0, None, [f"REMOVED {saved_id}"])

    return _guarded(command)


# --- withdrawal ----------------------------------------------------------------------------------


def withdraw(*, key: str, reason: str, profile: str, root: Path, store: Path,
             register: Path | None = None, now: datetime | None = None,
             write: Callable[[Path, bytes], None] = _write, content: Path | None = None,
             manual: Path | None = None) -> Result:
    """Take a Series down (PLAN 4.3, ADR 0006): because a permission was wrong. ``content``
    and ``manual`` are the directories the replacement's content is compiled from (default
    the repository's).

    In this order, so that being cut off never leaves the Series looking allowed: the
    withdrawal is written down first (from then on no release, rollback, pin or reuse will
    take a Release that holds the Series); a new Release without it, and without anything
    computed from it, replaces the current one; then every Release in the root that holds it,
    the trash included, is moved out to the store's ``retired/``. If the replacement cannot be
    promoted, CURRENT is removed: the site answers 503 rather than go on serving the Series.
    Running the command again finishes a withdrawal that was cut off."""
    def command() -> Result:
        with _opened("withdraw", profile=profile, root=root, store=store, register=register, now=now) as run:
            return _withdraw(run, key, reason, write, content, manual)

    return _guarded(command)


def _derived_from(files: dict[str, bytes], key: str) -> set[str]:
    try:
        entries = json.loads(files[CATALOG])["series"]
        return _with_what_rests_on(entries, {key})
    except (KeyError, ValueError, TypeError):
        return {key}


def _withdraw(run: _Run, key: str, reason: str, write, content=None, manual=None) -> Result:
    if not isinstance(key, str) or not key or not reason:
        raise _Refusal("a withdrawal names a Series and gives a reason")
    # Written down before anything else. If this cannot be written, nothing has changed.
    record = R.withdrawn(run.root)
    record.setdefault(key, {"reason": reason, "withdrawn_at": run.started, "retired": []})
    R.replace_json(run.root / R.WITHDRAWN, {"format": R.FORMAT, "series": record})
    exit_code, replacement = 0, None
    # From here on nothing may stop the Series coming down: a journal that cannot be written,
    # or a leftover that cannot be cleared, is said and passed over.
    try:
        run.recover()
        run.journal(event="started", store=str(run.store), key=key)
    except Exception as error:  # noqa: BLE001 - whatever it is, the Series still comes down
        exit_code = 1
        run.lines.append(f"WARNING: the run's record could not be written ({error}); the "
                         "withdrawal goes on")
    source = R.current(run.root)
    files = R.read_release(run.root, source) if source else {}
    if isinstance(files, str) or any(R.holds(files, k) for k in _derived_from(files, key)):
        text = f"withdrawn on {record[key]['withdrawn_at'][:10]}: {record[key]['reason']}"
        try:
            outcome, replacement, _failed = _publish(run, _reuse(run, None, {key: text}, content=content, manual=manual), write)
        except (_Refusal, ExportError, ContentRefused, PromotionRefused, OSError) as error:
            shutil.rmtree(run.root / STAGING, ignore_errors=True)
            outcome = "failed"
            if isinstance(error, ContentRefused):
                run.status_reason = CONTENT_REFUSED
            run.lines.append(f"FAILED: no replacement release could be written ({error})")
        if outcome == "promoted":
            run.lines.append(f"PROMOTED {replacement}: the current release, without {key}")
        else:
            (run.root / "CURRENT").unlink(missing_ok=True)
            exit_code, replacement = 1, None
            run.lines.append("CURRENT was removed: no release is served until the next "
                             f"release run writes one without {key}")
    retired = []
    for folder in ("releases", R.TRASH):
        for release_id in R.release_ids(run.root, folder):
            held = R.read_release(run.root, release_id, folder)
            if release_id == replacement or (
                    not isinstance(held, str) and not any(R.holds(held, k) for k in _derived_from(held, key))):
                continue
            target = run.store / RETIRED / release_id
            number = 1
            while target.exists():
                number += 1
                target = run.store / RETIRED / f"{release_id}-{number}"
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(run.root / folder / release_id), str(target))
                (run.root / folder / f"{release_id}.json").unlink(missing_ok=True)
            except OSError as error:
                # Out of the root one way or the other: a Release that cannot be kept is deleted.
                shutil.rmtree(run.root / folder / release_id, ignore_errors=True)
                exit_code = 1
                run.lines.append(f"WARNING: {release_id} could not be moved to {target} ({error}); "
                                 "it was deleted from the root instead")
                if (run.root / folder / release_id).exists():
                    run.lines.append(f"FAILED: {release_id} is still in the root; run the "
                                     "withdrawal again")
                    continue
            retired.append(release_id)
            record[key]["retired"] = sorted({*record[key]["retired"], release_id})
            try:
                R.replace_json(run.root / R.WITHDRAWN, {"format": R.FORMAT, "series": record})
            except OSError:
                exit_code = 1
    run.lines.append(f"WITHDRAWN {key}: {len(retired)} release(s) retired to {run.store / RETIRED}"
                     + (f" ({', '.join(retired)})" if retired else ""))
    return run.finish("withdrawn", exit_code, replacement, key=key, retired=retired)
