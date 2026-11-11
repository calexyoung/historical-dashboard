"""Staging, validation and atomic promotion of a Release (PLAN 4.3, 4.4; M2).

The helper is shared: the legacy converter uses it now and the release writer (M9) will. A
Release is built in a staging directory, validated there, renamed into ``releases/`` and only
then named by ``CURRENT``. Anything that goes wrong leaves ``CURRENT`` as it was.
"""
import json
import shutil
import unittest.mock
from pathlib import Path

import pytest

from atlas import staging
from atlas.release import validate_release
from atlas.staging import PromotionRefused, promote, stage

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "fixtures" / "public"
FIXTURE_ID = (FIXTURE_ROOT / "CURRENT").read_text().strip()
FIXTURE = FIXTURE_ROOT / "releases" / FIXTURE_ID


def staged_fixture(root: Path) -> Path:
    """The (public-profile, synthetic) fixture release, staged under ``root``."""
    directory = stage(root, FIXTURE_ID)
    shutil.copytree(FIXTURE, directory, dirs_exist_ok=True)
    return directory


def test_a_staged_release_is_not_yet_visible(tmp_path):
    directory = staged_fixture(tmp_path)
    assert directory.name == FIXTURE_ID  # so the validator can check release_id against it
    assert not (tmp_path / "CURRENT").exists()
    assert not (tmp_path / "releases" / FIXTURE_ID).exists()


def test_promotion_moves_the_release_into_place_and_names_it_in_current(tmp_path):
    staged_fixture(tmp_path)
    promoted = promote(tmp_path, FIXTURE_ID, profile="public")
    assert promoted == tmp_path / "releases" / FIXTURE_ID
    assert validate_release(promoted) == []
    assert (tmp_path / "CURRENT").read_text() == FIXTURE_ID + "\n"
    assert not (tmp_path / ".staging" / FIXTURE_ID).exists()
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith("CURRENT")] == ["CURRENT"]


def test_a_release_that_breaks_the_contract_is_not_promoted_and_current_is_left_alone(tmp_path):
    (tmp_path / "CURRENT").write_text("20250101T000000Z-1111111\n")
    directory = staged_fixture(tmp_path)
    (directory / "catalog.json").write_text("{}")
    with pytest.raises(PromotionRefused, match="schema"):
        promote(tmp_path, FIXTURE_ID, profile="public")
    assert (tmp_path / "CURRENT").read_text() == "20250101T000000Z-1111111\n"
    assert not (tmp_path / "releases" / FIXTURE_ID).exists()
    assert not directory.exists()  # nothing half-made is left behind


def test_a_root_takes_only_the_profile_it_is_for(tmp_path):
    """The legacy converter's root is local: a public-profile Release cannot be promoted into it,
    and a local-profile one cannot be promoted into a public root (PLAN 6.1 point 2)."""
    staged_fixture(tmp_path)  # the fixture is public-profile
    with pytest.raises(PromotionRefused, match="profile"):
        promote(tmp_path, FIXTURE_ID, profile="local")
    assert not (tmp_path / "CURRENT").exists()

    directory = staged_fixture(tmp_path)
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest["profile"] = "local"
    (directory / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(PromotionRefused, match="profile"):
        promote(tmp_path, FIXTURE_ID, profile="public")
    assert not (tmp_path / "CURRENT").exists()


def test_a_promoted_release_is_never_overwritten(tmp_path):
    staged_fixture(tmp_path)
    promote(tmp_path, FIXTURE_ID, profile="public")
    before = (tmp_path / "releases" / FIXTURE_ID / "manifest.json").read_bytes()
    with pytest.raises(PromotionRefused, match="already"):
        stage(tmp_path, FIXTURE_ID)
    assert (tmp_path / "releases" / FIXTURE_ID / "manifest.json").read_bytes() == before


def test_staging_again_starts_clean(tmp_path):
    directory = staged_fixture(tmp_path)
    (directory / "left-over.json").write_text("{}")
    again = stage(tmp_path, FIXTURE_ID)
    assert list(again.iterdir()) == []


def test_only_a_release_id_can_be_staged(tmp_path):
    for bad in ("../escape", "releases", "20260101T000000Z", ""):
        with pytest.raises(PromotionRefused, match="release id"):
            stage(tmp_path, bad)


def test_a_failure_while_replacing_current_takes_the_release_back_out(tmp_path, monkeypatch):
    """The commit point is the replacement of CURRENT. Before it, nothing has happened: a
    release that was moved into place but never named is removed, so the id can be staged again."""
    (tmp_path / "CURRENT").write_text("20250101T000000Z-1111111\n")
    staged_fixture(tmp_path)
    def fail(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(staging.os, "replace", fail)
    with pytest.raises(PromotionRefused, match="CURRENT"):
        promote(tmp_path, FIXTURE_ID, profile="public")
    monkeypatch.undo()
    assert (tmp_path / "CURRENT").read_text() == "20250101T000000Z-1111111\n"
    assert not (tmp_path / "releases" / FIXTURE_ID).exists()
    assert [p.name for p in tmp_path.iterdir() if "CURRENT" in p.name] == ["CURRENT"]
    staged_fixture(tmp_path)
    promote(tmp_path, FIXTURE_ID, profile="public")  # and it can be done again


def test_a_staged_release_holds_plain_files_only(tmp_path):
    """A link could point outside the Release. The TypeScript reader refuses one; so does this."""
    directory = staged_fixture(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_bytes((directory / "series" / "fx_price_index.json").read_bytes())
    (directory / "series" / "fx_price_index.json").unlink()
    (directory / "series" / "fx_price_index.json").symlink_to(outside)
    with pytest.raises(PromotionRefused, match="not a regular file"):
        promote(tmp_path, FIXTURE_ID, profile="public")
    assert not (tmp_path / "CURRENT").exists()


def test_two_writers_cannot_both_promote_one_id(tmp_path):
    """The rename into releases/ is the no-clobber step: the loser is refused, not merged."""
    staged_fixture(tmp_path)
    winner = tmp_path / "releases" / FIXTURE_ID
    shutil.copytree(FIXTURE, winner)  # another writer got there between the check and the rename
    real_exists = staging.Path.exists
    staging_check = {"skipped": False}

    def exists(self):
        if self == winner and not staging_check["skipped"]:
            staging_check["skipped"] = True
            return False
        return real_exists(self)

    with unittest.mock.patch.object(staging.Path, "exists", exists), pytest.raises(PromotionRefused, match="already"):
        promote(tmp_path, FIXTURE_ID, profile="public")
    assert validate_release(winner) == []
    assert not (tmp_path / "CURRENT").exists()
