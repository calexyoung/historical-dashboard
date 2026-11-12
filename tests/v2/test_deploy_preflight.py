"""The deploy preflight (PLAN 6.1 point 5 "Deploy", 4.8 and M26): ``atlas doctor --surface
production`` is the first thing a production deploy runs, and it refuses three things.

Each test starts from the same root, which the preflight passes (the control below), changes
one thing, and reads the reason: a refusal for some other cause would prove nothing. The root
is the committed fixture Release (invented values), marked by hand as an agency's and judged
by a register that signs the fixture's made-up Origin, because the committed register rightly
signs no such row."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from atlas.cli import main as atlas_main
from atlas.publish import root as R
from atlas.rights import RightsGate

from .release_helpers import ROOT, fixture_table, read_json

FIXTURE_RELEASE = ROOT / "fixtures" / "public" / "releases" / "20260101T000000Z-0000000"
OLDER = "20251201T000000Z-0000000"
LEGACY = "legacy_monthly_rounded"


@pytest.fixture
def root(tmp_path, monkeypatch) -> Path:
    directory = tmp_path / "public"
    shutil.copytree(FIXTURE_RELEASE, directory / "releases" / FIXTURE_RELEASE.name)
    (directory / "CURRENT").write_text(FIXTURE_RELEASE.name + "\n")
    R.replace_json(directory / "root.json", {"format": 1, "profile": "public", "real_bytes": True})
    monkeypatch.setattr("atlas.publish.doctor._committed_gate", lambda: RightsGate(fixture_table(datasets="*")))
    return directory


def preflight(root: Path, capsys, surface: str = "production") -> tuple[int, str]:
    """The command deploy/deploy.sh runs, as it runs it."""
    capsys.readouterr()
    status = atlas_main(["doctor", "--surface", surface, "--root", str(root)])
    return status, capsys.readouterr().out


def rewrite(release: Path, name: str, change) -> None:
    document = read_json(release / name)
    change(document)
    (release / name).write_text(json.dumps(document))


def current(root: Path) -> Path:
    return root / "releases" / FIXTURE_RELEASE.name


def make_local(release: Path, **more) -> None:
    """A local-profile Release that is whole by its own rules: it says so, and it has no bulk
    files, which only a public-profile Release is given."""
    shutil.rmtree(release / "downloads")
    rewrite(release, "manifest.json", lambda manifest: manifest.update(profile="local", **more))


def test_control_the_root_these_tests_start_from_passes_the_preflight(root, capsys):
    status, out = preflight(root, capsys)

    assert status == 0, out
    assert "is public-profile, holds no legacy Series, and is permitted by the committed rights register" in out
    assert out.rstrip().endswith("doctor: nothing wrong")


def test_the_production_preflight_refuses_a_local_profile_release(root, capsys):
    make_local(current(root))

    status, out = preflight(root, capsys)

    assert status == 1
    assert f"FAIL  release {FIXTURE_RELEASE.name} has profile 'local' in a public root" in out
    assert out.count("FAIL  ") == 1 and "legacy" not in out and "unsigned" not in out


def test_the_production_preflight_refuses_an_unsigned_register(root, capsys, monkeypatch):
    """Twice over: a Release whose manifest says it was built under an unsigned register, and
    a Release built under a signed one whose row is not signed in the committed register
    today. The second is what every agency row but the signed ones looks like now."""
    release = current(root)
    kept = (release / "manifest.json").read_bytes()
    rewrite(release, "manifest.json", lambda manifest: manifest["rights_register"].update(signed=False))

    status, out = preflight(root, capsys)

    assert status == 1
    assert "a public release must name a signed rights register" in out
    assert "legacy" not in out and "profile 'local'" not in out

    (release / "manifest.json").write_bytes(kept)
    monkeypatch.setattr("atlas.publish.doctor._committed_gate", lambda: RightsGate(fixture_table(datasets="*", decision=None)))

    status, out = preflight(root, capsys)

    assert status == 1
    assert "the rights register row for Macro Atlas fixture (synthetic)" in out and "is not signed" in out
    assert "so it is not permitted on the production surface" in out


def test_the_production_preflight_refuses_a_release_holding_a_legacy_series(root, capsys):
    """A Release that is whole in every other way: the Series says it is legacy in its own
    file, in the Catalog and in the manifest, and the manifest names the file's new hash."""
    release, key = current(root), "fx_vote_margin"
    rewrite(release, f"series/{key}.json", lambda series: series.update(representation=LEGACY))
    body = (release / "series" / f"{key}.json").read_bytes()
    rewrite(release, "manifest.json", lambda manifest: manifest["series"][key].update(
        representation=LEGACY, sha256=hashlib.sha256(body).hexdigest()))
    rewrite(release, "catalog.json", lambda catalog: next(
        entry for entry in catalog["series"] if entry["key"] == key).update(representation=LEGACY))

    status, out = preflight(root, capsys)

    assert status == 1
    assert "fx_vote_margin is in v1's legacy representation, which is never public" in out
    assert "unsigned" not in out and "profile 'local'" not in out


def test_the_preflight_reads_every_release_a_reader_could_open_not_only_current(root, capsys):
    """A rollback or a pin opens an older Release. One that may not be served fails the
    deploy although CURRENT is fine."""
    older = root / "releases" / OLDER
    shutil.copytree(current(root), older)
    make_local(older, release_id=OLDER)

    status, out = preflight(root, capsys)

    assert status == 1
    assert f"CURRENT names {FIXTURE_RELEASE.name}, a valid public-profile release" in out
    assert f"FAIL  release {OLDER} has profile 'local' in a public root" in out


def test_staging_is_held_to_the_same_three_refusals(root, capsys):
    assert preflight(root, capsys, "staging")[0] == 0
    make_local(current(root))

    status, out = preflight(root, capsys, "staging")

    assert status == 1 and "has profile 'local' in a public root" in out
    assert "A local-profile release behind a password is the deploy step's to prove" in out
