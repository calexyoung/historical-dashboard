"""Staging, validation and atomic promotion of a Release (PLAN 4.3, 4.4; M2).

The helper is shared: the legacy converter uses it now and the release writer (M9) will. A
Release is built in a staging directory, validated there, renamed into ``releases/`` and only
then named by ``CURRENT``. Anything that goes wrong leaves ``CURRENT`` as it was.
"""
import json
import shutil
from pathlib import Path

import pytest

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
