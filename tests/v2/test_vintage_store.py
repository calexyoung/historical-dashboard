"""The vintage store (PLAN M8, 4.3 and 9; ADR 0005, ADR 0022): what ``record`` writes for a
sequence of fetched states, read back through the store's own interface. Nothing here touches
the network or the wall clock: every time in a store is a Capture's retrieval time."""
from __future__ import annotations

import itertools
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from atlas.vintage import CaptureRef, SeriesState, StoreError, VintageStore

KEY = "fx_price"
META = {"name": "Fixture price index", "unit": "index, 2024-01 = 100", "seasonal_adjustment": "sa",
        "source": {"origin": {"producer": "Macro Atlas fixture (synthetic)", "dataset": "fixture",
                              "origin_id": "FX-PRICE"},
                   "channel": {"via": "fixture", "adapter": "fixture", "endpoint": "fx-a"}}}
REBASED = {**META, "unit": "index, 2025-01 = 100"}
T1, T2, T3 = "2026-03-10T13:30:01Z", "2026-04-10T12:30:01Z", "2026-05-12T12:30:01Z"


def at(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def state(observations: dict, *, scope=(None, None), complete=True, metadata=META, key=KEY,
          freq="monthly", problems=()):
    listed = []
    for period, value in observations.items():
        value, status = value if isinstance(value, tuple) else (value, "final")
        listed.append({"period": period, "value": value, "status": status})
    return SeriesState(key, freq, complete, scope, listed, metadata, list(problems))


def ref(name: str, when: str, **more) -> CaptureRef:
    return CaptureRef(name, at(when), "fixture", **more)


def brief(rows):
    """The parts of a log row a reader of these tests needs, in the log's order."""
    return [(r["period"], r["value"], r["status"], r["deleted"], r["recorded_from"], r["recorded_to"])
            for r in rows]


def files(store_dir: Path) -> dict[str, bytes]:
    return {str(path.relative_to(store_dir)): path.read_bytes()
            for path in sorted(store_dir.rglob("*")) if path.is_file()}


@pytest.fixture
def store(tmp_path):
    return VintageStore(tmp_path / "store")


# --- one behaviour at a time ---------------------------------------------------------------


def test_a_first_complete_state_opens_one_row_per_observation_at_the_retrieval_time(store):
    change = store.record(state({"2026-01": "100.0", "2026-02": ("100.4", "preliminary")}), ref("c1", T1))

    assert change.change == "first" and change.added == ["2026-01", "2026-02"]
    assert brief(store.rows(KEY)) == [
        ("2026-01", "100.0", "final", False, T1, None),
        ("2026-02", "100.4", "preliminary", False, T1, None),
    ]
    row = store.rows(KEY)[0]
    assert (row["key"], row["period_start"], row["period_end"]) == (KEY, "2026-01-01", "2026-01-31")
    assert (row["channel"], row["representation"], row["capture_id"]) == ("fixture", "native", "c1")
    # The provider gave no publication time and no Release exists yet: those clocks stay empty.
    assert [row[c] for c in ("provider_from", "provider_to", "provider_precision", "release_id")] == [None] * 4


def test_a_revision_opens_a_new_row_and_closes_the_old_one(store):
    store.record(state({"2026-01": "100.0", "2026-02": ("100.4", "preliminary")}), ref("c1", T1))
    change = store.record(state({"2026-01": "100.0", "2026-02": "100.6"}), ref("c2", T2))

    assert change.change == "revision" and change.revised == ["2026-02"] and change.added == []
    assert brief(store.rows(KEY)) == [
        ("2026-01", "100.0", "final", False, T1, None),
        ("2026-02", "100.4", "preliminary", False, T1, T2),
        ("2026-02", "100.6", "final", False, T2, None),
    ]


def test_a_change_of_status_alone_is_a_revision(store):
    store.record(state({"2026-02": ("100.4", "preliminary")}), ref("c1", T1))
    change = store.record(state({"2026-02": "100.4"}), ref("c2", T2))
    assert change.revised == ["2026-02"]
    assert [r["status"] for r in store.rows(KEY)] == ["preliminary", "final"]


def test_an_unchanged_complete_fetch_adds_a_confirmation_and_nothing_else(store):
    first = store.record(state({"2026-01": "100.0"}), ref("c1", T1))
    before = files(store.dir)
    change = store.record(state({"2026-01": "100.0"}), ref("c2", T2))
    after = files(store.dir)

    assert change.change == "none" and not (change.added or change.revised or change.withdrawn)
    assert change.state_hash == first.state_hash
    changed = {name for name in after if after[name] != before.get(name)}
    assert changed == {f"caplog/{KEY}.ndjson"}
    assert [(c["capture_id"], c["retrieved_at"], c["change"]) for c in store.captures(KEY)] == [
        ("c1", T1, "first"), ("c2", T2, "none")]


def test_the_same_number_spelled_differently_is_not_a_revision(store):
    store.record(state({"2026-01": "129.250"}), ref("c1", T1))
    change = store.record(state({"2026-01": "129.25"}), ref("c2", T2))
    assert change.change == "none"
    assert brief(store.rows(KEY)) == [("2026-01", "129.250", "final", False, T1, None)]


def test_a_period_that_disappears_from_a_complete_state_is_closed_with_a_tombstone(store):
    store.record(state({"2026-01": "100.0", "2026-02": "100.4"}), ref("c1", T1))
    change = store.record(state({"2026-01": "100.0"}), ref("c2", T2))

    assert change.change == "revision" and change.withdrawn == ["2026-02"]
    assert brief(store.rows(KEY)) == [
        ("2026-01", "100.0", "final", False, T1, None),
        ("2026-02", "100.4", "final", False, T1, T2),
        ("2026-02", None, None, True, T2, None),
    ]
    assert [o["period"] for o in store.vintage(KEY)] == ["2026-01"]


def test_a_period_outside_the_scope_was_not_asked_about_and_is_left_alone(store):
    store.record(state({"2025-12": "99.0", "2026-01": "100.0"}, scope=("2025-01-01", "2026-12-31")),
                 ref("c1", T1))
    # The window has slid: the source was asked about 2026 only.
    change = store.record(state({"2026-01": "100.0"}, scope=("2026-01-01", "2026-12-31")), ref("c2", T2))

    assert change.change == "none"
    assert brief(store.rows(KEY)) == [
        ("2025-12", "99.0", "final", False, T1, None),
        ("2026-01", "100.0", "final", False, T1, None),
    ]


def test_a_period_only_partly_inside_the_scope_is_outside_it(store):
    store.record(state({"2026-Q1": "5.0", "2026-Q2": "6.0"}, freq="quarterly"), ref("c1", T1))
    # Asked from 15 February: the first quarter was not wholly asked about.
    store.record(state({"2026-Q2": "6.0"}, freq="quarterly", scope=("2026-02-15", None)), ref("c2", T2))
    assert [o["period"] for o in store.vintage(KEY)] == ["2026-Q1", "2026-Q2"]


def test_a_withdrawn_period_that_stays_away_is_a_confirmation_and_one_that_returns_opens_a_row(store):
    store.record(state({"2026-01": "100.0", "2026-02": "100.4"}), ref("c1", T1))
    store.record(state({"2026-01": "100.0"}), ref("c2", T2))
    still_gone = store.record(state({"2026-01": "100.0"}), ref("c3", T3))
    assert still_gone.change == "none" and len(store.rows(KEY)) == 3

    back = store.record(state({"2026-01": "100.0", "2026-02": "100.5"}), ref("c4", "2026-06-10T12:30:01Z"))
    assert back.added == ["2026-02"]
    assert brief(store.rows(KEY))[1:] == [
        ("2026-02", "100.4", "final", False, T1, T2),
        ("2026-02", None, None, True, T2, "2026-06-10T12:30:01Z"),
        ("2026-02", "100.5", "final", False, "2026-06-10T12:30:01Z", None),
    ]


def test_an_incomplete_state_writes_nothing_and_says_why(store):
    store.record(state({"2026-01": "100.0", "2026-02": "100.4"}), ref("c1", T1))
    before = files(store.dir)
    change = store.record(state({"2026-01": "101.0"}, complete=False, problems=["series X has no rows"]),
                          ref("c2", T2))
    assert change.change == "skipped" and "series X has no rows" in change.reason
    assert files(store.dir) == before


def test_an_incomplete_first_state_creates_no_series(store):
    store.record(state({"2026-01": "100.0"}, complete=False), ref("c1", T1))
    assert store.series_keys() == [] and store.rows(KEY) == []


def test_a_missing_observation_is_a_fact_about_the_period_and_not_a_tombstone(store):
    store.record(state({"2026-01": (None, "missing")}), ref("c1", T1))
    assert brief(store.rows(KEY)) == [("2026-01", None, "missing", False, T1, None)]
    assert [(o["period"], o["value"]) for o in store.vintage(KEY)] == [("2026-01", None)]


def test_a_metadata_change_is_a_revision_even_when_the_numbers_match(store):
    store.record(state({"2026-01": "100.0"}), ref("c1", T1))
    change = store.record(state({"2026-01": "100.0"}, metadata=REBASED), ref("c2", T2))

    assert change.change == "metadata" and change.metadata_changed and change.relabelled == ["2026-01"]
    history = store.metadata_history(KEY)
    assert [(m["recorded_from"], m["recorded_to"], m["metadata"]["unit"]) for m in history] == [
        (T1, T2, "index, 2024-01 = 100"), (T2, None, "index, 2025-01 = 100")]
    rows = store.rows(KEY)
    assert brief(rows) == [("2026-01", "100.0", "final", False, T1, T2),
                           ("2026-01", "100.0", "final", False, T2, None)]
    assert [r["metadata_hash"] for r in rows] == [m["metadata_hash"] for m in history]


def test_a_value_outside_the_scope_keeps_the_metadata_it_was_recorded_under(store):
    store.record(state({"2025-12": "99.0", "2026-01": "100.0"}), ref("c1", T1))
    store.record(state({"2026-01": "50.0"}, scope=("2026-01-01", None), metadata=REBASED), ref("c2", T2))
    old, new = (m["metadata_hash"] for m in store.metadata_history(KEY))
    assert {o["period"]: o["metadata_hash"] for o in store.vintage(KEY)} == {"2025-12": old, "2026-01": new}


def test_a_vintage_is_the_state_at_an_instant(store):
    store.record(state({"2026-01": "100.0", "2026-02": "100.4"}), ref("c1", T1))
    store.record(state({"2026-01": "100.0", "2026-02": "100.6", "2026-03": "101.0"}), ref("c2", T2))
    store.record(state({"2026-01": "100.0", "2026-03": "101.0"}), ref("c3", T3))

    def values(when):
        return {o["period"]: o["value"] for o in store.vintage(KEY, when)}

    assert values(at(T1) - timedelta(seconds=1)) == {}
    assert values(at(T1)) == {"2026-01": "100.0", "2026-02": "100.4"}
    assert values(at(T2) - timedelta(seconds=1)) == {"2026-01": "100.0", "2026-02": "100.4"}
    assert values(at(T2)) == {"2026-01": "100.0", "2026-02": "100.6", "2026-03": "101.0"}
    assert values(at(T3)) == values(None) == {"2026-01": "100.0", "2026-03": "101.0"}


def test_the_state_hash_is_of_the_whole_current_state_and_nothing_else(tmp_path):
    a, b = VintageStore(tmp_path / "a"), VintageStore(tmp_path / "b")
    one = a.record(state({"2026-01": "100.0", "2026-02": "100.4"}), ref("c1", T1))
    revised = a.record(state({"2026-01": "100.0", "2026-02": "100.6"}), ref("c2", T2))
    # Another store that reached the same state by another road, at other times.
    direct = b.record(state({"2026-01": "100.00", "2026-02": "100.6"}), ref("x9", T3))
    assert one.state_hash != revised.state_hash == direct.state_hash
    assert len(revised.state_hash) == 64


def test_a_capture_older_than_the_last_one_recorded_is_refused(store):
    store.record(state({"2026-01": "100.0"}), ref("c2", T2))
    before = files(store.dir)
    with pytest.raises(StoreError, match="not after"):
        store.record(state({"2026-01": "99.0"}), ref("c1", T1))
    assert files(store.dir) == before


def test_recording_the_same_capture_again_changes_nothing(store):
    first = store.record(state({"2026-01": "100.0"}), ref("c1", T1))
    before = files(store.dir)
    again = store.record(state({"2026-01": "100.0"}), ref("c1", T1))
    assert again.already and again.state_hash == first.state_hash
    assert files(store.dir) == before


def test_two_captures_in_the_same_second_are_both_kept_in_capture_order(store):
    store.record(state({"2026-01": "100.0"}), ref("c1", T1))
    store.record(state({"2026-01": "100.2"}), ref("c2", T1))
    # The first row was never current at any instant; it is still evidence.
    assert brief(store.rows(KEY)) == [("2026-01", "100.0", "final", False, T1, T1),
                                      ("2026-01", "100.2", "final", False, T1, None)]
    assert [o["value"] for o in store.vintage(KEY, at(T1))] == ["100.2"]


@pytest.mark.parametrize("bad, message", [
    (state({"2026-13": "1"}), "not a monthly Period"),
    (state({"2026-01": "1e3"}), "not a decimal number"),
    (state({"2026-01": "NaN"}), "not a decimal number"),
    (state({"2026-01": ("1.0", "observed")}), "status"),
    (state({"2026-01": (None, "final")}), "no value"),
    (state({"2026-01": ("1.0", "missing")}), "carries a value"),
    (state({"2026-01": "1.0"}, key="Bad Key"), "key"),
    (state({"2026-01": "1.0"}, freq="fortnightly"), "frequency"),
    (state({"2026-01": "1.0"}, scope=("2026-02-01", None)), "outside the scope"),
    (state({"2026-01": "1.0"}, metadata={"unit": float("nan")}), "metadata"),
])
def test_a_state_the_log_cannot_hold_is_refused_and_nothing_is_written(store, bad, message):
    with pytest.raises(StoreError, match=message):
        store.record(bad, ref("c1", T1))
    assert not store.dir.exists() or files(store.dir) == {}


def test_a_period_given_twice_is_refused(store):
    twice = SeriesState(KEY, "monthly", True, (None, None),
                        [{"period": "2026-01", "value": "1", "status": "final"},
                         {"period": "2026-01", "value": "2", "status": "final"}], META)
    with pytest.raises(StoreError, match="twice"):
        store.record(twice, ref("c1", T1))


def test_a_frequency_cannot_change_under_a_key(store):
    store.record(state({"2026-01": "1.0"}), ref("c1", T1))
    with pytest.raises(StoreError, match="monthly"):
        store.record(state({"2026-Q1": "1.0"}, freq="quarterly"), ref("c2", T2))


def test_invented_values_and_agency_values_are_never_mixed_in_one_store(store):
    store.record(state({"2026-01": "1.0"}), ref("c1", T1, real_bytes=False))
    with pytest.raises(StoreError, match="invented"):
        store.record(state({"2026-01": "1.0"}), ref("c2", T2, real_bytes=True))
    with pytest.raises(StoreError, match="invented"):
        store.record(state({"2026-01": "1.0"}, key="fx_other"), ref("c2", T2, real_bytes=True))


def test_a_record_cut_off_part_way_is_finished_by_recording_the_capture_again(tmp_path, monkeypatch):
    import atlas.vintage.store as module

    whole = VintageStore(tmp_path / "whole")
    cut = VintageStore(tmp_path / "cut")
    for target in (whole, cut):
        target.record(state({"2026-01": "100.0", "2026-02": "100.4"}), ref("c1", T1))
    second = state({"2026-01": "100.0", "2026-03": "101.0"}, metadata=REBASED)
    expected = whole.record(second, ref("c2", T2))

    real = module.append_line

    def dies_at_the_capture_log(path, record):
        if path.parent.name == "caplog":
            raise OSError("the machine stopped")
        real(path, record)

    monkeypatch.setattr(module, "append_line", dies_at_the_capture_log)
    with pytest.raises(OSError):
        cut.record(second, ref("c2", T2))
    monkeypatch.setattr(module, "append_line", real)

    # Nothing else may be recorded over the half-written capture.
    with pytest.raises(StoreError, match="c2"):
        cut.record(state({"2026-01": "100.0"}), ref("c3", T3))
    finished = cut.record(second, ref("c2", T2))
    assert finished == expected
    assert files(cut.dir) == files(whole.dir)


# --- the properties of PLAN section 9 ---------------------------------------------------------

PERIODS = [f"2025-{month:02d}" for month in range(1, 9)]
METADATA = [META, REBASED]
START = at("2026-01-05T15:00:00Z")


@st.composite
def fetches(draw):
    """A sequence of fetched states for one Series: each asked about a run of months, came back
    whole or not, and holds any subset of the months asked about."""
    sequence = []
    for _ in range(draw(st.integers(1, 7))):
        low = draw(st.integers(0, len(PERIODS) - 1))
        high = draw(st.integers(low, len(PERIODS) - 1))
        whole_history = draw(st.booleans())
        asked = PERIODS if whole_history else PERIODS[low:high + 1]
        content = {}
        for period in asked:
            kind = draw(st.sampled_from(["absent", "final", "final", "preliminary", "missing"]))
            if kind == "missing":
                content[period] = (None, "missing")
            elif kind != "absent":
                content[period] = (draw(st.sampled_from(["1", "1.0", "2.5", "-3", "0"])), kind)
        sequence.append({
            "scope": (None, None) if whole_history else (f"{asked[0]}-01", _month_end(asked[-1])),
            "asked": asked, "content": content, "complete": draw(st.integers(0, 4)) > 0,
            "metadata": draw(st.sampled_from([0, 0, 0, 1])),
            "wait": draw(st.sampled_from([0, 1, 3600, 86400, 3 * 86400])),
        })
    return sequence


def _month_end(period: str) -> str:
    import calendar

    year, month = map(int, period.split("-"))
    return f"{period}-{calendar.monthrange(year, month)[1]:02d}"


def _number(text):
    from decimal import Decimal

    return None if text is None else Decimal(text)


def play(store: VintageStore, sequence):
    """Record a sequence, checking each step against a model kept the plain way: a dict of what
    is current. Returns the model's state after each capture, with the capture's time."""
    model: dict[str, tuple] = {}
    in_force = None
    snapshots, moment = [], START
    for number, fetch in enumerate(sequence):
        moment += timedelta(seconds=fetch["wait"])
        before = files(store.dir) if store.dir.exists() else {}
        metadata = METADATA[fetch["metadata"]]
        change = store.record(
            state(fetch["content"], scope=fetch["scope"], complete=fetch["complete"], metadata=metadata),
            CaptureRef(f"c{number:03d}", moment, "fixture"))
        after = files(store.dir) if store.dir.exists() else {}
        touched = {name.split("/")[0] for name in after if after[name] != before.get(name)}
        if not fetch["complete"]:
            # Tombstones, and everything else, only from complete states.
            assert change.change == "skipped" and touched == set()
            continue
        previous = dict(model)
        for period in fetch["asked"]:
            if period in fetch["content"]:
                value, status = fetch["content"][period]
                model[period] = (_number(value), status, fetch["metadata"])
            else:
                model.pop(period, None)
        first = in_force is None
        metadata_changed = not first and in_force != fetch["metadata"]
        in_force = fetch["metadata"]
        if first:
            assert change.change == "first"
        elif model == previous and not metadata_changed:
            # An unchanged complete fetch adds a confirmation only.
            assert change.change == "none" and touched == {"caplog"}
        else:
            assert change.change in ("revision", "metadata")
            assert change.metadata_changed == metadata_changed
            assert "caplog" in touched and ("metalog" in touched) == metadata_changed
            assert ("obslog" in touched) == (model != previous)
        snapshots.append((moment, dict(model)))
    return snapshots


def seen(store: VintageStore, when=None) -> dict:
    hashes = [m["metadata_hash"] for m in store.metadata_history(KEY)]
    by_content = {digest: METADATA.index(m["metadata"]) for digest, m in
                  zip(hashes, store.metadata_history(KEY), strict=True)}
    return {o["period"]: (_number(o["value"]), o["status"], by_content[o["metadata_hash"]])
            for o in store.vintage(KEY, when)}


@settings(max_examples=120, deadline=None)
@given(fetches())
def test_every_vintage_is_the_state_the_fetches_describe(sequence):
    with tempfile.TemporaryDirectory() as tmp:
        store = VintageStore(Path(tmp) / "store")
        snapshots = play(store, sequence)
        last_at = {moment: expected for moment, expected in snapshots}
        for moment, expected in last_at.items():
            assert seen(store, moment) == expected
        if snapshots:
            assert seen(store) == snapshots[-1][1]
            assert seen(store, START - timedelta(days=1)) == {}


@settings(max_examples=120, deadline=None)
@given(fetches())
def test_validity_intervals_never_overlap_and_tombstones_come_only_from_complete_fetches(sequence):
    with tempfile.TemporaryDirectory() as tmp:
        store = VintageStore(Path(tmp) / "store")
        snapshots = play(store, sequence)
        complete_times = {moment.strftime("%Y-%m-%dT%H:%M:%SZ") for moment, _ in snapshots}
        chains: dict[str, list[dict]] = {}
        for row in store.rows(KEY):
            chains.setdefault(row["period"], []).append(row)
        for chain in chains.values():
            for earlier, later in itertools.pairwise(chain):
                # Each version ends exactly where the next begins: no overlap and no hole.
                assert earlier["recorded_to"] == later["recorded_from"]
                assert earlier["recorded_from"] <= earlier["recorded_to"]
                assert not (earlier["deleted"] and later["deleted"])
            assert chain[-1]["recorded_to"] is None
            assert not chain[0]["deleted"]
            for row in chain:
                assert row["recorded_from"] in complete_times
                assert (row["value"] is None and row["status"] is None) if row["deleted"] else row["status"]


@settings(max_examples=60, deadline=None)
@given(fetches())
def test_recording_the_same_fetches_again_gives_the_same_store_byte_for_byte(sequence):
    with tempfile.TemporaryDirectory() as tmp:
        one, two = VintageStore(Path(tmp) / "one"), VintageStore(Path(tmp) / "two")
        play(one, sequence)
        play(two, sequence)
        assert (files(one.dir) if one.dir.exists() else {}) == (files(two.dir) if two.dir.exists() else {})
