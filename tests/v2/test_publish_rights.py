"""The release writer and the interim data rule (PLAN 6.1 points 2 to 5; M9 acceptance): what
may not reach a public root, by any door, and what ``atlas doctor --surface production``
refuses. The seeded value is one of v1's own, which came through FRED."""
from __future__ import annotations

import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from atlas import legacy
from atlas.cli import main as atlas_main
from atlas.publish import pin, release, rollback
from atlas.publish import root as R
from atlas.publish.doctor import doctor
from atlas.release import load_release, validate_release
from atlas.rights import RightsGate
from atlas.vintage.store import CaptureRef, SeriesState, VintageStore

from .capture_helpers import ALLOW, PROPOSAL, origin_row
from .capture_helpers import register as make_register
from .release_helpers import (
    NOW,
    ORIGIN,
    ROOT,
    SERIES,
    all_bytes,
    build_store,
    current,
    fixture_table,
    read_json,
    write_register,
)

FIXTURE_RELEASE = ROOT / "fixtures" / "public" / "releases" / "20260101T000000Z-0000000"
BLS = "U.S. Bureau of Labor Statistics"
#: After the last month of v1's committed output, so none of it lies in the future.
LATER = datetime(2026, 12, 1, 15, 45, 0, tzinfo=UTC)


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


@pytest.fixture(scope="module")
def v1() -> dict[str, bytes]:
    """v1's committed output as the legacy converter writes it. Never uploaded or printed."""
    return legacy.build_release(ROOT, LATER)[1]


@pytest.fixture(scope="module")
def seeded(v1) -> bytes:
    """A stretch of v1's unemployment rate, which came through FRED."""
    return v1["series/unrate.json"][-400:-200]


def fixture_gate(**changes) -> RightsGate:
    return RightsGate(fixture_table(datasets="*", **changes))


def with_catalog(files: dict[str, bytes], change) -> dict[str, bytes]:
    catalog = json.loads(files["catalog.json"])
    for entry in catalog["series"]:
        change(entry)
    return {**files, "catalog.json": json.dumps(catalog).encode()}


# --- the independent check over a Release's files --------------------------------------------------


def test_a_release_whose_every_origin_is_signed_has_no_rights_problem():
    assert R.rights_problems(load_release(FIXTURE_RELEASE), fixture_gate()) == []


def test_every_series_is_a_problem_while_its_origins_row_is_unsigned():
    problems = R.rights_problems(load_release(FIXTURE_RELEASE), fixture_gate(decision=None))
    # Seven Series, the history of the three that carry one (M10), and the four Annotations
    # typed in from a record: a recession, two terms and a policy period (M19).
    assert len(problems) == 16 and all("is not signed" in p for p in problems)
    assert sum("the Annotation" in p for p in problems) == 4
    assert sum("its history" in p for p in problems) == 3


def test_the_committed_register_permits_nothing_today():
    """No row is signed (D2 is open). When Alex signs one this test is the one to change."""
    committed = RightsGate(json.loads((ROOT / "schema" / "rights-register.json").read_text()))
    assert len(R.rights_problems(load_release(FIXTURE_RELEASE), committed)) == 16  # 7 Series, 3 histories, 4 typed-in Annotations, a Claim lock and its latest rows


def test_a_derived_series_is_a_problem_when_one_of_its_inputs_has_no_signed_row():
    def move_the_input(entry):
        if entry["key"] == "fx_price_index":
            entry["source"]["origin"]["producer"] = "An agency nobody has read the terms of"

    problems = R.rights_problems(with_catalog(load_release(FIXTURE_RELEASE), move_the_input), fixture_gate())
    assert sorted(p.split(":")[0] for p in problems) == ["fx_price_index", "fx_price_index_yoy"]
    assert all("is not in the rights register" in p for p in problems)


def test_a_dataset_the_signed_row_does_not_cover_is_a_problem():
    gate = RightsGate(fixture_table(datasets=["some other dataset"]))
    assert len(R.rights_problems(load_release(FIXTURE_RELEASE), gate)) == 16  # 7 Series, 3 histories, 4 typed-in Annotations, a Claim lock and its latest rows


def test_a_row_that_does_not_allow_display_is_a_problem():
    gate = fixture_gate(decision={**ALLOW, "display": False})
    assert all("does not allow display" in p for p in R.rights_problems(load_release(FIXTURE_RELEASE), gate))


def test_an_intermediary_channel_needs_its_own_signed_row_and_an_adr_0006_amendment():
    def through_fred(entry):
        if entry["key"] == "fx_price_index":
            entry["source"]["channel"]["via"] = "fred"

    files = with_catalog(load_release(FIXTURE_RELEASE), through_fred)
    channel = {"id": "fred", "kind": "channel", "name": "FRED", "channel": "fred", "used_for": "test",
               "terms": [], "licence_class": "permission_required", "attribution": None,
               "proposal": PROPOSAL, "open_questions": [], "decision": dict(ALLOW)}
    origin = origin_row("fx", ORIGIN, [])

    def problems(table):
        return [p for p in R.rights_problems(files, RightsGate(table)) if p.startswith("fx_price_index:")]

    assert "is not in the rights register" in problems(make_register(origin))[0]
    assert "no amendment to ADR 0006 has cleared" in problems(make_register(origin, channel))[0]
    cleared = make_register(origin, channel)
    cleared["cleared_intermediaries"] = [{"channel": "fred", "adr_0006_amendment": "2026-12-01",
                                          "approved_by": "Alex"}]
    assert problems(cleared) == []


def test_the_legacy_representation_is_a_problem_whatever_the_register_says():
    files = load_release(FIXTURE_RELEASE)
    document = json.loads(files["series/fx_price_index.json"])
    document["representation"] = "legacy_monthly_rounded"
    files["series/fx_price_index.json"] = json.dumps(document).encode()

    problems = R.rights_problems(files, fixture_gate())
    assert "fx_price_index: is in v1's legacy representation, which is never public" in problems


# --- the writer refuses ----------------------------------------------------------------------------


def test_the_publisher_checks_rights_itself_and_rejects_what_the_register_no_longer_allows(
        tmp_path, register, store):
    """--reuse-data builds on files already written, so nothing was withheld for it: the
    independent check is what stops a Series whose row has since been unsigned."""
    root = tmp_path / "public"
    first = release(profile="public", root=root, store=store, register=register, series=SERIES, now=NOW)
    unsigned = write_register(tmp_path / "unsigned.json", fixture_table(decision=None))

    result = release(profile="public", root=root, store=store, register=unsigned, reuse_data=True,
                     now=NOW.replace(hour=16))

    assert result.outcome == "refused" and "is not signed" in "\n".join(result.lines)
    assert current(root) == first.release_id and R.release_ids(root) == [first.release_id]


def test_a_staged_release_holding_a_series_without_a_signed_row_is_rejected(
        tmp_path, register, store, monkeypatch):
    """If the export ever let something through, the publisher's own check still refuses it.
    Here the export is made to decide under a register that signs everything, while the run's
    register signs only one dataset."""
    from atlas.publish import export, run

    def too_generous(**options):
        table = fixture_table()
        return export.build(**{**options, "table": table, "gate": RightsGate(table)})

    monkeypatch.setattr(run, "build", too_generous)
    narrowed = write_register(tmp_path / "narrowed.json", fixture_table(datasets=["fixture prices"]))

    result = release(profile="public", root=tmp_path / "public", store=store, register=narrowed,
                     series=SERIES, now=NOW)

    assert result.outcome == "rejected" and result.exit_code == 1
    # Two lines of defence say no: the gate over the staged files, and the contract's own
    # rule that a public Release names a register every row it rests on is signed in.
    rights, contract = result.failed_checks
    assert rights["check"].startswith("rights") and "fx_jobs" in rights["detail"]
    assert contract["check"] == "release contract" and "unsigned_register" in contract["detail"]
    assert current(tmp_path / "public") is None
    assert not any(v in all_bytes(tmp_path / "public") for v in (b"150010", b"150120", b"150300"))


def test_when_a_row_is_unsigned_the_next_release_publishes_nothing_of_it_and_doctor_says_what_is_left(
        tmp_path, register, store):
    root = tmp_path / "public"
    first = release(profile="public", root=root, store=store, register=register, series=SERIES, now=NOW)
    unsigned = write_register(tmp_path / "unsigned.json", fixture_table(decision=None))

    second = release(profile="public", root=root, store=store, register=unsigned, series=SERIES,
                     now=NOW.replace(hour=16))

    assert second.outcome == "promoted", second.lines
    manifest = read_json(root / "releases" / second.release_id / "manifest.json")
    assert manifest["series"] == {} and [w["key"] for w in manifest["withheld"]] == ["fx_jobs", "fx_price"]
    assert not (root / "releases" / second.release_id / "series").exists()
    # The earlier release still holds the values; rolling back to it is refused.
    assert rollback(release_id=first.release_id, profile="public", root=root, store=store,
                    register=unsigned).outcome == "refused"


def test_a_public_release_never_takes_v1s_series(tmp_path, register, store, seeded):
    result = release(profile="public", root=tmp_path / "public", store=store, register=register,
                     series=SERIES, now=NOW, legacy=True)
    assert result.outcome == "refused" and "never part of a public-profile release" in result.lines[0]
    assert not (tmp_path / "public" / "CURRENT").exists()

    good = release(profile="public", root=tmp_path / "public", store=store, register=register,
                   series=SERIES, now=NOW)
    assert good.outcome == "promoted"
    assert seeded not in all_bytes(tmp_path / "public")


def test_a_store_whose_record_was_cut_off_is_not_released(tmp_path, register, store):
    with open(store / "metalog" / "fx_price.ndjson", "a") as handle:
        handle.write(json.dumps({"format": 1, "key": "fx_price", "recorded_from": "2026-06-01T00:00:00Z",
                                 "capture_id": "a-run-that-died/fx-bls-shape", "metadata": {},
                                 "metadata_hash": "0" * 64}) + "\n")
    result = release(profile="public", root=tmp_path / "public", store=store, register=register,
                     series=SERIES, now=NOW)
    assert result.outcome == "refused" and "was cut off part way" in "\n".join(result.lines)
    assert current(tmp_path / "public") is None


def test_an_observation_log_that_is_not_what_was_recorded_is_not_released(tmp_path, register, store):
    vintages = VintageStore(store)
    rows = vintages.rows("fx_jobs")
    rows[-1]["value"] = "999999"
    vintages._write_rows("fx_jobs", rows)  # an edit behind the store's back
    result = release(profile="public", root=tmp_path / "public", store=store, register=register,
                     series=SERIES, now=NOW)
    assert result.outcome == "refused"
    assert "is not the state its capture log recorded" in "\n".join(result.lines)


# --- nothing local reaches a public root -----------------------------------------------------------


@pytest.fixture
def local_release(tmp_path, register, store) -> Path:
    """A valid local-profile Release of the fixture store, in its own root."""
    result = release(profile="local", root=tmp_path / "local", store=store, register=register,
                     series=SERIES, now=NOW, legacy=False)
    assert result.outcome == "promoted", result.lines
    return tmp_path / "local" / "releases" / result.release_id


def planted(tmp_path, local_release, how: str) -> Path:
    root = tmp_path / "public"
    (root / "releases").mkdir(parents=True)
    target = root / "releases" / local_release.name
    if how == "copied":
        shutil.copytree(local_release, target)
    else:
        os.symlink(local_release, target)
    (root / "CURRENT").write_text(local_release.name + "\n")
    return root


@pytest.mark.parametrize("how", ["copied", "linked"])
def test_reuse_rollback_and_pin_cannot_bring_a_local_release_into_a_public_root(
        tmp_path, register, store, local_release, how):
    root = planted(tmp_path, local_release, how)
    common = {"profile": "public", "root": root, "store": store, "register": register}
    before = all_bytes(root / "releases") if how == "copied" else None

    reused = release(**common, reuse_data=True, now=NOW.replace(hour=17))
    rolled = rollback(release_id=local_release.name, **common)
    pinned = pin(release_id=local_release.name, reason="x", **common)

    for result in (reused, rolled, pinned):
        assert result.outcome == "refused" and result.exit_code == 1, result.lines
    wanted = "this root takes public-profile releases" if how == "copied" else "reached through a link"
    assert wanted in "\n".join(rolled.lines) and wanted in "\n".join(reused.lines)
    assert R.release_ids(root) == [local_release.name] and not (root / "pins.json").exists()
    if before is not None:
        assert all_bytes(root / "releases") == before


def test_a_root_is_for_one_profile_from_its_first_release(tmp_path, register, store, local_release):
    result = release(profile="public", root=tmp_path / "local", store=store, register=register,
                     series=SERIES, now=NOW)
    assert result.outcome == "refused" and "local-profile root" in result.lines[0]


def test_a_release_root_stays_apart_from_the_other_roots_and_the_store(
        tmp_path, register, store, monkeypatch):
    monkeypatch.setenv("ATLAS_PUBLIC", str(tmp_path / "pub"))
    monkeypatch.setenv("ATLAS_LOCAL", str(tmp_path / "loc"))
    monkeypatch.setenv("ATLAS_STORE", str(tmp_path / "sto"))

    def refusal(profile, root, **more):
        result = release(profile=profile, root=root, store=store, register=register, series=SERIES,
                         now=NOW, **more)
        assert result.outcome == "refused", result.lines
        return result.lines[0]

    assert "$ATLAS_PUBLIC" in refusal("local", tmp_path / "pub" / "inside", legacy=False)
    assert "$ATLAS_LOCAL" in refusal("public", tmp_path / "loc")
    assert "$ATLAS_STORE" in refusal("public", tmp_path / "sto" / "releases")
    assert "the store" in refusal("public", store / "public")
    link = tmp_path / "innocent"
    link.symlink_to(tmp_path / "loc", target_is_directory=True)
    (tmp_path / "loc").mkdir()
    assert "$ATLAS_LOCAL" in refusal("public", link)
    assert not (tmp_path / "pub").exists() and not list((tmp_path / "loc").iterdir())


def test_invented_values_and_other_registers_never_go_into_this_machines_real_roots(
        tmp_path, register, store, monkeypatch):
    monkeypatch.setenv("ATLAS_PUBLIC", str(tmp_path / "pub"))
    monkeypatch.setenv("ATLAS_LOCAL", str(tmp_path / "loc"))
    for profile, root in (("public", tmp_path / "pub"), ("local", tmp_path / "loc")):
        result = release(profile=profile, root=root, store=store, register=register, series=SERIES,
                         now=NOW, legacy=False if profile == "local" else None)
        assert result.outcome == "refused" and "never go into $ATLAS_" in result.lines[0]
        assert not root.exists()
    # The committed register, and still refused: the store's values are invented.
    result = release(profile="public", root=tmp_path / "pub", store=store, series=SERIES, now=NOW)
    assert result.outcome == "refused" and "invented values" in result.lines[0]


# --- the local profile -----------------------------------------------------------------------------


def agency_store(directory: Path) -> Path:
    """A store of the kind a real capture makes (its bytes count as an agency's), holding one
    Series under v1's key ``cpi``. The three values are made up for the test."""
    metadata = {"name": "CPI-U, all items, seasonally adjusted", "unit": "index, 1982-84 = 100",
                "seasonal_adjustment": "sa",
                "source": {"origin": {"producer": BLS, "dataset": "Consumer Price Index",
                                      "origin_id": "CUSR0000SA0", "url": None},
                           "channel": {"via": "direct", "adapter": "bls", "endpoint": "bls-headline"}},
                "rights": None}
    state = SeriesState("cpi", "monthly", True, ("2026-01-01", "2026-12-31"), [
        {"period": "2026-01", "value": "326.588", "status": "final"},
        {"period": "2026-02", "value": "327.460", "status": "final"},
        {"period": "2026-03", "value": "330.293", "status": "final"}], metadata)
    VintageStore(directory).record(state, CaptureRef(
        "run-1/bls-headline", datetime(2026, 4, 10, 12, 31, tzinfo=UTC), "direct", "bls-headline"))
    return directory


def test_a_local_release_adds_v1s_series_for_keys_the_store_does_not_hold_and_never_mixes(tmp_path, v1):
    store = agency_store(tmp_path / "store")

    # The committed register: nothing is signed, and a local release needs nothing signed.
    result = release(profile="local", root=tmp_path / "local", store=store, now=LATER)

    assert result.outcome == "promoted", result.lines
    directory = tmp_path / "local" / "releases" / result.release_id
    assert validate_release(directory) == []
    manifest = read_json(directory / "manifest.json")
    assert manifest["profile"] == "local" and manifest["rights_register"]["signed"] is False
    entries = {e["key"]: e for e in read_json(directory / "catalog.json")["series"]}
    v1_keys = {e["key"] for e in json.loads(v1["catalog.json"])["series"]}
    assert set(entries) == v1_keys                                  # the local site loses no Series
    # cpi is the Origin's, whole: native values at full precision, none of v1's rounded ones.
    cpi = read_json(directory / "series" / "cpi.json")
    assert cpi["representation"] == "native" and entries["cpi"]["representation"] == "native"
    assert [o["value"] for o in cpi["observations"]] == [326.588, 327.46, 330.293]
    assert entries["cpi"]["source"]["channel"]["via"] == "direct"
    # Every other Series is v1's file, byte for byte.
    assert (directory / "series" / "unrate.json").read_bytes() == v1["series/unrate.json"]
    for folder in ("series", "derived"):
        for path in (directory / folder).glob("*.json"):
            document = json.loads(path.read_bytes())
            wanted = "native" if document["key"] == "cpi" else "legacy_monthly_rounded"
            assert document["representation"] == wanted == manifest["series"][document["key"]]["representation"]
            assert entries[document["key"]]["representation"] == wanted
    assert read_json(tmp_path / "local" / "root.json") == {"format": 1, "profile": "local", "real_bytes": True}


def test_invented_values_are_never_mixed_with_v1s_series(tmp_path, register, store):
    result = release(profile="local", root=tmp_path / "local", store=store, register=register,
                     series=SERIES, now=NOW, legacy=True)
    assert result.outcome == "refused" and "never mixed with v1's Series" in "\n".join(result.lines)


def test_reuse_data_links_the_current_releases_data_files_and_says_so(tmp_path, register, store):
    root = tmp_path / "public"
    first = release(profile="public", root=root, store=store, register=register, series=SERIES, now=NOW)

    second = release(profile="public", root=root, store=store, register=register, reuse_data=True,
                     now=NOW.replace(hour=16))

    assert second.outcome == "promoted", second.lines
    assert read_json(root / "releases" / second.release_id / "manifest.json")["reused_data_from"] == first.release_id
    for name in ("fx_price", "fx_jobs"):
        old, new = (root / "releases" / r.release_id / "series" / f"{name}.json" for r in (first, second))
        assert old.stat().st_ino == new.stat().st_ino
    assert validate_release(root / "releases" / second.release_id) == []


# --- atlas doctor ----------------------------------------------------------------------------------


def lines_of(report) -> str:
    return "\n".join(report[1])


def test_doctor_for_production_refuses_a_local_release_with_v1s_values_in_a_public_root(
        tmp_path, v1, seeded):
    store = agency_store(tmp_path / "store")
    made = release(profile="local", root=tmp_path / "local", store=store, now=LATER)
    root = tmp_path / "public"
    shutil.copytree(tmp_path / "local", root)
    assert seeded in all_bytes(root)                                # the seeded FRED value is there

    status, report = doctor(surface="production", root=root)

    assert status == 1
    assert f"release {made.release_id} has profile 'local' in a public root" in "\n".join(report)
    assert seeded.decode() not in "\n".join(report)                 # and doctor does not print it


def test_doctor_for_production_refuses_legacy_series_and_an_unsigned_register_reference(
        tmp_path, monkeypatch):
    """A root someone assembled by hand: public-profile on its face, legacy inside."""
    root = tmp_path / "public"
    target = root / "releases" / FIXTURE_RELEASE.name
    shutil.copytree(FIXTURE_RELEASE, target)
    (root / "CURRENT").write_text(FIXTURE_RELEASE.name + "\n")
    R.replace_json(root / "root.json", {"format": 1, "profile": "public", "real_bytes": True})
    monkeypatch.setattr("atlas.publish.doctor._committed_gate", fixture_gate)
    assert doctor(surface="production", root=root)[0] == 0          # as committed, it would pass

    manifest = read_json(target / "manifest.json")
    manifest["rights_register"]["signed"] = False
    (target / "manifest.json").write_text(json.dumps(manifest))
    report = doctor(surface="production", root=root)
    assert report[0] == 1 and "unsigned" in lines_of(report)


def test_doctor_for_production_asks_the_committed_register_whatever_the_release_was_built_under(
        tmp_path, register, store):
    """A Release a test register allowed, in a root of invented values: refused twice over."""
    root = tmp_path / "public"
    release(profile="public", root=root, store=store, register=register, series=SERIES, now=NOW)

    status, report = doctor(surface="production", root=root)

    text = "\n".join(report)
    assert status == 1
    assert "the root holds invented values" in text
    assert "fx_price: the rights register row for Macro Atlas fixture (synthetic)" in text
    assert "is not signed" in text


def test_doctor_for_production_checks_every_release_a_reader_could_open_not_only_current(
        tmp_path, monkeypatch):
    store = agency_store(tmp_path / "store")
    table = make_register(origin_row("bls", BLS, []))
    signed = write_register(tmp_path / "signed.json", table)
    root = tmp_path / "public"
    first = release(profile="public", root=root, store=store, register=signed, now=NOW)
    second = release(profile="public", root=root, store=store, register=signed, now=NOW.replace(hour=16))
    assert second.outcome == "promoted", second.lines
    monkeypatch.setattr("atlas.publish.doctor._committed_gate", lambda: RightsGate(table))
    assert doctor(surface="production", root=root)[0] == 0
    assert "nothing wrong" in lines_of(doctor(surface="staging", root=root))

    # An older release is swapped for a link to somewhere else: CURRENT is still fine.
    moved = tmp_path / "elsewhere"
    shutil.move(root / "releases" / first.release_id, moved)
    os.symlink(moved, root / "releases" / first.release_id)
    report = doctor(surface="production", root=root)
    assert report[0] == 1 and f"release {first.release_id} is reached through a link" in lines_of(report)


def test_doctor_for_production_fails_when_there_is_nothing_to_serve(tmp_path):
    assert doctor(surface="production", root=tmp_path / "nowhere")[0] == 1
    (tmp_path / "empty").mkdir()
    report = doctor(surface="production", root=tmp_path / "empty")
    assert report[0] == 1 and "names no release" in lines_of(report)


def test_doctor_reports_a_run_that_did_not_finish_and_an_unfinished_withdrawal(tmp_path, register, store):
    root = tmp_path / "public"
    release(profile="public", root=root, store=store, register=register, series=SERIES, now=NOW)
    assert doctor(root=root, store=store)[0] == 0
    R.write_status(root, started="2026-05-14T10:45:00Z", outcome="running")
    R.replace_json(root / "withdrawn.json", {"format": 1, "series": {"fx_jobs": {
        "reason": "wrong", "withdrawn_at": "2026-05-14T10:45:00Z", "retired": []}}})

    status, report = doctor(root=root, store=store)

    text = "\n".join(report)
    assert status == 1
    assert "did not finish" in text and "holds fx_jobs, withdrawn and not yet retired" in text


# --- the command -----------------------------------------------------------------------------------


def test_the_commands_run_end_to_end(tmp_path, register, store, capsys):
    common = ["--profile", "public", "--out", str(tmp_path / "public"), "--store", str(store),
              "--register", str(register)]
    assert atlas_main(["release", *common, "--series", str(SERIES)]) == 0
    out = capsys.readouterr().out
    assert "PROMOTED" in out and "2 series, 0 withheld" in out
    first = current(tmp_path / "public")
    assert atlas_main(["pin", first, *common, "--reason", "a saved query"]) == 0
    assert atlas_main(["rollback", first, *common]) == 0
    assert atlas_main(["withdraw", "fx_jobs", *common, "--reason", "wrong permission"]) == 0
    assert "WITHDRAWN fx_jobs" in capsys.readouterr().out
    assert atlas_main(["doctor", "--root", str(tmp_path / "public"), "--store", str(store)]) == 0
    assert atlas_main(["doctor", "--surface", "production", "--root", str(tmp_path / "public")]) == 1
    assert atlas_main(["unpin", first, *common]) == 0  # the pin outlives the retired release


def test_with_todays_register_and_no_store_the_real_command_refuses_and_writes_nothing(
        tmp_path, monkeypatch, capsys):
    for name in ("PUBLIC", "LOCAL", "STORE"):
        monkeypatch.setenv(f"ATLAS_{name}", str(tmp_path / name.lower()))
    assert atlas_main(["release", "--profile", "public"]) == 1
    assert "there is nothing to release" in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []
    assert atlas_main(["doctor", "--surface", "production"]) == 1


def test_a_series_withdrawn_from_a_local_root_stays_out_of_later_local_releases(tmp_path, v1, seeded):
    from atlas.publish import withdraw

    store = agency_store(tmp_path / "store")
    root = tmp_path / "local"
    release(profile="local", root=root, store=store, now=LATER)
    assert seeded in all_bytes(root)

    gone = withdraw(key="unrate", reason="asked to take it down", profile="local", root=root,
                    store=store, now=LATER.replace(hour=16))
    again = release(profile="local", root=root, store=store, now=LATER.replace(hour=17))

    assert gone.outcome == "withdrawn" and again.outcome == "promoted", gone.lines + again.lines
    assert seeded not in all_bytes(root)
    manifest = read_json(root / "releases" / again.release_id / "manifest.json")
    assert "unrate" not in manifest["series"]
    assert next(w for w in manifest["withheld"] if w["key"] == "unrate")["reason"].startswith("withdrawn on")
    assert validate_release(root / "releases" / again.release_id) == []
