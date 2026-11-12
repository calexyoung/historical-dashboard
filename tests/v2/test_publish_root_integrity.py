"""A release root is what the writer made it, or it is refused (PLAN 4.3 and 6.1; ADR 0023):
an unmarked root is not adopted with Releases already in it, nothing is deleted through a
link, and a file of the root's own that cannot be read is a refusal that names it, never a
traceback and never read as "nothing there"."""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest

from atlas.publish import pin, release, rollback
from atlas.publish import root as R
from atlas.publish.doctor import doctor

from .release_helpers import NOW, SERIES, build_store, current, read_json, write_register

HOUR = timedelta(hours=1)
DAY = timedelta(days=1)
OLD = "20250101T000000Z-aaaaaaa"


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


def publish(root, register, store, now=NOW, profile="public", **more):
    more.setdefault("legacy", False) if profile == "local" else None
    return release(profile=profile, root=root, store=store, register=register, series=SERIES, now=now, **more)


# --- an unmarked root ------------------------------------------------------------------------------


def test_a_public_release_does_not_adopt_an_unmarked_root_that_already_holds_releases(tmp_path, register, store):
    """root.json says what a root is for. Without it, a public release would move in beside
    whatever is there: an earlier local-profile Release would then sit in a public root."""
    root = tmp_path / "root"
    first = publish(root, register, store, profile="local")
    assert first.outcome == "promoted", first.lines
    (root / "root.json").unlink()

    refused = publish(root, register, store, now=NOW + HOUR)

    assert refused.outcome == "refused" and refused.exit_code == 1
    assert "root.json" in refused.lines[0] and first.release_id in refused.lines[0]
    assert not (root / "root.json").exists() and current(root) == first.release_id
    assert R.release_ids(root) == [first.release_id]


def test_nor_one_whose_releases_are_public_since_where_their_values_came_from_is_not_known(tmp_path, register, store):
    root = tmp_path / "root"
    first = publish(root, register, store)
    (root / "root.json").unlink()

    refused = publish(root, register, store, now=NOW + HOUR)

    assert refused.outcome == "refused" and "root.json" in refused.lines[0]
    assert R.release_ids(root) == [first.release_id]


def test_an_unmarked_local_root_of_local_releases_is_still_taken_up(tmp_path, register, store):
    """`atlas legacy-release` writes Releases and no root.json; `atlas release --profile local`
    goes on in the same root."""
    root = tmp_path / "root"
    first = publish(root, register, store, profile="local")
    (root / "root.json").unlink()

    second = publish(root, register, store, profile="local", now=NOW + HOUR)

    assert second.outcome == "promoted", second.lines
    assert read_json(root / "root.json")["profile"] == "local" and first.release_id in R.release_ids(root)


# --- links -----------------------------------------------------------------------------------------


def _elsewhere(tmp_path) -> Path:
    """A directory outside the root that looks like a trash whose one Release is due to go."""
    elsewhere = tmp_path / "elsewhere"
    (elsewhere / OLD).mkdir(parents=True)
    (elsewhere / OLD / "kept.txt").write_text("not the root's to delete")
    (elsewhere / f"{OLD}.json").write_text('{"format": 1, "trashed_at": "2025-01-01T00:00:00Z"}')
    return elsewhere


def test_nothing_is_deleted_through_a_trash_that_is_a_link(tmp_path, register, store):
    root = tmp_path / "public"
    first = publish(root, register, store)
    elsewhere = _elsewhere(tmp_path)
    (root / "trash").symlink_to(elsewhere, target_is_directory=True)

    refused = publish(root, register, store, now=NOW + HOUR, keep=1)

    assert refused.outcome == "refused" and "link" in refused.lines[0]
    assert (elsewhere / OLD / "kept.txt").read_text() == "not the root's to delete"
    assert (elsewhere / f"{OLD}.json").exists() and current(root) == first.release_id
    status, lines = doctor(root=root, store=store)
    assert status == 1 and any("trash is a link" in line for line in lines)


def test_pruning_itself_follows_no_link_and_deletes_only_what_is_named_as_a_release(tmp_path):
    root = tmp_path / "public"
    (root / "trash").mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "kept.txt").write_text("kept")
    # A due note whose directory is a link, and a due note whose name is no release id.
    (root / "trash" / OLD).symlink_to(outside, target_is_directory=True)
    (root / "trash" / f"{OLD}.json").write_text('{"format": 1, "trashed_at": "2025-01-01T00:00:00Z"}')
    (root / "trash" / "notes").mkdir()
    (root / "trash" / "notes" / "kept.txt").write_text("kept")
    (root / "trash" / "notes.json").write_text('{"format": 1, "trashed_at": "2025-01-01T00:00:00Z"}')

    R.prune(root, NOW)

    assert (outside / "kept.txt").read_text() == "kept"
    assert (root / "trash" / "notes" / "kept.txt").read_text() == "kept"

    (root / "trash").rename(root / "real-trash")
    (root / "trash").symlink_to(_elsewhere(tmp_path), target_is_directory=True)
    with pytest.raises(R.RootRefused, match="link"):
        R.prune(root, NOW)
    assert (tmp_path / "elsewhere" / OLD / "kept.txt").exists()


def test_recovery_moves_only_a_release_by_its_id(tmp_path, register, store):
    """STATUS.json is read back as a path. An id that is not one names nothing to move."""
    root = tmp_path / "public"
    first = publish(root, register, store)
    victim = tmp_path / "victim"
    victim.mkdir()
    (root / "STATUS.json").write_text(
        '{"format": 1, "outcome": "promoting", "release_id": "../../victim", "started": "2026-05-13T15:00:00Z"}')

    result = publish(root, register, store, now=NOW + HOUR)

    assert victim.is_dir() and not (root / "trash" / "victim").exists()
    assert result.outcome in ("promoted", "refused") and first.release_id in R.release_ids(root)


# --- the root's own files --------------------------------------------------------------------------


BROKEN = [
    ("root.json", '"x"'), ("root.json", "{bad"), ("root.json", "[]"),
    ("pins.json", "{bad"), ("pins.json", "[]"), ("pins.json", '{"pins": [{"x": 1}]}'),
    ("pins.json", '{"pins": [{"release_id": "../x"}]}'), ("pins.json", '{"pins": {}}'),
    ("withdrawn.json", "[1]"), ("withdrawn.json", '{"series": []}'), ("withdrawn.json", '{"series": {"fx_jobs": 3}}'),
    ("STATUS.json", "{bad"), ("STATUS.json", "[]"), ("STATUS.json", "null"),
    # There, and not holding what it exists to hold: never read as "none".
    ("pins.json", "null"), ("pins.json", "{}"), ("withdrawn.json", "null"), ("withdrawn.json", "{}"),
    ("saved.json", "{}"), ("saved.json", "[]"), ("root.json", "null"),
    ("pins.json", b"\xff\xfe not text"), ("root.json", b"\xff"),
]


@pytest.mark.parametrize("name, text", BROKEN)
def test_a_file_of_the_root_that_cannot_be_read_is_a_refusal_that_names_it(tmp_path, register, store, name, text):
    root = tmp_path / "public"
    first = publish(root, register, store)
    (root / name).write_bytes(text if isinstance(text, bytes) else text.encode())
    common = {"profile": "public", "root": root, "store": store, "register": register}

    results = [publish(root, register, store, now=NOW + HOUR),
               pin(release_id=first.release_id, reason="x", now=NOW + HOUR, **common),
               rollback(release_id=first.release_id, now=NOW + HOUR, **common)]

    for result in results:
        assert result.outcome == "refused" and result.exit_code == 1, result.lines
        assert name in result.lines[0]
    assert (root / name).read_bytes() == (text if isinstance(text, bytes) else text.encode())
    assert R.release_ids(root) == [first.release_id]
    status, lines = doctor(root=root, store=store)
    assert status == 1 and any(line.startswith("FAIL") and name in line for line in lines)


def test_a_pins_file_that_is_not_one_is_never_read_as_no_pins(tmp_path, register, store):
    """Read as empty, retention would trash a Release a Claim lock names."""
    root = tmp_path / "public"
    first = publish(root, register, store, keep=1)
    assert pin(release_id=first.release_id, reason="named by a claim lock", profile="public", root=root,
               store=store, register=register, now=NOW).outcome == "pinned"
    (root / "pins.json").write_text("[]")

    assert publish(root, register, store, now=NOW + HOUR, keep=1).outcome == "refused"
    assert first.release_id in R.release_ids(root)
