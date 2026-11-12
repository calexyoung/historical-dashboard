"""A release root on disk (PLAN 4.3; ADR 0023): everything beside ``releases/`` that the
release writer keeps, and the checks a Release already in a root must pass before anything
points at it.

    {root}/LOCK             held for the length of any change to the root
    {root}/root.json        what the root is for: its Profile, and whether its values are an
                            agency's or invented for a fixture. Written once
    {root}/CURRENT          the promoted release id (atlas.staging)
    {root}/STATUS.json      the last run: started, finished, outcome, failed checks
    {root}/pins.json        releases retention must keep
    {root}/saved.json       saved queries (a local root only); retention keeps the releases they name
    {root}/withdrawn.json   Series taken down, each with the reason and the releases retired
    {root}/releases/{id}/   the Releases
    {root}/trash/{id}/      pruned Releases, deleted a day after ``trash/{id}.json`` says
    {root}/.staging/        a Release being written

A reader needs only ``CURRENT`` and ``releases/``; the rest is the writer's.
"""
from __future__ import annotations

import json
import os
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from ..capture import store as S
from ..release import ANNOTATIONS, CATALOG, LEGACY, MANIFEST, validate_files
from ..rights import RightsGate
from ..staging import RELEASE_ID, STAGING
from .export import history_lineages, lineage

REPO = Path(__file__).resolve().parents[2]
FORMAT = 1
MARKER, STATUS, PINS, WITHDRAWN, TRASH = "root.json", "STATUS.json", "pins.json", "withdrawn.json", "trash"
SAVED = "saved.json"
KEEP = 30
TRASH_DAYS = 1
HOMES = {"public": ("ATLAS_PUBLIC", "public"), "local": ("ATLAS_LOCAL", "local"),
         "store": ("ATLAS_STORE", "store")}


class RootRefused(Exception):
    """The root may not be used this way. Nothing was changed."""


def resolved(path: str | os.PathLike) -> Path:
    return Path(path).expanduser().resolve()


def home(name: str, repo: Path = REPO) -> Path:
    """Where ``$ATLAS_PUBLIC``, ``$ATLAS_LOCAL`` or ``$ATLAS_STORE`` is on this machine."""
    variable, default = HOMES[name]
    return resolved(os.environ.get(variable) or repo / "var" / default)


def overlaps(a: Path, b: Path) -> bool:
    a, b = resolved(a), resolved(b)
    return a == b or a in b.parents or b in a.parents


def separate(root: Path, profile: str, store: Path, *, for_tests: bool) -> None:
    """Refuse a root that is, holds or lies inside a place it must stay apart from (PLAN 6.1
    point 2), by any name: links are resolved.

    ``for_tests`` is a Release of invented values, or one decided by a register other than the
    committed one. Such a Release never goes into this machine's real roots."""
    if profile not in ("public", "local"):
        raise RootRefused(f"unknown profile {profile!r}: only public and local exist")
    apart = [(store, "the store"), (home("store"), "$ATLAS_STORE")]
    apart.append((home("local"), "$ATLAS_LOCAL") if profile == "public" else (home("public"), "$ATLAS_PUBLIC"))
    for other, name in apart:
        if overlaps(root, other):
            raise RootRefused(f"a {profile}-profile release root must stay apart from {name}: "
                              f"{resolved(root)} overlaps {resolved(other)}")
    if for_tests:
        for name in ("public", "local"):
            if overlaps(root, home(name)):
                raise RootRefused(
                    f"invented values, and releases decided by a register other than the committed "
                    f"one, never go into ${HOMES[name][0]} ({home(name)}); name another directory")


@contextmanager
def locked(root: Path) -> Iterator[None]:
    """Hold the root for one change. The operating system's lock: a crash leaves nothing to clear."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    try:
        with S.locked(root):
            yield
    except S.StoreLocked:
        raise RootRefused(f"another run holds {root / 'LOCK'}; nothing was changed") from None


def replace_json(path: Path, document: object) -> None:
    """Write a file whole or not at all."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(document, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def marker(root: Path) -> dict | None:
    return read_json(Path(root) / MARKER)


def claim(root: Path, profile: str, real_bytes: bool) -> None:
    """Say once what a root is for, and refuse a Release of another kind from then on. A root
    of invented values can never be made a root of an agency's, nor the other way round."""
    found = marker(root)
    if found is None:
        replace_json(Path(root) / MARKER, {"format": FORMAT, "profile": profile, "real_bytes": real_bytes})
        return
    if found.get("profile") != profile:
        raise RootRefused(f"{root} is a {found.get('profile')}-profile root; it takes no "
                          f"{profile}-profile release")
    if found.get("real_bytes") is not real_bytes:
        kinds = {True: "values an agency served", False: "invented values"}
        raise RootRefused(f"{root} holds {kinds.get(found.get('real_bytes'), 'something unknown')}; "
                          f"a release of {kinds[real_bytes]} does not go in it")


def current(root: Path) -> str | None:
    """The release id CURRENT names, or None when there is none or it is not an id."""
    try:
        text = (Path(root) / "CURRENT").read_text(encoding="utf-8").strip()
    except (FileNotFoundError, NotADirectoryError):
        return None
    return text if RELEASE_ID.fullmatch(text) else None


def release_ids(root: Path, folder: str = "releases") -> list[str]:
    directory = Path(root) / folder
    if not directory.is_dir():
        return []
    return sorted(p.name for p in directory.iterdir() if RELEASE_ID.fullmatch(p.name))


def pins(root: Path) -> list[dict]:
    return (read_json(Path(root) / PINS) or {}).get("pins", [])


def saved(root: Path) -> list[dict]:
    """The root's saved queries (PLAN M18; ``saved.py``). Each is its own Pin."""
    entries = (read_json(Path(root) / SAVED) or {}).get("saved", [])
    return [entry for entry in entries if isinstance(entry, dict)]


def kept_by_name(root: Path) -> set[str]:
    """The Releases something names, which retention must keep whatever their age: every pin
    and every saved query."""
    named = {pin["release_id"] for pin in pins(root)}
    return named | {entry["release_id"] for entry in saved(root) if isinstance(entry.get("release_id"), str)}


def withdrawn(root: Path) -> dict[str, dict]:
    return (read_json(Path(root) / WITHDRAWN) or {}).get("series", {})


def write_status(root: Path, **fields) -> None:
    replace_json(Path(root) / STATUS, {"format": FORMAT, **fields, "current": current(root)})


def status(root: Path) -> dict | None:
    return read_json(Path(root) / STATUS)


# --- a Release already in the root ---------------------------------------------------------------


def read_release(root: Path, release_id: str, folder: str = "releases") -> dict[str, bytes] | str:
    """Every file of a Release in the root, or why it cannot be taken as one. The directory
    and everything in it must be real: a link could lead to a Release of another Profile
    (PLAN 6.1 point 2)."""
    if not isinstance(release_id, str) or not RELEASE_ID.fullmatch(release_id):
        return f"{release_id!r} is not a release id"
    root = Path(root)
    directory = root / folder / release_id
    if directory.is_symlink() or (root / folder).is_symlink():
        return f"release {release_id} is reached through a link"
    if not directory.is_dir():
        return f"release {release_id} is not in {root / folder}"
    if directory.resolve() != root.resolve() / folder / release_id:
        return f"release {release_id} is reached through a link"
    files: dict[str, bytes] = {}
    try:
        for path in sorted(directory.rglob("*")):
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                return f"release {release_id}: {path.relative_to(directory).as_posix()} is not a regular file"
            if path.is_file():
                files[path.relative_to(directory).as_posix()] = path.read_bytes()
    except OSError as error:  # a Release that cannot be read is not one anything may build on
        return f"release {release_id} cannot be read ({error})"
    return files


def holds(files: dict[str, bytes], key: str) -> bool:
    return f"series/{key}.json" in files or f"derived/{key}.json" in files


def rights_problems(files: dict[str, bytes], gate: RightsGate, surface: str = "production") -> list[str]:
    """Why the Series a Release holds may not all be displayed on a public Surface: for each
    one, its own Origin, dataset and Channel and those of every input it is computed from, to
    any depth, must be permitted by the gate, and none may be in v1's legacy representation.
    Asked of the files themselves, whoever wrote them."""
    if gate.problem is not None:
        return [f"the rights register cannot be trusted ({gate.problem})"]
    catalog = {entry["key"]: entry for entry in json.loads(files[CATALOG])["series"]}
    manifest = json.loads(files[MANIFEST])
    problems = []
    for folder in ("series", "derived"):
        for path in sorted(p for p in files if p.startswith(f"{folder}/")):
            key = path[len(folder) + 1:-len(".json")]
            reached, stack = set(), [key]
            while stack:
                name = stack.pop()
                if name in reached:
                    continue
                reached.add(name)
                stack.extend(catalog.get(name, {}).get("recipe", {}).get("inputs", []))
            missing = sorted(name for name in reached if name not in catalog)
            if missing:
                problems.append(f"{key}: rests on {', '.join(missing)}, which the catalog does not describe")
                continue
            document = json.loads(files[path])
            if LEGACY in (document.get("representation"), manifest["series"].get(key, {}).get("representation")):
                problems.append(f"{key}: is in v1's legacy representation, which is never public")
                continue
            decision = gate.permits([lineage(catalog[name]) for name in sorted(reached)], surface)
            if not decision.allowed:
                problems.append(f"{key}: {decision.reason}")
    # Past values are values: every Origin, dataset and Channel a Series' history came through.
    for path in sorted(p for p in files if p.startswith("vintages/")):
        key = path[len("vintages/"):-len(".json")]
        try:
            lineages = history_lineages(json.loads(files[path]))
        except (ValueError, KeyError, TypeError, AttributeError):
            problems.append(f"{key}: its history: does not say where every version came from")
            continue
        decision = gate.permits(lineages, surface)
        if not decision.allowed:
            problems.append(f"{key}: its history: {decision.reason}")
    problems.extend(annotation_problems(files, gate, surface))
    return problems


#: The kinds of Annotation that are Macro Atlas's own content, or belong to a Series the
#: checks above have already asked about. Every other kind was typed in from somebody's record.
_OWN_KINDS = ("event", "claim", "data_note")


def annotation_problems(files: dict[str, bytes], gate: RightsGate, surface: str = "production") -> list[str]:
    """Why the Annotations a Release holds may not all be displayed on a public Surface (M19;
    ADR 0033). A term of government or a recession was typed in from a published record, so it
    says where from (``provenance``) and the gate is asked about that Origin; one that is v1's
    is never public. Asked for as long as the Release is kept, like everything else here."""
    problems = []
    try:
        annotations = json.loads(files[ANNOTATIONS])["annotations"]
    except (KeyError, ValueError, TypeError):
        return ["its Annotations cannot be read"]
    from_events = json.loads(files[MANIFEST]).get("schema_version") not in ("0.1.0", "0.2.0")
    asked: dict[tuple, str | None] = {}
    for annotation in annotations:
        provenance = annotation.get("provenance")
        if provenance is None:
            if from_events and annotation.get("kind") not in _OWN_KINDS:
                problems.append(f"the Annotation {annotation.get('id')}: does not say where it came from")
            continue
        if provenance.get("representation") == LEGACY:
            problems.append(f"the Annotation {annotation.get('id')}: is v1's, which is never public")
            continue
        key = (provenance.get("producer"), provenance.get("dataset"), provenance.get("via"))
        if key not in asked:
            decision = gate.permits([{"origin": key[0], "dataset": key[1], "channel": key[2],
                                      "representation": provenance.get("representation"),
                                      "permission": "display"}], surface)
            asked[key] = None if decision.allowed else decision.reason
        if asked[key]:
            problems.append(f"the Annotation {annotation.get('id')}: {asked[key]}")
    return problems


def release_problems(root: Path, release_id: str, profile: str, gate: RightsGate,
                     folder: str = "releases") -> list[str]:
    """Why a Release in the root may not be made current, pinned or built on. Empty means it
    may. Checked every time: what a register allowed when a Release was written does not
    carry over (ADR 0020)."""
    files = read_release(root, release_id, folder)
    if isinstance(files, str):
        return [files]
    issues = validate_files(release_id, files)
    if issues:
        more = f" (and {len(issues) - 1} more)" if len(issues) > 1 else ""
        return [f"release {release_id} breaks the contract: {issues[0]}{more}"]
    manifest = json.loads(files[MANIFEST])
    problems = []
    if manifest["profile"] != profile:
        problems.append(f"release {release_id} has profile {manifest['profile']!r}; this root takes "
                        f"{profile}-profile releases")
    for key in sorted(withdrawn(root)):
        if holds(files, key):
            problems.append(f"release {release_id} holds {key}, which was withdrawn")
    if profile == "public":
        problems.extend(f"release {release_id}: {problem}" for problem in rights_problems(files, gate))
    return problems


# --- recovery and retention ----------------------------------------------------------------------


def recover(root: Path, now: datetime) -> tuple[list[str], str | None]:
    """Put right what a run that was killed left behind. Call with the root locked.

    A run writes ``promoting`` with the release id in STATUS.json before it moves anything.
    If CURRENT names that Release, the promotion happened and only the bookkeeping is missing.
    If it does not, the Release may sit in ``releases/`` with nothing naming it: it goes to
    the trash. Anything left in the staging area was never promoted and is removed.

    Returns what was found, and the id of a Release whose promotion had happened and had not
    been recorded (the caller owes the journal a line for it)."""
    root, notes, promoted = Path(root), [], None
    staging = root / STAGING
    if staging.is_symlink():
        raise RootRefused(f"{staging} is a link; a release root holds real directories only")
    if staging.is_dir():
        left = sorted(p.name for p in staging.iterdir())
        shutil.rmtree(staging)
        if left:
            notes.append(f"removed what an unfinished run left in staging: {', '.join(left)}")
    last = status(root)
    if last and last.get("outcome") in ("running", "promoting"):
        notes.append(f"the run that started {last.get('started')} did not finish")
        intended = last.get("release_id")
        if last["outcome"] == "promoting" and intended:
            if current(root) == intended:
                # The caller journals it and then closes the intent (``close_promotion``), in
                # that order: cut off in between, the next run does both again.
                promoted = intended
                notes.append(f"it had promoted {intended}; CURRENT names it")
            elif (root / "releases" / intended).is_dir():
                if intended in {pin["release_id"] for pin in pins(root)}:
                    # No command pins a Release nothing names; someone wrote the pin by hand.
                    notes.append(f"it had moved {intended} into releases/ without naming it in "
                                 "CURRENT; that release is pinned and was left where it is")
                else:
                    _to_trash(root, intended, now)
                    notes.append(f"it had moved {intended} into releases/ without naming it in "
                                 "CURRENT; that release is in the trash")
                write_status(root, started=last.get("started"), finished=S.stamp(now), outcome="failed",
                             release_id=intended, profile=last.get("profile"), failed_checks=[],
                             reason="the run was cut off before CURRENT was replaced")
    return notes, promoted


def close_promotion(root: Path, release_id: str, now: datetime) -> None:
    """Close the intent of a promotion that happened and was cut off before its record."""
    last = status(root) or {}
    write_status(root, started=last.get("started"), finished=S.stamp(now), outcome="promoted",
                 release_id=release_id, profile=last.get("profile"), failed_checks=[],
                 note="recorded by the next run: the run that promoted it was cut off")


def _to_trash(root: Path, release_id: str, now: datetime) -> None:
    trash = root / TRASH
    trash.mkdir(exist_ok=True)
    target = trash / release_id
    if target.exists():
        shutil.rmtree(target)
    os.rename(root / "releases" / release_id, target)
    replace_json(trash / f"{release_id}.json", {"format": FORMAT, "trashed_at": S.stamp(now)})


def prune(root: Path, now: datetime, keep: int = KEEP) -> tuple[list[str], list[str]]:
    """Retention: keep the newest ``keep`` Releases, CURRENT, every pin and every Release a
    saved query names. The rest are
    renamed into ``trash/``, where a reader that already opened one can go on reading, and
    are deleted a day later. Returns (trashed, deleted)."""
    root = Path(root)
    ids = release_ids(root)
    kept = set(ids[-keep:]) | kept_by_name(root) | {current(root)}
    trashed = [release_id for release_id in ids if release_id not in kept]
    for release_id in trashed:
        _to_trash(root, release_id, now)
    deleted = []
    for note in sorted((root / TRASH).glob("*.json")) if (root / TRASH).is_dir() else []:
        try:
            due = S.unstamp(read_json(note)["trashed_at"]) + timedelta(days=TRASH_DAYS)
        except (KeyError, TypeError, ValueError):
            continue
        if now >= due:
            shutil.rmtree(root / TRASH / note.stem, ignore_errors=True)
            note.unlink()
            deleted.append(note.stem)
    return trashed, deleted
