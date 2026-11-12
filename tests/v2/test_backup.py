"""``atlas backup`` and ``atlas restore`` (PLAN 4.3, 4.8 and M26; ADR 0040): one archive of
the store and a release root, taken while no run is half-way, and put back only whole.

M26's acceptance: backup then restore reproduces a working STORE and PUBLIC, and a locked
Claim shows its original numbers. The world is M20's: the three-fetch fixture (invented
values, a made-up Origin), a Claim locked on 11 March 2026 when January's jobs were 150000,
and a revision on 10 April that makes them 150010."""
from __future__ import annotations

import fcntl
import hashlib
import io
import json
import os
import shutil
import tarfile
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from atlas import backup as B
from atlas.cli import main as atlas_main
from atlas.content import claims as K
from atlas.publish import claims as PC
from atlas.publish import release
from atlas.publish.doctor import doctor
from atlas.release import validate_release
from atlas.vintage.store import VintageStore

from .claim_helpers import claim, write_claim
from .release_helpers import build_store, current, read_json, series_with_recipes, write_register

RELEASED = datetime(2026, 3, 11, 15, 0, 0, tzinfo=UTC)
CHECKED = datetime(2026, 3, 11, 16, 0, 0, tzinfo=UTC)
LATER = datetime(2026, 4, 11, 15, 0, 0, tzinfo=UTC)
TAKEN = datetime(2026, 4, 12, 7, 15, 0, tzinfo=UTC)
JOBS = {"id": "jobs-in-january", "series": "fx_jobs", "transform": "lin", "measure": "value_at", "period": "2026-01"}
ID = "2026-03-11-an-invented-official-on-jobs"


def record(**changes) -> dict:
    return claim(**{"id": ID, "said_on": "2026-03-11", "checked_on": "2026-03-11", "readings": [JOBS],
                    "quote": "There were 150 thousand invented jobs in January.", **changes})


def tree(directory: Path) -> dict[str, bytes]:
    """Every file under a directory by name, but for the lock files, which hold nothing."""
    return {path.relative_to(directory).as_posix(): path.read_bytes()
            for path in sorted(Path(directory).rglob("*"))
            if path.is_file() and path.name not in ("LOCK", B.REFRESH_LOCK)}


def figures(row: dict) -> list:
    return [(f["name"], f["value"], f["status"]) for f in row["figures"]]


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    """A store and one root of each Profile, each holding a Claim locked before a Revision
    and a Release written after it."""
    tmp = tmp_path_factory.mktemp("world")
    register = write_register(tmp / "register.json")
    store = build_store(tmp / "store", register, "1-initial")
    # The local root has its own content directory: a Claim locked in the repository is
    # locked for every Profile, and here each root is to carry a lock of its own kind.
    contents = {"public": tmp / "content", "local": tmp / "content-local"}
    w = {"tmp": tmp, "register": register, "store": store, "content": contents["public"],
         "series": series_with_recipes(tmp / "series.json")}

    def publish(profile: str, now: datetime, **more):
        result = release(profile=profile, root=tmp / profile, store=store, register=register,
                         series=w["series"], now=now, content=contents[profile], manual=tmp / "no-manual",
                         **({"legacy": False} if profile == "local" else {}), **more)
        assert result.exit_code == 0, result.lines

    for profile in ("public", "local"):
        write_claim(contents[profile], record())
        publish(profile, RELEASED)
        computed = PC.compute(claim_id=ID, profile=profile, root=tmp / profile, store=store, register=register,
                              content=contents[profile], now=CHECKED)
        assert computed.exit_code == 0, computed.lines
        write_claim(contents[profile], record(status="public"))
        publish(profile, CHECKED, reuse_data=True)
    build_store(store, register, "2-revision")                 # January becomes 150010, final
    for profile in ("public", "local"):
        publish(profile, LATER)
    return w


@pytest.fixture(scope="module")
def archive(world) -> Path:
    result = B.backup(store=world["store"], public=world["tmp"] / "public", to=world["tmp"] / "backups", now=TAKEN)
    assert result.exit_code == 0, result.lines
    return result.archive


def restored(archive: Path, into: Path):
    result = B.restore(archive=archive, store=into / "store", public=into / "public")
    return result


# --- the acceptance criterion ----------------------------------------------------------------------


def test_backup_then_restore_gives_back_the_store_and_the_root_byte_for_byte(world, archive, tmp_path):
    result = restored(archive, tmp_path)

    assert result.exit_code == 0, result.lines
    assert tree(tmp_path / "store") == tree(world["store"])
    assert tree(tmp_path / "public") == tree(world["tmp"] / "public")
    assert archive.name == "macro-atlas-20260412T071500Z.tar.gz"
    assert any("every file is the bytes the backup recorded" in line for line in result.lines)


def test_the_restored_store_and_root_work_a_release_can_be_written_from_them(world, archive, tmp_path):
    """Working, not only identical: doctor passes, the store answers, and the release writer
    promotes a Release from the restored store into the restored root."""
    assert restored(archive, tmp_path).exit_code == 0
    store, root = tmp_path / "store", tmp_path / "public"
    before = current(root)

    status, lines = doctor(root=root, store=store)
    assert status == 0, lines
    assert VintageStore(store).vintage("fx_jobs") == VintageStore(world["store"]).vintage("fx_jobs")
    made = release(profile="public", root=root, store=store, register=world["register"], series=world["series"],
                   now=LATER + timedelta(days=1), content=world["content"], manual=tmp_path / "no-manual")

    assert made.exit_code == 0, made.lines
    assert current(root) == made.release_id != before
    assert validate_release(root / "releases" / made.release_id) == []
    old, new = (read_json(root / "releases" / name / "manifest.json")["series"]["fx_jobs"]["sha256"]
                for name in (before, made.release_id))
    assert old == new                                           # the same values, from the restored store


def test_a_locked_claim_shows_its_original_numbers_after_a_restore(world, archive, tmp_path):
    """The lock was written when January was 150000, preliminary. The store has since been
    revised. After a restore the lock in the Release is the bytes written then; only the
    latest row carries the revision."""
    assert restored(archive, tmp_path).exit_code == 0
    directory = tmp_path / "public" / "releases" / current(tmp_path / "public")

    written = (world["content"] / "claims" / "locks" / K.lock_name(ID, 1)).read_bytes()
    kept = (directory / "locks" / K.lock_name(ID, 1)).read_bytes()
    assert kept == written
    lock, problems = K.read_lock(kept, K.lock_name(ID, 1))
    assert problems == []
    (reading,) = lock["readings"]
    assert figures(reading["then"]) == [("value", 150000, "preliminary")]
    assert figures(reading["now_when_checked"]) == [("value", 150000, "preliminary")]
    (entry,) = read_json(directory / "evidence" / "latest.json")["claims"]
    assert figures(entry["readings"][0]["latest"]) == [("value", 150010, "final")]


def test_a_local_root_keeps_its_own_locks_through_a_backup(world, tmp_path):
    """A local-profile root holds its locks beside its Releases, in no repository: the backup
    is the only other copy."""
    local = world["tmp"] / "local"
    made = B.backup(store=world["store"], public=local, to=tmp_path / "backups", now=TAKEN)
    assert made.exit_code == 0, made.lines

    result = restored(made.archive, tmp_path / "back")

    assert result.exit_code == 0, result.lines
    kept = tmp_path / "back" / "public" / "locks" / K.lock_name(ID, 1)
    assert kept.read_bytes() == (local / "locks" / K.lock_name(ID, 1)).read_bytes()
    (reading,) = read_json(kept)["readings"]
    assert figures(reading["now_when_checked"]) == [("value", 150000, "preliminary")]


def test_releases_that_share_their_data_files_still_share_them_after_a_restore(world, archive, tmp_path):
    assert restored(archive, tmp_path).exit_code == 0
    releases = sorted((tmp_path / "public" / "releases").iterdir())
    first, reused = releases[0], releases[1]                    # the second was --reuse-data

    assert read_json(reused / "manifest.json")["reused_data_from"] == first.name
    assert (first / "series" / "fx_jobs.json").stat().st_ino == (reused / "series" / "fx_jobs.json").stat().st_ino


# --- a backup is taken whole or not at all ---------------------------------------------------------


def test_a_backup_is_refused_while_a_run_holds_the_store_or_the_root(world, tmp_path):
    for holder in (world["store"] / "LOCK", world["tmp"] / "public" / "LOCK", world["store"] / B.REFRESH_LOCK):
        with open(holder, "a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

            result = B.backup(store=world["store"], public=world["tmp"] / "public", to=tmp_path / "backups", now=TAKEN)

        assert result.exit_code == 1 and "a run is in progress" in "\n".join(result.lines), holder
    assert [path.name for path in (tmp_path / "backups").iterdir()] == [B.BACKUP_LOCK]


def test_what_a_backup_leaves_out_and_what_it_names(world, archive):
    with tarfile.open(archive) as tar:
        names = [member.name for member in tar.getmembers() if not member.isdir()]
        manifest = json.load(tar.extractfile(B.MANIFEST))

    assert names[-1] == B.MANIFEST
    assert not [name for name in names if Path(name).name in ("LOCK", B.REFRESH_LOCK)]
    assert not [name for name in names if ".staging" in name or name.startswith("public/trash")]
    assert manifest["format"] == 1 and manifest["created"] == "2026-04-12T07:15:00Z"
    assert manifest["public"]["current"] == current(world["tmp"] / "public")
    assert manifest["public"]["profile"] == "public"
    assert sorted(manifest["files"]) == sorted(name for name in names if name != B.MANIFEST)
    sidecar = archive.with_name(archive.name + ".sha256").read_text()
    assert sidecar == f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n"


def test_a_root_with_a_link_in_it_is_not_backed_up(world, tmp_path):
    root = tmp_path / "public"
    shutil.copytree(world["tmp"] / "public", root, symlinks=True)
    os.symlink(tmp_path, root / "releases" / "elsewhere")

    result = B.backup(store=world["store"], public=root, to=tmp_path / "backups", now=TAKEN)

    assert result.exit_code == 1 and "is a link" in "\n".join(result.lines)
    assert not list((tmp_path / "backups").glob("*.tar.gz"))


def test_only_the_newest_backups_are_kept_and_only_once_a_new_one_is_whole(world, tmp_path):
    to = tmp_path / "backups"
    paths = []
    for day in range(4):
        result = B.backup(store=world["store"], public=world["tmp"] / "public", to=to,
                          now=TAKEN + timedelta(days=day), keep=2)
        assert result.exit_code == 0, result.lines
        paths.append(result.archive)
    (to / "notes.txt").write_text("not a backup")

    assert sorted(path.name for path in to.iterdir() if path.name != B.BACKUP_LOCK) == sorted(
        [paths[2].name, paths[2].name + ".sha256", paths[3].name, paths[3].name + ".sha256", "notes.txt"])
    refused = B.backup(store=world["store"], public=world["tmp"] / "public", to=to, now=TAKEN, keep=0)
    assert refused.exit_code == 1 and "at least one" in "\n".join(refused.lines)
    # A backup that could not be taken prunes nothing.
    with open(world["store"] / "LOCK", "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        B.backup(store=world["store"], public=world["tmp"] / "public", to=to, now=TAKEN + timedelta(days=9), keep=1)
    assert paths[2].exists() and paths[3].exists()


def test_two_backups_into_one_directory_never_touch_each_others_unfinished_archive(world, tmp_path):
    """One backup has let the store go and is reading its archive back; a second arrives. It
    is refused, and the first one's unfinished file is still there."""
    to = tmp_path / "backups"
    to.mkdir()
    unfinished = to / ".macro-atlas-20260412T071500Z.tar.gz.part"
    unfinished.write_bytes(b"the first backup's, still being read back")
    with open(to / B.BACKUP_LOCK, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

        result = B.backup(store=world["store"], public=world["tmp"] / "public", to=to, now=TAKEN)

    assert result.exit_code == 1 and "another backup is writing" in "\n".join(result.lines)
    assert unfinished.read_bytes() == b"the first backup's, still being read back"
    # With nobody holding the directory, an unfinished archive is a dead run's and goes.
    assert B.backup(store=world["store"], public=world["tmp"] / "public", to=to, now=TAKEN).exit_code == 0
    assert not unfinished.exists()


def test_a_backup_told_to_wait_is_taken_when_the_refresh_ends(world, tmp_path):
    with open(world["store"] / B.REFRESH_LOCK, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        threading.Timer(0.3, lambda: fcntl.flock(handle, fcntl.LOCK_UN)).start()

        result = B.backup(store=world["store"], public=world["tmp"] / "public", to=tmp_path / "backups",
                          now=TAKEN, wait=20)

    assert result.exit_code == 0, result.lines


def test_a_backup_is_never_written_inside_what_it_backs_up(world):
    result = B.backup(store=world["store"], public=world["tmp"] / "public", to=world["store"] / "backups", now=TAKEN)

    assert result.exit_code == 1 and "inside" in "\n".join(result.lines)
    assert not (world["store"] / "backups").exists()


# --- a restore puts back everything or nothing -----------------------------------------------------


def test_a_restore_never_writes_over_a_store_or_a_root_that_is_there(world, archive, tmp_path):
    (tmp_path / "store").mkdir()
    (tmp_path / "store" / "fetchlog.ndjson").write_text("what is there\n")

    result = restored(archive, tmp_path)

    assert result.exit_code == 1 and "is not empty" in "\n".join(result.lines)
    assert tree(tmp_path / "store") == {"fetchlog.ndjson": b"what is there\n"}
    assert not (tmp_path / "public").exists()
    assert [path.name for path in tmp_path.iterdir()] == ["store"]      # nothing left beside it


@pytest.mark.parametrize("sidecar", [True, False])
def test_a_damaged_archive_restores_nothing(world, archive, tmp_path, sidecar):
    copy = tmp_path / archive.name
    data = bytearray(archive.read_bytes())
    data[len(data) // 2] ^= 0xFF
    copy.write_bytes(bytes(data))
    if sidecar:
        shutil.copy(archive.with_name(archive.name + ".sha256"), tmp_path)

    result = restored(copy, tmp_path / "back")

    assert result.exit_code == 1, result.lines
    assert "REFUSED" in "\n".join(result.lines)
    assert not (tmp_path / "back" / "store").exists() and not (tmp_path / "back" / "public").exists()


def test_an_archive_whose_file_is_not_the_bytes_its_manifest_names_restores_nothing(world, archive, tmp_path):
    """A valid archive, rebuilt with one file changed: only the manifest inside can tell."""
    forged = tmp_path / archive.name
    with tarfile.open(archive) as source, tarfile.open(forged, "w:gz") as target:
        for member in source.getmembers():
            if member.isfile() and member.name == "store/fetchlog.ndjson":
                body = source.extractfile(member).read().replace(b"captured", b"CAPTURED")
                member.size = len(body)
                target.addfile(member, io.BytesIO(body))
            else:
                target.addfile(member, source.extractfile(member) if member.isfile() else None)

    other = tmp_path / "back" / ".restoring-1"                  # another restore's, beside this one
    other.mkdir(parents=True)
    (other / "half").write_text("unpacked so far")

    result = restored(forged, tmp_path / "back")

    assert other.is_dir() and (other / "half").read_text() == "unpacked so far"
    shutil.rmtree(other)
    assert result.exit_code == 1 and "store/fetchlog.ndjson is not the bytes" in "\n".join(result.lines)
    assert not (tmp_path / "back" / "store").exists() and not (tmp_path / "back" / "public").exists()
    assert not list((tmp_path / "back").glob(".restoring*"))


def test_the_commands_the_wrappers_run(world, tmp_path, capsys):
    to = tmp_path / "backups"
    assert atlas_main(["backup", "--store", str(world["store"]), "--public", str(world["tmp"] / "public"),
                       "--to", str(to), "--keep", "3"]) == 0
    (made,) = to.glob("*.tar.gz")
    assert f"backup: {made}" in capsys.readouterr().out

    assert atlas_main(["restore", "--from", str(made), "--store", str(tmp_path / "s"), "--public", str(tmp_path / "p")]) == 0
    out = capsys.readouterr().out
    assert "doctor: nothing wrong" in out and "all present and unaltered" in out
    assert tree(tmp_path / "s") == tree(world["store"])
