"""Staging, validation and atomic promotion of a Release (PLAN 4.3 and 4.4).

Whatever writes a Release (the legacy converter now, the release writer from M9) builds it in
``{root}/.staging/{release_id}/``, then calls ``promote``. Promotion validates the staged
directory against the Release contract, renames it into ``{root}/releases/`` and only then
replaces ``{root}/CURRENT`` in one atomic step. A failure at any point leaves ``CURRENT`` as it
was, so a reader keeps the last good Release.

The commit point is the replacement of ``CURRENT``. If that fails, the Release that was just
moved into ``releases/`` is taken back out, so nothing unnamed is left behind and the id can be
staged again. The rename into ``releases/`` is the no-clobber step: of two writers with one id,
the second is refused. (Serialising whole runs with ``LOCK`` is the publisher's job, M9.)

A root is for one Profile: ``promote`` is told which, and refuses a Release of the other kind,
so a local-profile Release cannot land in a public root (PLAN 6.1 point 2) whoever calls it.
"""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

from atlas.release import MANIFEST, validate_release

RELEASE_ID = re.compile(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}")
PROFILES = ("public", "local")
STAGING = ".staging"


class PromotionRefused(Exception):
    """A Release was not staged or promoted. ``CURRENT`` is unchanged."""


def _check_id(release_id: str) -> None:
    if not isinstance(release_id, str) or not RELEASE_ID.fullmatch(release_id):
        raise PromotionRefused(f"{release_id!r} is not a release id")


def _no_links(root: Path) -> None:
    """The staging area and ``releases/`` are real directories inside the root.

    A link in their place would let a Release be written or promoted somewhere else: into the
    store, or into a public root (PLAN 6.1 point 2). Checked before anything is written.
    """
    for name in (STAGING, "releases"):
        path = root / name
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise PromotionRefused(f"{path} is a link or not a directory; a release root holds real directories only")
        if path.exists() and path.resolve() != root.resolve() / name:
            raise PromotionRefused(f"{path} is reached through a link; a release root holds real directories only")


def stage(root: Path, release_id: str) -> Path:
    """An empty directory to build ``release_id`` in. Its name is the release id."""
    root = Path(root)
    _check_id(release_id)
    _no_links(root)
    if (root / "releases" / release_id).exists():
        raise PromotionRefused(f"release {release_id} is already promoted; a release is never rewritten")
    directory = root / STAGING / release_id
    if directory.is_symlink():
        raise PromotionRefused(f"{directory} is a link; a release is staged in a real directory")
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    return directory


def _write_current(root: Path, release_id: str) -> None:
    """Replace CURRENT in one step: a reader sees the old id or the new one, never a part."""
    temporary = root / f".CURRENT.tmp-{os.getpid()}"
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            handle.write(release_id + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, root / "CURRENT")
    finally:
        temporary.unlink(missing_ok=True)
    _sync_directory(root)


def _sync_directory(directory: Path) -> None:
    """Best effort: make a rename in ``directory`` durable. Not every platform allows it."""
    try:
        descriptor = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _irregular_file(directory: Path) -> str | None:
    """The first thing under ``directory`` that is neither a directory nor a plain file."""
    for path in sorted(directory.rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            return path.relative_to(directory).as_posix()
    return None


def promote(root: Path, release_id: str, *, profile: str) -> Path:
    """Validate the staged Release, move it into place and name it in CURRENT.

    ``profile`` is the Profile this root is for. Returns the promoted directory. Raises
    ``PromotionRefused``, with the staging directory removed and CURRENT untouched, when the
    Release breaks the contract, is of the other Profile, or already exists.
    """
    root = Path(root)
    _check_id(release_id)
    if profile not in PROFILES:
        raise PromotionRefused(f"unknown profile {profile!r}: only {', '.join(PROFILES)} exist")
    staged = root / STAGING / release_id
    target = root / "releases" / release_id
    try:
        _no_links(root)
        if staged.is_symlink() or not staged.is_dir():
            raise PromotionRefused(f"release {release_id} has not been staged")
        if target.exists():
            raise PromotionRefused(f"release {release_id} is already promoted; a release is never rewritten")
        odd = _irregular_file(staged)
        if odd:
            raise PromotionRefused(f"release {release_id}: {odd} is not a regular file")
        issues = validate_release(staged)
        if issues:
            more = f" (and {len(issues) - 1} more)" if len(issues) > 1 else ""
            raise PromotionRefused(f"release {release_id} breaks the contract: {issues[0]}{more}")
        found = json.loads((staged / MANIFEST).read_text(encoding="utf-8"))["profile"]
        if found != profile:
            raise PromotionRefused(
                f"this root takes {profile}-profile releases; release {release_id} has profile {found!r}"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.rename(staged, target)  # fails if another writer's release is already there
        except OSError as error:
            raise PromotionRefused(
                f"release {release_id} is already promoted; a release is never rewritten ({error.strerror})"
            ) from error
        _sync_directory(target.parent)
    except BaseException:
        shutil.rmtree(staged, ignore_errors=True)
        raise
    finally:
        try:
            staged.parent.rmdir()  # the staging area, when nothing else is being staged
        except OSError:
            pass
    try:
        _write_current(root, release_id)
    except BaseException as error:
        shutil.rmtree(target, ignore_errors=True)  # never named by CURRENT, so nobody has read it
        if isinstance(error, OSError):
            raise PromotionRefused(f"CURRENT could not be replaced ({error}); it is unchanged") from error
        raise
    return target
