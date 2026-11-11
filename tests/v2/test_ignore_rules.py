"""Generated releases and v1's data files stay out of git and out of the Docker build context.

PLAN M0 acceptance and section 6.1 ('Build and CI'). This checks the ignore files themselves.
The test that inspects a built image for a seeded value arrives with the Dockerfile in M1.
"""
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RELEASE = "releases/20261111T154500Z-abc1234"

GENERATED = [
    f"var/local/{RELEASE}/manifest.json",
    f"var/local/{RELEASE}/series/spx.json",
    "var/local/CURRENT",
    f"var/public/{RELEASE}/manifest.json",
    f"var/public/{RELEASE}/downloads/observations.parquet",
    "var/public/CURRENT",
    "var/public/STATUS.json",
    "var/store/raw/bls/2026-11-11/0f0f.gz",
    "var/store/obslog/unrate.parquet",
    "var/staging/20261111T154500Z-abc1234/manifest.json",
]
V1_DATA = ["data/atlas.json", "data/raw/fred_UNRATE.csv", "data/seed/spx.csv", "dist/index.html", "web/app.js"]
COMMITTED = [
    "fixtures/public/CURRENT",
    "fixtures/public/releases/20260101T000000Z-0000000/manifest.json",
    "fixtures/public/releases/20260101T000000Z-0000000/series/fx_price_index.json",
    "schema/release.schema.json",
]


def git_ignores(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "-q", "--no-index", path], cwd=ROOT, check=False
    )
    assert result.returncode in (0, 1), result
    return result.returncode == 0


@pytest.mark.parametrize("path", GENERATED)
def test_git_ignores_every_generated_release_and_the_store(path):
    assert git_ignores(path)


@pytest.mark.parametrize("path", COMMITTED)
def test_git_does_not_ignore_the_fixture_release(path):
    assert not git_ignores(path)


def docker_excludes(path: str) -> bool:
    """Docker's .dockerignore rule: the last pattern that matches a path decides."""
    excluded = False
    parts = path.split("/")
    for line in (ROOT / ".dockerignore").read_text().splitlines():
        pattern = line.strip()
        if not pattern or pattern.startswith("#"):
            continue
        negated = pattern.startswith("!")
        pattern = pattern.lstrip("!").strip("/")
        if pattern == "*":
            hit = True
        elif pattern.startswith("**/"):
            hit = pattern[3:] in parts
        else:
            assert "*" not in pattern, f"this test does not understand the glob {pattern!r}"
            hit = path == pattern or path.startswith(pattern + "/")
        if hit:
            excluded = not negated
    return excluded


@pytest.mark.parametrize("path", GENERATED + V1_DATA + [".git/config", ".git/objects/ab/cdef"])
def test_docker_context_excludes_generated_releases_and_v1_data(path):
    assert docker_excludes(path)


@pytest.mark.parametrize("path", ["somewhere-new/atlas.json", "atlas.json", "releases/x/manifest.json"])
def test_docker_context_is_an_allowlist_so_a_new_path_is_excluded_by_default(path):
    assert docker_excludes(path)


def test_nothing_from_v1_or_a_generated_release_is_in_the_docker_context():
    tracked = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.splitlines()
    in_context = [p for p in tracked if not docker_excludes(p)]
    assert in_context, "the allowlist lets the workspace in"
    forbidden = ("data/", "dist/", "web/", "var/", ".git/", "tests/", "atlas/")
    assert [p for p in in_context if p.startswith(forbidden)] == []
    assert "package.json" in in_context
    assert "schema/release.schema.json" in in_context
