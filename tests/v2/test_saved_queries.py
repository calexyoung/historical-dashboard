"""Saved queries and ``atlas save`` (PLAN section 5 and M18; ADR 0032): an Explorer view kept
with a Pin and a note, in a local root.

Every value is invented (the vintage fixture). A decision in a register here is test data."""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest

from atlas.cli import main as atlas
from atlas.publish import release, save, unsave
from atlas.publish import root as R
from atlas.publish.saved import MAX_NOTE, NotSaved, canonical

from .release_helpers import NOW, ROOT, SERIES, build_store, read_json, write_register

HOUR = timedelta(hours=1)
VIEW = "s=fx_price&mode=lin&from=2026-01&to=2026-05&layers=none"
CASES = json.loads((ROOT / "checks" / "explorer-addresses.json").read_text())


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


@pytest.fixture
def root(tmp_path) -> Path:
    return tmp_path / "local"


def publish(root, register, store, now=NOW, profile="local", **more):
    return release(profile=profile, root=root, store=store, register=register, series=SERIES,
                   now=now, **({"legacy": False} if profile == "local" else {}), **more)


def others(root, register, store, profile="local"):
    return {"profile": profile, "root": root, "store": store, "register": register}


# --- what may be saved -----------------------------------------------------------------------------


@pytest.mark.parametrize("address", CASES["accepted"])
def test_an_address_the_explorer_writes_is_read_back_unchanged(address):
    view, pin = canonical(address)
    assert (f"{view}&pin={pin}" if pin else view) == address
    assert canonical(f"https://example.invalid/macro-atlas/explore?{address}") == (view, pin)


@pytest.mark.parametrize("address", CASES["rejected"])
def test_an_address_that_would_have_to_be_guessed_at_is_not_saved(address):
    with pytest.raises(NotSaved):
        canonical(address)


def test_a_v1_hash_link_is_not_an_address_of_this_explorer():
    with pytest.raises(NotSaved, match="#"):
        canonical("https://example.invalid/#sel=spx&mode=z")


# --- atlas save ------------------------------------------------------------------------------------


def test_a_saved_query_is_the_view_pinned_to_the_current_release_with_its_note(root, register, store):
    first = publish(root, register, store)
    result = save(address=f"http://localhost:3000/macro-atlas/explore?{VIEW}", note="Prices before the revision",
                  now=NOW + HOUR, **others(root, register, store))
    assert result.outcome == "saved" and result.release_id == first.release_id, result.lines
    [entry] = read_json(root / "saved.json")["saved"]
    assert entry["query"] == f"{VIEW}&pin={first.release_id}"
    assert entry["note"] == "Prices before the revision" and entry["release_id"] == first.release_id
    assert entry["id"].startswith("sq-") and entry["saved_at"].startswith("2026-05-13T16:07")
    assert f"/explore?{VIEW}&pin={first.release_id}" in "\n".join(result.lines)


def test_the_release_a_saved_query_names_survives_retention_until_the_query_is_removed(root, register, store):
    first = publish(root, register, store, keep=1)
    saved = save(address=VIEW, note="keep", **others(root, register, store))
    saved_id = read_json(root / "saved.json")["saved"][0]["id"]
    assert saved.outcome == "saved"
    second = publish(root, register, store, now=NOW + HOUR, keep=1)
    third = publish(root, register, store, now=NOW + 2 * HOUR, keep=1)
    assert R.release_ids(root) == [first.release_id, third.release_id]
    assert R.release_ids(root, "trash") == [second.release_id]
    assert not (root / "pins.json").exists()  # the saved query is its own Pin: one file, one write

    assert unsave(saved_id=saved_id, **others(root, register, store)).outcome == "unsaved"
    publish(root, register, store, now=NOW + 3 * HOUR, keep=1)
    assert first.release_id not in R.release_ids(root)


def test_a_view_already_pinned_is_saved_to_that_release_and_only_while_it_is_kept(root, register, store):
    first = publish(root, register, store)
    publish(root, register, store, now=NOW + HOUR)
    result = save(address=f"{VIEW}&pin={first.release_id}", note="the earlier figures", **others(root, register, store))
    assert result.release_id == first.release_id
    gone = save(address=f"{VIEW}&pin=20200101T000000Z-fffffff", note="x", **others(root, register, store))
    assert gone.outcome == "refused" and len(read_json(root / "saved.json")["saved"]) == 1


def test_a_note_never_enters_a_public_root(tmp_path, register, store):
    public = tmp_path / "public"
    assert publish(public, register, store, profile="public").exit_code == 0
    result = save(address=VIEW, note="mine", **others(public, register, store, profile="public"))
    assert result.outcome == "refused" and "atlas pin" in result.lines[0]
    assert not (public / "saved.json").exists()


@pytest.mark.parametrize("address, note", [
    ("s=fx_price", "the defaults would decide the rest"),
    (VIEW, ""),
    (VIEW, "x" * (MAX_NOTE + 1)),
    (VIEW, "two\nlines"),
    (f"{VIEW}&as_of=soon", "unreadable as-of"),
])
def test_what_cannot_be_kept_exactly_is_refused_and_nothing_is_written(root, register, store, address, note):
    publish(root, register, store)
    assert save(address=address, note=note, **others(root, register, store)).outcome == "refused"
    assert not (root / "saved.json").exists()


def test_the_command_line_saves_lists_and_removes(root, register, store, capsys):
    publish(root, register, store)
    common = ["--profile", "local", "--out", str(root), "--store", str(store), "--register", str(register)]
    assert atlas(["save", VIEW, "--note", "from the command line", *common]) == 0
    saved_id = read_json(root / "saved.json")["saved"][0]["id"]
    assert atlas(["save", "--list", *common]) == 0
    out = capsys.readouterr().out
    assert saved_id in out and "from the command line" in out and "1 saved query" in out
    assert atlas(["save", "--remove", saved_id, *common]) == 0
    assert read_json(root / "saved.json")["saved"] == []
    assert atlas(["save", "--remove", saved_id, *common]) == 1
