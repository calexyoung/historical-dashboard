"""``atlas replay`` (PLAN M8 acceptance; ADR 0022): Captures in a store, replayed into the
vintage store with their original retrieval times.

The Captures here are made by the real capture kit from recorded exchanges or a scripted
transport, under a register written for the test. Its one Origin is made up and its decision is
test data: nothing here says what Alex has decided for any source."""
from __future__ import annotations

import filecmp
import importlib.util
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from atlas.capture.adapters import BlsAdapter
from atlas.capture.cli import main as capture_main
from atlas.capture.run import run_capture
from atlas.capture.store import FETCH_LOG, read_fetch_log
from atlas.cli import main as atlas_main
from atlas.vintage import VintageStore
from atlas.vintage.cli import main
from atlas.vintage.replay import SeriesTableError, load_series, replay

from .capture_helpers import Scripted, fixture_endpoint

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "vintage"
THREE = FIXTURE / "three-fetch"
SERIES = FIXTURE / "series.json"
T1, T2, T3 = "2026-03-10T13:30:01Z", "2026-04-10T12:30:01Z", "2026-05-12T12:30:01Z"


def fixture_module():
    spec = importlib.util.spec_from_file_location("make_vintage_fixtures", FIXTURE / "make_fixtures.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MAKE = fixture_module()


@pytest.fixture
def register(tmp_path) -> Path:
    path = tmp_path / "register.json"
    path.write_text(json.dumps(MAKE.register()))
    return path


def capture(store: Path, register: Path, *fetches: str) -> None:
    for name in fetches:
        assert capture_main(["--store", str(store), "--register", str(register),
                             "--replay", str(THREE / name)]) == 0


def run(store: Path, register: Path, *more: str) -> int:
    return main(["--store", str(store), "--register", str(register), "--series", str(SERIES), *more])


def brief(rows):
    return [(r["period"], r["value"], r["status"], r["deleted"], r["recorded_from"], r["recorded_to"])
            for r in rows]


def vintage_files(store: Path) -> dict[str, bytes]:
    return {str(path.relative_to(store)): path.read_bytes() for log in ("obslog", "metalog", "caplog")
            for path in sorted((store / log).glob("*"))}


def scripted_capture(store: Path, table: dict, series: dict, start: str) -> None:
    """One capture of the fixture endpoint from a scripted answer, at a chosen time."""
    transport = Scripted({BlsAdapter.URL: [(200, MAKE.body(series), [["Content-Type", "application/json"]])]},
                         start=start)
    run_capture(store, table, transport, sleep=lambda seconds: None)


# --- the acceptance criterion ------------------------------------------------------------------


def test_replaying_the_three_fetch_fixture_gives_the_expected_rows_exactly(tmp_path, register, capsys):
    store = tmp_path / "store"
    capture(store, register, "1-initial", "2-revision", "3-withdrawal")
    began = datetime.now(UTC)

    assert run(store, register) == 0

    vintages = VintageStore(store)
    assert vintages.series_keys() == ["fx_jobs", "fx_price"]
    # Written out by hand from the three bodies in fixtures/vintage/three-fetch.
    assert brief(vintages.rows("fx_price")) == [
        ("2026-01", "100.000", "final", False, T1, None),
        ("2026-02", "100.400", "final", False, T1, T3),   # withdrawn in the third fetch
        ("2026-02", None, None, True, T3, None),
        ("2026-03", "100.900", "final", False, T2, None),
        ("2026-04", "101.300", "final", False, T3, None),
    ]
    assert brief(vintages.rows("fx_jobs")) == [
        ("2026-01", "150000", "preliminary", False, T1, T2),  # revised in the second fetch
        ("2026-01", "150010", "final", False, T2, None),
        ("2026-02", "150120", "preliminary", False, T1, None),
        ("2026-03", "150300", "preliminary", False, T2, None),
    ]
    assert [(c["retrieved_at"], c["change"]) for c in vintages.captures("fx_price")] == [
        (T1, "first"), (T2, "revision"), (T3, "revision")]
    # The third fetch changed nothing for the other Series: a capture confirmation.
    assert [(c["retrieved_at"], c["change"]) for c in vintages.captures("fx_jobs")] == [
        (T1, "first"), (T2, "revision"), (T3, "none")]
    assert [c["scope"] for c in vintages.captures("fx_jobs")] == [["2026-01-01", "2026-12-31"]] * 3

    # Every time in the store is a fixture's retrieval time; none is the time of this replay.
    today = began.strftime("%Y-%m-%dT")
    for name, data in vintage_files(store).items():
        if name.endswith(".ndjson"):
            assert began.strftime("%Y-%m-%dT%H") not in data.decode(), name
    stamps = {r[name] for key in vintages.series_keys() for r in vintages.rows(key)
              for name in ("recorded_from", "recorded_to")} - {None}
    assert stamps == {T1, T2, T3} and not any(s.startswith(today) for s in stamps)
    out = capsys.readouterr().out
    assert "fx_price" in out and "withdrawn 2026-02" in out


def test_a_row_is_tied_to_the_capture_that_opened_it_and_the_metadata_in_force(tmp_path, register):
    store = tmp_path / "store"
    capture(store, register, "1-initial", "2-revision")
    run(store, register)
    lines = read_fetch_log(store)
    vintages = VintageStore(store)
    assert [r["capture_id"] for r in vintages.rows("fx_jobs")] == [
        lines[0]["capture_id"], lines[1]["capture_id"], lines[0]["capture_id"], lines[1]["capture_id"]]
    (history,) = vintages.metadata_history("fx_jobs")
    assert history["recorded_from"] == T1
    assert history["metadata"] == {
        "name": "Fixture jobs", "unit": "thousands of persons", "seasonal_adjustment": "sa",
        "source": {"origin": {"producer": "Macro Atlas fixture (synthetic)", "dataset": "fixture jobs",
                              "origin_id": "FXJOBS00001", "url": None},
                   "channel": {"via": "fixture", "adapter": "bls", "endpoint": "fx-bls-shape"}},
        "rights": {"row": "fx", "licence_class": "public_domain",
                   "attribution": "Synthetic test data, Macro Atlas project",
                   "display": True, "redistribute": True, "store": True, "ml_use": True},
    }
    assert {r["metadata_hash"] for r in vintages.rows("fx_jobs")} == {history["metadata_hash"]}


# --- replay is a function of the captures ----------------------------------------------------------


def test_replaying_again_changes_nothing(tmp_path, register, capsys):
    store = tmp_path / "store"
    capture(store, register, "1-initial", "2-revision", "3-withdrawal")
    run(store, register)
    before = vintage_files(store)
    capsys.readouterr()
    assert run(store, register) == 0
    assert vintage_files(store) == before
    assert "nothing new" in capsys.readouterr().out


def copy_of(source: Path, target: Path, lines: int | None = None) -> Path:
    """The same Captures in another directory (a capture id is random, so capturing twice
    would not give the same ones), with only the first ``lines`` of the fetch log if asked."""
    if not target.exists():
        shutil.copytree(source / "raw", target / "raw")
    log = (source / FETCH_LOG).read_bytes().splitlines(keepends=True)
    (target / FETCH_LOG).write_bytes(b"".join(log if lines is None else log[:lines]))
    return target


@pytest.fixture
def three(tmp_path, register) -> Path:
    store = tmp_path / "captures"
    capture(store, register, "1-initial", "2-revision", "3-withdrawal")
    return store


def test_replaying_day_by_day_and_all_at_once_give_the_same_store(tmp_path, register, three):
    daily, late = tmp_path / "daily", copy_of(three, tmp_path / "late")
    for day in (1, 2, 3):
        assert run(copy_of(three, daily, day), register) == 0
    assert run(late, register) == 0
    assert vintage_files(daily) == vintage_files(late) != {}


def test_the_order_of_lines_in_the_fetch_log_does_not_matter(tmp_path, register, three):
    store, other = copy_of(three, tmp_path / "store"), copy_of(three, tmp_path / "other")
    lines = (other / FETCH_LOG).read_bytes().splitlines(keepends=True)
    (other / FETCH_LOG).write_bytes(b"".join(reversed(lines)))
    run(store, register)
    run(other, register)
    assert vintage_files(store) == vintage_files(other) != {}


def test_the_vintage_store_may_live_apart_from_the_captures(tmp_path, register):
    captures, store = tmp_path / "captures", tmp_path / "vintages"
    capture(captures, register, "1-initial")
    assert run(store, register, "--captures", str(captures)) == 0
    assert VintageStore(store).series_keys() == ["fx_jobs", "fx_price"]
    assert not (captures / "obslog").exists()


# --- what replay refuses or passes over ---------------------------------------------------------


def test_replay_asks_the_rights_gate_and_writes_nothing_when_refused(tmp_path, register, capsys):
    store = tmp_path / "store"
    capture(store, register, "1-initial")
    unsigned = MAKE.register()
    unsigned["rows"][0]["decision"] = None
    refused = tmp_path / "unsigned.json"
    refused.write_text(json.dumps(unsigned))

    assert run(store, refused) == 1
    assert "is not signed" in capsys.readouterr().out
    assert vintage_files(store) == {}


def test_the_committed_register_clears_nothing_so_replay_refuses(tmp_path, register, capsys):
    store = tmp_path / "store"
    capture(store, register, "1-initial")
    assert main(["--store", str(store), "--series", str(SERIES)]) == 1
    assert "is not signed" in capsys.readouterr().out
    assert vintage_files(store) == {}


def test_a_store_with_no_captures_is_an_error_not_an_empty_success(tmp_path, register, capsys):
    assert run(tmp_path / "nothing", register) == 1
    assert "no fetch log" in capsys.readouterr().out


def test_an_incomplete_capture_is_reported_and_records_nothing(tmp_path, capsys):
    store, table = tmp_path / "store", MAKE.register()
    scripted_capture(store, table, {"FXPRICE0001": [(1, "100.000", None)]}, "2026-03-10T13:30:00")
    assert [line["outcome"] for line in read_fetch_log(store)] == ["incomplete"]

    result = replay(store, store, table, load_series(SERIES))
    assert result.exit_code == 0 and VintageStore(store).series_keys() == []
    assert any(line.startswith("SKIPPED") and "incomplete" in line for line in result.lines)


def test_an_endpoint_with_no_parser_yet_is_reported_and_left_for_later(tmp_path):
    store, table = tmp_path / "store", MAKE.register()
    table["rows"][0]["capture"].append({**fixture_endpoint(), "datasets": ["fixture prices"]})
    transport = Scripted({BlsAdapter.URL: [(200, MAKE.body(MAKE.FETCHES[0][2]))],
                          "https://fixture.invalid/a": [(200, "anything\n# end\n")]})
    run_capture(store, table, transport, sleep=lambda seconds: None)

    result = replay(store, store, table, load_series(SERIES))
    assert result.exit_code == 0 and VintageStore(store).series_keys() == ["fx_jobs", "fx_price"]
    assert any("fx-a" in line and "no parser" in line for line in result.lines)


def test_a_capture_older_than_what_is_recorded_is_passed_over_with_a_warning(tmp_path, register, three, capsys):
    store = copy_of(three, tmp_path / "store")
    log = (three / FETCH_LOG).read_bytes().splitlines(keepends=True)
    (store / FETCH_LOG).write_bytes(log[1])  # only the second capture has arrived
    assert run(store, register) == 0
    before = vintage_files(store)
    (store / FETCH_LOG).write_bytes(b"".join(log[:2]))  # the first turns up afterwards
    capsys.readouterr()

    assert run(store, register) == 0
    out = capsys.readouterr().out
    assert "WARNING fx_price" in out and "passed over" in out and T1 in out
    assert vintage_files(store) == before


def test_a_capture_todays_adapter_no_longer_reads_as_whole_records_nothing_and_fails(tmp_path, register, three,
                                                                                    capsys, monkeypatch):
    from atlas.capture.adapters import ADAPTERS, NormalizedState

    store = copy_of(three, tmp_path / "store", 1)
    monkeypatch.setattr(type(ADAPTERS["bls"]), "parse",
                        lambda self, capture: NormalizedState(False, capture.evidence.scope, {}, ["a new check"]))
    assert run(store, register) == 1
    assert "INCOMPLETE" in capsys.readouterr().out and vintage_files(store) == {}


def test_a_series_whose_identifier_is_not_in_the_answer_is_refused_and_the_rest_recorded(tmp_path, register, three,
                                                                                         capsys):
    table = json.loads(SERIES.read_text())
    table["series"][1]["origin_id"] = "FXNOTTHERE1"
    series = tmp_path / "series.json"
    series.write_text(json.dumps(table))
    store = copy_of(three, tmp_path / "store", 1)
    assert main(["--store", str(store), "--register", str(register), "--series", str(series)]) == 1
    assert "REFUSED fx_jobs: FXNOTTHERE1 is not in the answer" in capsys.readouterr().out
    assert VintageStore(store).series_keys() == ["fx_price"]


def test_a_blob_that_was_altered_stops_the_replay(tmp_path, register, capsys):
    store = tmp_path / "store"
    capture(store, register, "1-initial", "2-revision")
    blob = store / read_fetch_log(store)[0]["parts"][0]["blob"]
    blob.write_bytes(blob.read_bytes()[:-4] + b"\0\0\0\0")

    assert run(store, register) == 1
    assert "ALTERED" in capsys.readouterr().out
    # Not even the second, unaltered capture: it would be recorded as if it were the first.
    assert vintage_files(store) == {}


def test_a_month_outside_the_years_asked_for_is_not_withdrawn_when_the_window_slides(tmp_path):
    store, table = tmp_path / "store", MAKE.register()
    scripted_capture(store, table, MAKE.FETCHES[0][2], "2026-03-10T13:30:00")
    body = json.loads(MAKE.body({"FXPRICE0001": [(1, "102.000", None)], "FXJOBS00001": [(1, "151000", "preliminary")]}))
    for series in body["Results"]["series"]:
        for row in series["data"]:
            row["year"] = "2027"
    transport = Scripted({BlsAdapter.URL: [(200, json.dumps(body))]}, start="2027-02-10T13:30:00")
    run_capture(store, table, transport, sleep=lambda seconds: None)

    assert replay(store, store, table, load_series(SERIES)).exit_code == 0
    vintages = VintageStore(store)
    assert [(o["period"], o["value"]) for o in vintages.vintage("fx_price")] == [
        ("2026-01", "100.000"), ("2026-02", "100.400"), ("2027-01", "102.000")]
    assert vintages.captures("fx_price")[-1]["scope"] == ["2027-01-01", "2027-12-31"]


# --- declared metadata -------------------------------------------------------------------------


def rebased_series(tmp_path) -> Path:
    table = json.loads(SERIES.read_text())
    table["series"][0]["metadata"].append({"from": "2026-04-01T00:00:00Z", "name": "Fixture price index",
                                           "unit": "index, 2025-01 = 100", "seasonal_adjustment": "nsa"})
    path = tmp_path / "series.json"
    path.write_text(json.dumps(table))
    return path


def test_declared_metadata_changes_on_its_own_date_however_late_the_replay(tmp_path, register, three):
    series = rebased_series(tmp_path)
    daily, late = tmp_path / "daily", copy_of(three, tmp_path / "late")
    # Day by day: the table gained its second version between the first run and the second.
    main(["--store", str(copy_of(three, daily, 1)), "--register", str(register), "--series", str(SERIES)])
    main(["--store", str(copy_of(three, daily)), "--register", str(register), "--series", str(series)])
    # All at once, months later, from the table as it is now.
    main(["--store", str(late), "--register", str(register), "--series", str(series)])

    history = VintageStore(late).metadata_history("fx_price")
    assert [(m["recorded_from"], m["recorded_to"], m["metadata"]["unit"]) for m in history] == [
        (T1, T2, "index, 2024-01 = 100"), (T2, None, "index, 2025-01 = 100")]
    # The same numbers under a new unit are new rows.
    assert brief(VintageStore(late).rows("fx_price"))[:2] == [
        ("2026-01", "100.000", "final", False, T1, T2), ("2026-01", "100.000", "final", False, T2, None)]
    assert vintage_files(daily) == vintage_files(late)


@pytest.mark.parametrize("damage, message", [
    (lambda t: t["series"].append(dict(t["series"][0])), "twice"),
    (lambda t: t["series"][0].update(key="Bad"), "key"),
    (lambda t: t["series"][0].update(freq="often"), "frequency"),
    (lambda t: t["series"][0].update(metadata=[]), "metadata"),
    (lambda t: t["series"][0]["metadata"][0].update({"from": "2026-01-01T00:00:00Z"}), "first"),
    (lambda t: t["series"][0]["metadata"].extend([{"from": "2026-05-01T00:00:00Z"}, {"from": "2026-04-01T00:00:00Z"}]),
     "order"),
    (lambda t: t["series"][1].update(origin_id="FXPRICE0001"), "bound to two"),
    # Not padded: it would sort after "2026-05" as text and never take effect.
    (lambda t: t["series"][0]["metadata"].append({"from": "2026-4-01T00:00:00Z"}), "does not say from when"),
    (lambda t: t.update(format=2), "format"),
])
def test_a_series_table_that_cannot_be_trusted_is_refused(tmp_path, damage, message):
    table = json.loads(SERIES.read_text())
    damage(table)
    path = tmp_path / "series.json"
    path.write_text(json.dumps(table))
    with pytest.raises(SeriesTableError, match=message):
        load_series(path)


def test_the_committed_series_table_binds_the_bls_endpoint_of_the_register():
    from atlas.capture.run import endpoints_from_register
    from atlas.rights import load_register

    endpoints = {e.id: e for e in endpoints_from_register(load_register())}
    series = load_series()
    assert {"cpi", "cpi_nsa", "payems", "unrate"} <= {entry["key"] for entry in series}
    assert len(series) == 67  # M8's four, M13's twenty-eight and M14's thirty-five
    for entry in series:
        endpoint = endpoints[entry["endpoint"]]
        asked = endpoint.params["expect" if endpoint.adapter == "fed_board" else "series"]
        assert entry["origin_id"] in asked
        assert entry["dataset"] in endpoint.datasets


# --- the command -----------------------------------------------------------------------------


def test_show_prints_the_log_of_a_series_and_as_of_prints_a_vintage(tmp_path, register, capsys):
    store = tmp_path / "store"
    capture(store, register, "1-initial", "2-revision", "3-withdrawal")
    run(store, register)
    capsys.readouterr()

    assert main(["--store", str(store), "--show", "fx_price"]) == 0
    out = capsys.readouterr().out
    assert "2026-02" in out and "withdrawn" in out and T3 in out
    assert main(["--store", str(store), "--show", "fx_price", "--as-of", "2026-04-15T00:00:00Z"]) == 0
    out = capsys.readouterr().out
    assert "100.400" in out and "101.300" not in out and "Atlas-observed" in out
    assert main(["--store", str(store), "--show", "fx_nothing"]) == 1


def test_atlas_replay_is_the_same_command(tmp_path, register):
    store = tmp_path / "store"
    capture(store, register, "1-initial")
    assert atlas_main(["replay", "--store", str(store), "--register", str(register),
                       "--series", str(SERIES)]) == 0
    assert VintageStore(store).series_keys() == ["fx_jobs", "fx_price"]


def test_a_capture_run_and_a_replay_do_not_share_the_store_at_once(tmp_path, register, capsys):
    from atlas.capture.store import locked

    store = tmp_path / "store"
    capture(store, register, "1-initial")
    with locked(store):
        assert run(store, register) == 1
    assert "holds this store" in capsys.readouterr().out


# --- the fixture ---------------------------------------------------------------------------------


def test_the_committed_fixture_is_what_its_script_writes(tmp_path):
    MAKE.build(tmp_path)
    for name, _began, _series in MAKE.FETCHES:
        relative = Path(name) / "fx" / "fx-bls-shape"
        _same, mismatch, errors = filecmp.cmpfiles(THREE / relative, tmp_path / relative,
                                                   ["exchange.json", "part-1.json"], shallow=False)
        assert (mismatch, errors) == ([], []), name


def test_the_fixture_is_invented_and_says_so():
    from atlas.capture.replay import read_exchanges

    for record in read_exchanges(THREE):
        assert record["provenance"]["synthetic"] is True
        assert record["provenance"]["origin"] == "Macro Atlas fixture (synthetic)"
