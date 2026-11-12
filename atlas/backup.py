"""``python -m atlas backup`` and ``python -m atlas restore`` (PLAN 4.3, 4.8 and M26; ADR 0040).

    python -m atlas backup --to DIR [--keep N]      one archive of the store and a release root
    python -m atlas restore --from ARCHIVE          put both back where nothing is yet

A backup is one ``macro-atlas-{time}.tar.gz`` holding ``store/`` and ``public/`` as they
stood between runs, and ``BACKUP.json``, which names every file in it with its SHA-256. It is
taken while holding ``REFRESH.LOCK``, the root's ``LOCK`` and the store's (the writer's own
order), so no capture, replay or release is half-way in it. A refresh in progress is waited
for when ``--wait`` says how long, and otherwise refuses the backup. Those locks go before
the archive is read back and checked; a lock on the backup directory itself is held to the
end, so two backups never touch each other's unfinished archive. Only an
archive that reads back whole gets its name, a ``.sha256`` beside it, and the right to push
older ones out (``--keep``, newest N).

Not in a backup: the lock files, ``.staging/`` and ``trash/`` (an unfinished run and retired
Releases, which the next run removes anyway). In it, and so as private as the root it came
from: every value the root holds. A backup of a local-profile root holds v1's data; a backup
made before a withdrawal still holds the withdrawn Series.

A restore puts back everything or nothing. It refuses a destination that holds anything,
unpacks beside the destination, checks every file against ``BACKUP.json``, moves the two
directories into place, and then asks the same two questions a deploy would: is every Capture
the bytes its name promises (``atlas capture --verify``), and is the root fit to serve
(``atlas doctor``).
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import zlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .capture import store as S
from .publish import root as R
from .refresh import REFRESH_LOCK, Busy, holding
from .staging import STAGING

MANIFEST = "BACKUP.json"
#: Held in the backup directory for the whole of a backup: writing, reading back, naming,
#: pruning. Two backups into one directory never see each other's unfinished archive.
BACKUP_LOCK = ".backup.lock"
KEEP = 14
_NAME = re.compile(r"^macro-atlas-\d{8}T\d{6}Z\.tar\.gz$")
#: Top-level names of a store or a root that are never in a backup.
_LEFT_OUT = ("LOCK", REFRESH_LOCK, STAGING, R.TRASH)
_UNREADABLE = (tarfile.TarError, OSError, EOFError, zlib.error, ValueError, KeyError)


class _Refused(Exception):
    pass


@dataclass
class Result:
    lines: list[str] = field(default_factory=list)
    exit_code: int = 0
    archive: Path | None = None

    def refuse(self, text: str) -> Result:
        self.lines.append(f"REFUSED: {text}")
        self.exit_code = 1
        return self


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class _Hashing:
    """A file that remembers the SHA-256 of what was read from it."""

    def __init__(self, handle):
        self.handle, self.digest = handle, hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        block = self.handle.read(size)
        self.digest.update(block)
        return block


def _entries(base: Path, prefix: str) -> Iterator[tuple[Path, str]]:
    """Every directory and file under ``base``, parents first, by its name in the archive."""
    for directory, names, files in os.walk(base):
        here = Path(directory)
        top = here == base
        names[:] = sorted(name for name in names if not (top and name in _LEFT_OUT))
        for name in [*names, *sorted(files)]:
            path = here / name
            if path.is_symlink():
                raise _Refused(f"{path} is a link; a store and a release root hold real files "
                               "and directories only, and a backup does not follow one out")
            if top and name in _LEFT_OUT:
                continue
            if path.is_dir() or path.is_file():
                yield path, f"{prefix}/{path.relative_to(base).as_posix()}"


@contextlib.contextmanager
def _between_runs(store: Path, public: Path, wait: float) -> Iterator[None]:
    """Hold everything a refresh holds, in its order. A refresh or another backup is waited
    for (``wait`` seconds); a single command that holds the root or the store is not."""
    try:
        with holding(store, wait), R.locked(public), S.locked(store):
            yield
    except (Busy, R.RootRefused, S.StoreLocked):
        raise _Refused("a run is in progress (it holds REFRESH.LOCK, the root's LOCK or the "
                       "store's); a backup is taken between runs, so try again when it ends") from None


@contextlib.contextmanager
def _alone_in(directory: Path) -> Iterator[None]:
    with open(directory / BACKUP_LOCK, "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise _Refused(f"another backup is writing to {directory}; nothing was written and "
                           "nothing was removed") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _write(part: Path, store: Path, public: Path, created: str) -> dict:
    files: dict[str, dict] = {}
    with tarfile.open(part, "w:gz", compresslevel=1) as tar:
        for base, prefix in ((store, "store"), (public, "public")):
            for path, name in _entries(base, prefix):
                info = tar.gettarinfo(str(path), arcname=name)
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                if info.islnk():                       # a second name of a file already written
                    tar.addfile(info)
                    files[name] = {**files[info.linkname], "same_file_as": info.linkname}
                elif info.isdir():
                    tar.addfile(info)
                else:
                    with open(path, "rb") as handle:
                        reader = _Hashing(handle)
                        tar.addfile(info, reader)
                    files[name] = {"sha256": reader.digest.hexdigest(), "size": info.size}
        marker = R.marker(public) or {}
        manifest = {
            "format": 1, "created": created,
            "store": {"files": sum(name.startswith("store/") for name in files)},
            "public": {"files": sum(name.startswith("public/") for name in files),
                       "current": R.current(public), "profile": marker.get("profile"),
                       "releases": R.release_ids(public)},
            "files": files,
        }
        body = json.dumps(manifest, indent=1, sort_keys=True).encode()
        info = tarfile.TarInfo(MANIFEST)
        info.size, info.mtime, info.mode = len(body), int(S.unstamp(created).timestamp()), 0o644
        tar.addfile(info, io.BytesIO(body))
    return manifest


def _read_back(archive: Path) -> dict:
    """The manifest of an archive every file of which is the bytes the manifest names."""
    seen: dict[str, str] = {}
    manifest = None
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar:
            if member.name == MANIFEST:
                manifest = json.load(tar.extractfile(member))
            elif member.isfile():
                digest = hashlib.sha256()
                handle = tar.extractfile(member)
                for block in iter(lambda: handle.read(1 << 20), b""):
                    digest.update(block)
                seen[member.name] = digest.hexdigest()
            elif member.islnk():
                seen[member.name] = seen[member.linkname]
            elif not member.isdir():
                raise _Refused(f"{archive.name} holds {member.name}, which is not a file or a directory")
    if not isinstance(manifest, dict) or manifest.get("format") != 1:
        raise _Refused(f"{archive.name} has no {MANIFEST} this version can read")
    _compare(manifest, seen)
    return manifest


def _compare(manifest: dict, seen: dict[str, str]) -> None:
    named = manifest["files"]
    for name in sorted(set(named) | set(seen)):
        if name not in seen:
            raise _Refused(f"{name} is named in {MANIFEST} and is not there")
        if name not in named:
            raise _Refused(f"{name} is not named in {MANIFEST}")
        if named[name]["sha256"] != seen[name]:
            raise _Refused(f"{name} is not the bytes {MANIFEST} names")


def backup(*, store: Path, public: Path, to: Path, keep: int = KEEP, now: datetime | None = None,
           wait: float = 0) -> Result:
    result = Result()
    store, public, to = Path(store), Path(public), Path(to)
    if keep < 1:
        return result.refuse("--keep is how many backups stay: at least one")
    for directory, what in ((store, "the store"), (public, "the release root")):
        if not directory.is_dir():
            return result.refuse(f"{what} {directory} is not there; there is nothing to back up")
        if R.overlaps(to, directory):
            return result.refuse(f"{to} is inside {what} ({directory}), or holds it; a backup "
                                 "goes somewhere else")
    created = S.stamp(now or datetime.now(UTC))
    name = f"macro-atlas-{S.unstamp(created):%Y%m%dT%H%M%SZ}.tar.gz"
    to.mkdir(parents=True, exist_ok=True)
    try:
        with _alone_in(to):
            return _backup(result, store, public, to, name, created, keep, wait)
    except _Refused as refusal:
        return result.refuse(str(refusal))


def _backup(result: Result, store: Path, public: Path, to: Path, name: str, created: str,
            keep: int, wait: float) -> Result:
    """With the backup directory held: whatever unfinished archive is in it is nobody's."""
    if (to / name).exists():
        return result.refuse(f"{to / name} exists; a backup never replaces one")
    part = to / f".{name}.part"
    try:
        with _between_runs(store, public, wait):
            for stale in to.glob(".macro-atlas-*.part"):
                stale.unlink()
            manifest = _write(part, store, public, created)
        _read_back(part)                               # the store's locks are free again; this only reads
        os.replace(part, to / name)
    except _Refused as refusal:
        part.unlink(missing_ok=True)
        return result.refuse(str(refusal))
    except _UNREADABLE as error:
        part.unlink(missing_ok=True)
        return result.refuse(f"the archive could not be written and read back ({error}); "
                             "no backup was kept and none was removed")
    result.archive = to / name
    sidecar = to / f"{name}.sha256"
    sidecar.with_name(f".{sidecar.name}.part").write_text(f"{_sha256(result.archive)}  {name}\n")
    os.replace(sidecar.with_name(f".{sidecar.name}.part"), sidecar)
    result.lines.append(f"backup: {result.archive}")
    result.lines.append(f"  {manifest['store']['files']} file(s) of the store, {manifest['public']['files']} of the "
                        f"{manifest['public']['profile'] or 'unmarked'} root, CURRENT {manifest['public']['current']}; "
                        f"{result.archive.stat().st_size} bytes; read back and whole")
    kept = sorted(path.name for path in to.iterdir() if _NAME.match(path.name))
    for old in kept[:-keep]:
        (to / old).unlink()
        (to / f"{old}.sha256").unlink(missing_ok=True)
        result.lines.append(f"  removed {old} (the newest {keep} are kept)")
    return result


def _empty(directory: Path) -> bool:
    return not directory.exists() or (directory.is_dir() and not directory.is_symlink()
                                      and not any(directory.iterdir()))


def restore(*, archive: Path, store: Path, public: Path) -> Result:
    result = Result()
    archive, store, public = Path(archive), Path(store), Path(public)
    if not archive.is_file():
        return result.refuse(f"{archive} is not a file")
    for directory in (store, public):
        if not _empty(directory):
            return result.refuse(f"{directory} is not empty; a restore never writes over a store or "
                                 "a root. Move it aside first (the runbook says how)")
    if R.overlaps(store, public):
        return result.refuse(f"{store} and {public} overlap")
    sidecar = archive.with_name(archive.name + ".sha256")
    if sidecar.is_file() and sidecar.read_text().split()[:1] != [_sha256(archive)]:
        return result.refuse(f"{archive.name} is not the bytes {sidecar.name} names; nothing was restored")
    if not hasattr(tarfile, "data_filter"):
        return result.refuse("this Python cannot unpack an archive safely (tarfile has no extraction "
                             "filter before 3.11.4); nothing was restored")
    store.parent.mkdir(parents=True, exist_ok=True)
    public.parent.mkdir(parents=True, exist_ok=True)
    # A directory of this run's own making: a second restore beside it never shares it,
    # and only what this run made is ever cleaned up.
    stage = Path(tempfile.mkdtemp(prefix=".restoring-", dir=store.parent))
    try:
        try:
            with tarfile.open(archive, "r:gz") as tar:
                tar.extractall(stage, filter="data")
            manifest = json.loads((stage / MANIFEST).read_bytes())
            if not isinstance(manifest, dict) or manifest.get("format") != 1:
                raise _Refused(f"{archive.name} has no {MANIFEST} this version can read")
            extra = sorted(path.name for path in stage.iterdir() if path.name not in ("store", "public", MANIFEST))
            if extra:
                raise _Refused(f"{archive.name} holds {extra[0]}, which is not part of a backup")
            _compare(manifest, {path.relative_to(stage).as_posix(): _sha256(path)
                                for part in ("store", "public") for path in sorted((stage / part).rglob("*"))
                                if path.is_file()})
        except _Refused as refusal:
            return result.refuse(f"{refusal}; nothing was restored")
        except _UNREADABLE as error:
            return result.refuse(f"{archive.name} cannot be read as a backup ({error}); nothing was restored")
        for part in ("store", "public"):
            (stage / part).mkdir(exist_ok=True)
        for directory in (store, public):
            if directory.exists():
                directory.rmdir()
        os.rename(stage / "store", store)
        try:
            os.rename(stage / "public", public)
        except OSError as error:
            os.rename(store, stage / "store")
            return result.refuse(f"{public} could not be put in place ({error}); the store was taken "
                                 "back out and nothing was restored")
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    result.lines.append(f"restore: {archive.name}, taken {manifest['created']}")
    result.lines.append(f"  {store}: {manifest['store']['files']} file(s); {public}: {manifest['public']['files']} "
                        f"file(s), CURRENT {manifest['public']['current']}; every file is the bytes the backup recorded")
    from .capture.cli import _verify
    from .publish.doctor import doctor

    said = io.StringIO()
    with contextlib.redirect_stdout(said):
        captures = _verify(store) if (store / S.FETCH_LOG).exists() else 0
    result.lines.extend(f"  {line}" for line in said.getvalue().splitlines())
    status, lines = doctor(root=public, store=store)
    result.lines.extend(f"  {line}" for line in lines)
    if captures or status:
        result.exit_code = 1
        result.lines.append("restore: the files are in place as they were backed up, but the checks above "
                            "did not pass; read them before anything is served from here")
    return result


def main(command: str, argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    parser = argparse.ArgumentParser(prog=f"atlas {command}", description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", help="the store (default $ATLAS_STORE, else var/store)")
    parser.add_argument("--public", help="the release root (default $ATLAS_PUBLIC, else var/public)")
    if command == "backup":
        parser.add_argument("--to", required=True, metavar="DIR", help="where the archive goes")
        parser.add_argument("--keep", type=int, default=KEEP, help=f"how many archives stay (default {KEEP})")
        parser.add_argument("--wait", type=float, default=0, metavar="SECONDS",
                            help="how long to wait for a refresh that is running (default 0: refuse at once)")
    else:
        parser.add_argument("--from", dest="archive", required=True, metavar="ARCHIVE")
    args = parser.parse_args(argv)
    store = Path(args.store) if args.store else R.home("store")
    public = Path(args.public) if args.public else R.home("public")
    if command == "backup":
        result = backup(store=store, public=public, to=Path(args.to), keep=args.keep, wait=args.wait)
    else:
        result = restore(archive=Path(args.archive), store=store, public=public)
    print("\n".join(result.lines))
    return result.exit_code
