"""The Claim slice, end to end (PLAN 4.4 step 4, 4.5 and M20; ADR 0011, ADR 0034): a Claim is
recorded, its evidence computed by the engine and frozen in a lock, and every Release after
that recomputes only the *latest* row and reports the drift.

The store is M8's three-fetch fixture (invented values, a made-up Origin). Its first fetch,
on 10 March 2026, holds jobs for January 150000 and February 150120, both preliminary; its
second, on 10 April, revises January to 150010 final and adds March. The Claim and its
claimant are invented."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from atlas import cli
from atlas.content import claims as K
from atlas.publish import claims as PC
from atlas.publish import release, withdraw
from atlas.publish import root as R
from atlas.release import load_release, validate_release
from atlas.rights import RightsGate

from .claim_helpers import claim, write_claim
from .release_helpers import (MAKE, all_bytes, build_store, current, fixture_table, read_json,
                              series_with_recipes, write_register)

RELEASED = datetime(2026, 3, 11, 15, 0, 0, tzinfo=UTC)
CHECKED = datetime(2026, 3, 11, 16, 0, 0, tzinfo=UTC)
LATER = datetime(2026, 4, 11, 15, 0, 0, tzinfo=UTC)
JOBS = {"id": "jobs-in-january", "series": "fx_jobs", "transform": "lin", "measure": "value_at", "period": "2026-01"}
RATIO = {"id": "jobs-per-point", "series": "fx_jobs_per_price", "transform": "lin", "measure": "value_at", "period": "2026-02"}
RISE = {"id": "rise", "series": "fx_jobs", "transform": "lin", "measure": "change",
        "window": {"from": "2026-01-01", "to": "2026-02-28"}}


def record(**changes) -> dict:
    return claim(**{"id": "2026-03-11-an-invented-official-on-jobs", "said_on": "2026-03-11", "checked_on": "2026-03-11",
                    "readings": [JOBS, RATIO, RISE], "quote": "There were 150 thousand invented jobs in January.", **changes})


ID = record()["id"]


@pytest.fixture
def world(tmp_path):
    """A store after the first fetch, a register that signs the made-up Origin, a content
    directory with one draft Claim, and a first Release of each Profile."""
    register = write_register(tmp_path / "register.json")
    store = build_store(tmp_path / "store", register, "1-initial")
    content = tmp_path / "content"
    write_claim(content, record())
    w = {"tmp": tmp_path, "register": register, "store": store, "content": content,
         "series": series_with_recipes(tmp_path / "series.json")}
    for profile in ("public", "local"):
        assert publish(w, profile).exit_code == 0
    return w


def publish(w, profile: str, now: datetime = RELEASED, **more):
    return release(profile=profile, root=w["tmp"] / profile, store=w["store"], register=w["register"],
                   series=w["series"], now=now, content=w["content"], manual=w["tmp"] / "no-manual",
                   **({"legacy": False} if profile == "local" else {}), **more)


def compute(w, profile: str = "public", now: datetime = CHECKED, **more):
    return PC.compute(claim_id=ID, profile=profile, root=w["tmp"] / profile, store=w["store"],
                      register=w["register"], content=w["content"], now=now, **more)


def relock(w, reason: str, profile: str = "public", now: datetime = CHECKED):
    return PC.relock(claim_id=ID, reason=reason, profile=profile, root=w["tmp"] / profile, store=w["store"],
                     register=w["register"], content=w["content"], now=now)


def locks_dir(w, profile: str = "public") -> Path:
    return w["content"] / "claims" / "locks" if profile == "public" else w["tmp"] / "local" / "locks"


def lock_path(w, version: int = 1, profile: str = "public") -> Path:
    return locks_dir(w, profile) / K.lock_name(ID, version)


def directory(w, profile: str = "public") -> Path:
    return w["tmp"] / profile / "releases" / current(w["tmp"] / profile)


def figures(row: dict) -> list:
    return [(f["name"], f["value"]) for f in row["figures"]]


def make_public(w) -> None:
    write_claim(w["content"], record(status="public"))


# --- compute ---------------------------------------------------------------------------------------


def test_compute_writes_a_lock_with_everything_plan_4_5_lists(world):
    result = compute(world)
    assert result.exit_code == 0, result.lines
    lock, problems = K.read_lock(lock_path(world).read_bytes(), lock_path(world).name)
    assert problems == []
    first = current(world["tmp"] / "public")
    assert lock["version"] == 1 and lock["reason"] is None and lock["supersedes"] is None
    assert lock["locked_at"] == "2026-03-11T16:00:00Z"
    assert lock["release"] == {"release_id": first, "created": "2026-03-11T15:00:00Z", "profile": "public"}
    assert lock["record"] == K.record(record()) and lock["record_sha256"] == K.record_sha256(record())
    assert lock["semantics_version"] == "0.7.0"
    assert lock["rights_used"] == [
        {"origin": MAKE.ORIGIN, "dataset": "fixture jobs", "channel": "computed", "representation": "native"},
        {"origin": MAKE.ORIGIN, "dataset": "fixture jobs", "channel": "fixture", "representation": "native"},
        {"origin": MAKE.ORIGIN, "dataset": "fixture prices", "channel": "fixture", "representation": "native"}]
    jobs, ratio, rise = lock["readings"]
    assert (jobs["series"], jobs["freq"], jobs["unit"], jobs["recipe"]) == ("fx_jobs", "monthly", "thousands of persons", None)
    assert jobs["periods"] == [{"period": "2026-01", "start": "2026-01-01", "end": "2026-01-31"}]
    # then: what was public before 00:00 New York on the day it was said; the Basis says how that is known.
    then = jobs["then"]
    assert figures(then) == [("value", 150000)] and then["figures"][0]["status"] == "preliminary"
    assert (then["as_of"], then["basis"], then["cutoff"]["instant"]) == ("2026-03-11", "atlas_observed", "2026-03-11T04:00:00Z")
    assert then["inputs"][0]["last_capture"] == "2026-03-10T13:30:01Z"
    # now when checked: the Release's own state; it claims no Basis.
    now = jobs["now_when_checked"]
    assert figures(now) == [("value", 150000)] and (now["as_of"], now["basis"], now["release_id"]) == (None, None, first)
    assert ratio["recipe"]["rests_on"] == ["fx_jobs", "fx_price"] and ratio["recipe"]["recipe"]["op"] == "ratio"
    assert figures(ratio["then"])[0][1] == pytest.approx(150120 / 100.4)
    assert rise["window"]["periods"] == [{"period": "2026-01", "start": "2026-01-01", "end": "2026-01-31"},
                                         {"period": "2026-02", "start": "2026-02-01", "end": "2026-02-28"}]
    assert figures(rise["now_when_checked"]) == [("start", 150000), ("end", 150120), ("change", 120), ("pct_change", pytest.approx(0.08))]
    # The Release the numbers came from is kept through retention.
    assert first in R.kept_by_name(world["tmp"] / "public")
    assert any(line.startswith(f"LOCKED {ID} v1") for line in result.lines)


def test_compute_refuses_to_overwrite_a_lock(world):
    assert compute(world).exit_code == 0
    before = lock_path(world).read_bytes()
    again = compute(world)
    assert again.exit_code == 1 and "relock" in " ".join(again.lines)
    assert lock_path(world).read_bytes() == before and not lock_path(world, 2).exists()


def test_compute_holds_the_claim_to_the_day_it_is_checked(world):
    late = compute(world, now=datetime(2026, 3, 12, 16, 0, 0, tzinfo=UTC))
    assert late.exit_code == 1 and "checked_on" in " ".join(late.lines) and "2026-03-12" in " ".join(late.lines)
    assert not lock_path(world).exists()


def test_compute_refuses_a_claim_that_is_not_one_a_series_the_release_lacks_and_no_readings(world):
    write_claim(world["content"], record(readings=[]))
    assert "no reading" in " ".join(compute(world).lines)
    write_claim(world["content"], record(readings=[{**JOBS, "series": "fx_nowhere"}]))
    assert "fx_nowhere" in " ".join(compute(world).lines)
    path = write_claim(world["content"], record())
    path.write_text(path.read_text().replace("status:", "verdict: \"accurate\"\nstatus:"))
    refused = compute(world)
    assert refused.exit_code == 1 and "verdict" in " ".join(refused.lines)
    assert not locks_dir(world).exists() or not list(locks_dir(world).iterdir())


def test_a_lock_in_the_repository_needs_redistribution_and_a_local_lock_asks_no_signature(world):
    write_register(world["register"], fixture_table(decision={**MAKE.register()["rows"][0]["decision"], "redistribute": False}))
    assert publish(world, "public", now=CHECKED).exit_code == 0          # display is enough for a Release
    refused = compute(world)
    assert refused.exit_code == 1 and "redistribut" in " ".join(refused.lines) and not lock_path(world).exists()
    write_register(world["register"], fixture_table(decision=None))
    local = compute(world, "local")
    assert local.exit_code == 0, local.lines
    assert lock_path(world, profile="local").exists() and not locks_dir(world).exists()
    lock, _ = K.read_lock(lock_path(world, profile="local").read_bytes(), lock_path(world, profile="local").name)
    assert lock["release"]["profile"] == "local"


def test_a_claim_cannot_be_locked_on_a_legacy_representation_series(tmp_path):
    # v1's own files, converted: every Series of this Release is legacy_monthly_rounded.
    register = write_register(tmp_path / "register.json")
    store = tmp_path / "store"
    released, checked = datetime(2026, 11, 12, 15, 0, 0, tzinfo=UTC), datetime(2026, 11, 12, 16, 0, 0, tzinfo=UTC)
    assert release(profile="local", root=tmp_path / "local", store=store, register=register,
                   now=released, content=tmp_path / "content", manual=tmp_path / "none").exit_code == 0
    catalog = read_json(tmp_path / "local" / "releases" / current(tmp_path / "local") / "catalog.json")["series"]
    assert {entry["representation"] for entry in catalog} == {"legacy_monthly_rounded"}
    for series in ("unrate", "cpi_yoy"):                      # a stored Series, and one v1 derived
        write_claim(tmp_path / "content", claim(id=ID, said_on="2026-03-11", checked_on="2026-11-12",
                                                readings=[{**JOBS, "series": series, "period": "2025-01"}]))
        refused = PC.compute(claim_id=ID, profile="local", root=tmp_path / "local", store=store, register=register,
                             content=tmp_path / "content", now=checked)
        said = " ".join(refused.lines)
        assert refused.exit_code == 1 and "legacy representation" in said and series in said
    assert not (tmp_path / "local" / "locks").exists()


# --- the slice story ---------------------------------------------------------------------------------


def test_after_a_revision_the_latest_row_changes_the_locked_rows_do_not_and_a_drift_report_appears(world):
    assert compute(world).exit_code == 0
    locked = lock_path(world).read_bytes()
    make_public(world)
    carried = publish(world, "public", reuse_data=True, now=CHECKED)
    assert carried.exit_code == 0, carried.lines
    assert validate_release(directory(world)) == []
    # On the Release it was checked against, latest is the locked row and nothing has drifted.
    (entry,) = read_json(directory(world) / "evidence" / "latest.json")["claims"]
    assert (entry["claim_id"], entry["lock_version"]) == (ID, 1)
    assert [reading["drift"] for reading in entry["readings"]] == [[], [], []]
    assert figures(entry["readings"][0]["latest"]) == [("value", 150000)]
    assert not any(line.startswith("DRIFT") for line in carried.lines)

    # A month later the Origin revises January: 150000 preliminary becomes 150010 final.
    build_store(world["store"], world["register"], "2-revision")
    revised = publish(world, "public", now=LATER)
    assert revised.exit_code == 0, revised.lines
    assert validate_release(directory(world)) == []
    # The locked rows do not change: the lock in the repository and its copy in the Release are the bytes written.
    assert lock_path(world).read_bytes() == locked
    assert (directory(world) / "locks" / K.lock_name(ID, 1)).read_bytes() == locked
    (entry,) = read_json(directory(world) / "evidence" / "latest.json")["claims"]
    jobs, ratio, rise = entry["readings"]
    # The latest row does.
    assert figures(jobs["latest"]) == [("value", 150010)] and jobs["latest"]["state"] == "latest"
    assert jobs["latest"]["figures"][0]["status"] == "final"
    # And the drift report says where, in numbers, and names no cause.
    assert [(d["kind"], d["figure"], d["field"], d["locked"], d["now"]) for d in jobs["drift"]] == [
        ("latest_differs", "value", "value", 150000, 150010), ("latest_differs", "value", "status", "preliminary", "final")]
    assert ratio["drift"] == []
    assert [(d["figure"], d["locked"], d["now"]) for d in rise["drift"] if d["field"] == "value"] == [
        ("start", 150000, 150010), ("change", 120, 110), ("pct_change", pytest.approx(0.08), pytest.approx(110 / 150010 * 100))]
    # The then row, computed again on the new Release, is still the locked one: no then_differs.
    assert {d["kind"] for reading in entry["readings"] for d in reading["drift"]} == {"latest_differs"}
    assert any(line.startswith(f"DRIFT {ID} v1") for line in revised.lines)
    report = {row["check"]: row for row in read_json(directory(world) / "manifest.json")["checks"]["report"]}
    assert report["claims: drift"]["outcome"] == "warn" and ID in report["claims: drift"]["detail"]
    listed = read_json(directory(world) / "content" / "claims.json")["claims"][0]["locks"]
    assert [(l["version"], l["state"]) for l in listed] == [(1, "in_release")]


def test_relock_adds_a_version_with_a_reason_and_the_drift_is_gone(world):
    assert compute(world).exit_code == 0
    make_public(world)
    build_store(world["store"], world["register"], "2-revision")
    assert publish(world, "public", now=LATER).exit_code == 0
    assert relock(world, "", now=LATER).exit_code == 1                      # a reason is required
    stale_day = relock(world, "January was revised.", now=LATER)
    assert stale_day.exit_code == 1 and "checked_on" in " ".join(stale_day.lines)
    write_claim(world["content"], record(status="public", checked_on="2026-04-11"))
    done = relock(world, "January was revised.", now=LATER)
    assert done.exit_code == 0, done.lines
    first, _ = K.read_lock(lock_path(world).read_bytes(), lock_path(world).name)
    second, problems = K.read_lock(lock_path(world, 2).read_bytes(), lock_path(world, 2).name)
    assert problems == [] and (second["version"], second["supersedes"], second["reason"]) == (2, 1, "January was revised.")
    assert figures(first["readings"][0]["now_when_checked"]) == [("value", 150000)]       # the old lock stays as it was
    assert figures(second["readings"][0]["now_when_checked"]) == [("value", 150010)]
    assert figures(second["readings"][0]["then"]) == [("value", 150000)]                  # what was public then has not changed
    assert publish(world, "public", reuse_data=True, now=LATER).exit_code == 0
    (entry,) = read_json(directory(world) / "evidence" / "latest.json")["claims"]
    assert entry["lock_version"] == 2 and all(reading["drift"] == [] for reading in entry["readings"])
    assert sorted(p.name for p in (directory(world) / "locks").iterdir()) == [K.lock_name(ID, 1), K.lock_name(ID, 2)]


def test_relock_needs_a_lock_to_follow(world):
    refused = relock(world, "No reason to.")
    assert refused.exit_code == 1 and "compute" in " ".join(refused.lines)


# --- the build fails on a broken lock ---------------------------------------------------------------


def test_editing_a_locked_reading_fails_the_release(world):
    assert compute(world).exit_code == 0
    before = current(world["tmp"] / "public")
    moved = record()
    moved["readings"] = [{**JOBS, "period": "2026-02"}, RATIO, RISE]
    write_claim(world["content"], moved)
    for profile in ("public", "local"):
        refused = publish(world, profile, reuse_data=True, now=CHECKED)
        assert refused.exit_code == 1 and "changed since it was locked" in " ".join(refused.lines), profile
    assert current(world["tmp"] / "public") == before


def test_editing_a_number_in_a_lock_fails_the_release(world):
    assert compute(world).exit_code == 0
    before = current(world["tmp"] / "public")
    lock_path(world).write_text(lock_path(world).read_text().replace("150000", "149000"))
    refused = publish(world, "public", reuse_data=True, now=CHECKED)
    assert refused.exit_code == 1 and "was edited" in " ".join(refused.lines) and current(world["tmp"] / "public") == before


def test_a_public_claim_without_a_lock_fails_a_public_release(world):
    make_public(world)
    refused = publish(world, "public", reuse_data=True, now=CHECKED)
    assert refused.exit_code == 1 and "no lock" in " ".join(refused.lines)


# --- profiles ----------------------------------------------------------------------------------------


def test_a_draft_claim_is_in_no_byte_of_a_public_release_and_whole_in_a_local_one(world):
    assert compute(world).exit_code == 0            # even locked, a draft stays out
    assert publish(world, "public", reuse_data=True, now=CHECKED).exit_code == 0
    assert read_json(directory(world) / "content" / "claims.json") == {"claims": []}
    assert not (directory(world) / "locks").exists() and not (directory(world) / "evidence").exists()
    everything = all_bytes(world["tmp"] / "public")
    for seed in (ID.encode(), b"invented jobs in January", b"An Invented Official", b"jobs-per-point"):
        assert seed not in everything
    report = {row["check"]: row for row in read_json(directory(world) / "manifest.json")["checks"]["report"]}
    assert report["content: claims"]["detail"] == "0 Claims; 1 draft left out"
    assert publish(world, "local", reuse_data=True, now=CHECKED).exit_code == 0
    (held,) = read_json(directory(world, "local") / "content" / "claims.json")["claims"]
    assert (held["id"], held["status"], held["quote"]) == (ID, "draft", record()["quote"])
    # The local Release reads the repository's lock for it.
    assert [(l["version"], l["state"]) for l in held["locks"]] == [(1, "in_release")]
    assert validate_release(directory(world, "local")) == []


def test_a_public_release_never_reads_a_lock_of_the_local_root(world):
    assert compute(world, "local").exit_code == 0
    assert publish(world, "local", reuse_data=True, now=CHECKED).exit_code == 0
    (held,) = read_json(directory(world, "local") / "content" / "claims.json")["claims"]
    assert [(l["version"], l["state"]) for l in held["locks"]] == [(1, "in_release")]
    assert (directory(world, "local") / "evidence" / "latest.json").exists()
    make_public(world)
    refused = publish(world, "public", reuse_data=True, now=CHECKED)
    assert refused.exit_code == 1 and "no lock" in " ".join(refused.lines)
    # Once the Claim is locked in the repository, the local root's own lock is no longer read, and that is said.
    write_claim(world["content"], record())
    assert compute(world, "public").exit_code == 0
    again = compute(world, "local")
    assert again.exit_code == 1 and "repository" in " ".join(again.lines)
    result = publish(world, "local", reuse_data=True, now=CHECKED)
    assert result.exit_code == 0 and any("WARNING" in line and "not read" in line for line in result.lines)


def test_a_lock_whose_numbers_may_no_longer_be_shown_is_named_without_them(world):
    assert compute(world).exit_code == 0
    make_public(world)
    assert publish(world, "public", reuse_data=True, now=CHECKED).exit_code == 0
    with_numbers = load_release(directory(world))
    # The permission to hand the values out is taken away afterwards.
    write_register(world["register"], fixture_table(decision={**MAKE.register()["rows"][0]["decision"], "redistribute": False}))
    later = RightsGate(json.loads(world["register"].read_text()))
    assert any(K.lock_name(ID, 1) in problem for problem in R.rights_problems(with_numbers, later))
    assert publish(world, "public", reuse_data=True, now=LATER).exit_code == 1      # a Release that holds them is not built on
    result = publish(world, "public", now=LATER)
    assert result.exit_code == 0, result.lines
    assert validate_release(directory(world)) == []
    (held,) = read_json(directory(world) / "content" / "claims.json")["claims"]
    assert [(l["version"], l["state"]) for l in held["locks"]] == [(1, "withdrawn")] and "redistribut" in held["locks"][0]["why"]
    assert not (directory(world) / "locks").exists() and not (directory(world) / "evidence").exists()
    assert held["quote"] == record()["quote"]       # the record stays; its numbers do not


def test_withdrawing_a_series_takes_the_locks_that_rest_on_it_down_with_it(world):
    assert compute(world).exit_code == 0
    make_public(world)
    assert publish(world, "public", reuse_data=True, now=CHECKED).exit_code == 0
    holding = current(world["tmp"] / "public")
    result = withdraw(key="fx_price", reason="the permission was wrong", profile="public", root=world["tmp"] / "public",
                      store=world["store"], register=world["register"], now=LATER, content=world["content"],
                      manual=world["tmp"] / "no-manual")
    assert result.exit_code == 0, result.lines
    # The replacement names the lock and holds none of its numbers; the Release that held them is retired.
    (held,) = read_json(directory(world) / "content" / "claims.json")["claims"]
    assert held["locks"][0]["state"] == "withdrawn" and "fx_price" in held["locks"][0]["why"]
    assert not (directory(world) / "locks").exists()
    assert holding not in R.release_ids(world["tmp"] / "public")
    assert b"1495.2" not in all_bytes(world["tmp"] / "public")       # 150120 / 100.4, the ratio's value


# --- the commands --------------------------------------------------------------------------------------


def test_the_commands_from_the_shell(world, capsys):
    common = ["--profile", "public", "--out", str(world["tmp"] / "public"), "--store", str(world["store"]),
              "--register", str(world["register"]), "--content", str(world["content"])]
    assert cli.main(["claims", "compute", ID, *common, "--now", "2026-03-11T16:00:00Z"]) == 0
    assert f"LOCKED {ID} v1" in capsys.readouterr().out
    assert cli.main(["claims", "list", *common]) == 0
    said = capsys.readouterr().out
    assert ID in said and "draft" in said and "v1" in said
    with pytest.raises(SystemExit):                                      # argparse: --reason is required
        cli.main(["claims", "relock", ID, *common])
    capsys.readouterr()
