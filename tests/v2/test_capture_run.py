"""The capture kit (PLAN M7, 4.3, 4.7; ADR 0012, ADR 0021): a run keeps the exact bytes a source
served, with the evidence needed to replay them later. Raw only: no store of observations, no
Release. Every test drives a run through `run_capture` with a scripted transport."""
import gzip
import hashlib
import json

import pytest

from atlas.capture import run_capture
from atlas.capture.store import read_fetch_log, read_runs

from .capture_helpers import (
    Scripted,
    fixture_endpoint,
    fixture_register,
    refused,
)

URL = "https://fixture.invalid/a"
BODY = "period,value\n2026-01,1.5\n# end\n"
SHA = hashlib.sha256(BODY.encode()).hexdigest()


def finished(store):
    return [line for line in read_runs(store) if line["event"] == "finished"]


def run(tmp_path, transport, table=None, **kw):
    kw.setdefault("sleep", lambda seconds: None)
    return run_capture(tmp_path / "store", table or fixture_register(), transport, **kw)


def test_a_capture_keeps_the_exact_bytes_and_writes_one_fetch_log_line(tmp_path):
    transport = Scripted({URL: [(200, BODY, [["Content-Type", "text/csv"], ["ETag", '"a1"']])]})
    result = run(tmp_path, transport)

    assert result.exit_code == 0
    blob = tmp_path / "store" / "raw" / "fx" / "2026-11-11" / f"{SHA}.gz"
    assert gzip.decompress(blob.read_bytes()) == BODY.encode()

    [line] = read_fetch_log(tmp_path / "store")
    assert line["endpoint"] == "fx-a"
    assert line["source"] == "fx"
    assert line["origin"] == "Macro Atlas fixture (synthetic)"
    assert line["channel"] == "fixture"
    assert line["outcome"] == "captured"
    assert line["evidence"]["complete"] is True
    assert line["retrieved_at"] == "2026-11-11T15:50:01Z"
    assert line["register"]["version"] == "test-1"
    assert line["adapter"] == {"name": "fixture", "version": 1}
    [part] = line["parts"]
    assert part["request"]["method"] == "GET"
    assert part["request"]["url"] == URL
    assert part["status"] == 200
    assert ["ETag", '"a1"'] in part["headers"]
    assert part["sha256"] == SHA
    assert part["bytes"] == len(BODY)
    assert part["blob"] == f"raw/fx/2026-11-11/{SHA}.gz"
    assert part["received_at"] == "2026-11-11T15:50:01Z"


def test_the_same_bytes_fetched_twice_are_two_captures_of_one_blob(tmp_path):
    first = Scripted({URL: [(200, BODY)]}, start="2026-11-11T15:50:00")
    second = Scripted({URL: [(200, BODY)]}, start="2026-11-11T22:45:00")
    run(tmp_path, first)
    run(tmp_path, second)

    lines = read_fetch_log(tmp_path / "store")
    assert [line["retrieved_at"] for line in lines] == ["2026-11-11T15:50:01Z", "2026-11-11T22:45:01Z"]
    assert lines[0]["capture_id"] != lines[1]["capture_id"]
    assert len(list((tmp_path / "store" / "raw").rglob("*.gz"))) == 1


def test_a_blob_is_written_the_same_way_every_time(tmp_path):
    run(tmp_path / "a", Scripted({URL: [(200, BODY)]}))
    run(tmp_path / "b", Scripted({URL: [(200, BODY)]}))
    [one] = (tmp_path / "a").rglob("*.gz")
    [two] = (tmp_path / "b").rglob("*.gz")
    assert one.read_bytes() == two.read_bytes()


def test_an_incomplete_response_is_kept_and_flagged(tmp_path):
    cut_short = "period,value\n2026-01,1.5\n"  # the fixture format ends with "# end"
    result = run(tmp_path, Scripted({URL: [(200, cut_short)]}))

    assert result.exit_code == 1
    [line] = read_fetch_log(tmp_path / "store")
    assert line["outcome"] == "incomplete"
    assert line["evidence"]["complete"] is False
    assert line["evidence"]["problems"] == ["the body does not end with the line '# end'"]
    assert (tmp_path / "store" / line["parts"][0]["blob"]).exists()
    assert any("INCOMPLETE fx-a" in text for text in result.lines)


def test_a_failed_fetch_is_logged_as_failed_and_fails_the_run(tmp_path):
    result = run(tmp_path, Scripted({URL: [(404, "<html>not here</html>")]}))

    assert result.exit_code == 1
    [line] = read_fetch_log(tmp_path / "store")
    assert line["outcome"] == "failed"
    assert "HTTP 404" in line["error"]
    assert line["retrieved_at"] is None
    assert line["parts"][0]["status"] == 404  # what the source did answer is kept as evidence
    assert any("FAILED fx-a" in text for text in result.lines)


def test_one_endpoint_failing_does_not_stop_the_next(tmp_path):
    other = "https://fixture.invalid/b"
    table = fixture_register(endpoints=[fixture_endpoint(), fixture_endpoint("fx-b", other)])
    transport = Scripted({URL: [refused()] * 4, other: [(200, BODY)]})
    result = run(tmp_path, transport, table)

    assert result.exit_code == 1
    assert {line["endpoint"]: line["outcome"] for line in read_fetch_log(tmp_path / "store")} == {
        "fx-a": "failed", "fx-b": "captured"}


@pytest.mark.parametrize("table, reason", [
    (fixture_register(signed=False), "is not signed"),
    (fixture_register(store=False), "does not allow store"),
])
def test_an_uncleared_row_fails_the_run_before_anything_is_fetched(tmp_path, table, reason):
    transport = Scripted({URL: [(200, BODY)]})
    result = run(tmp_path, transport, table)

    assert result.exit_code == 1
    assert transport.sent == []
    assert not (tmp_path / "store").exists()
    assert any("fx-a" in text and reason in text for text in result.lines)


def test_one_uncleared_endpoint_stops_the_cleared_ones_too(tmp_path):
    from .capture_helpers import origin_row, register

    table = register(
        origin_row("fx", "Macro Atlas fixture (synthetic)", [fixture_endpoint()]),
        origin_row("other", "Another origin", [fixture_endpoint("ot-a", "https://o.invalid/a")],
                   signed=False),
    )
    transport = Scripted({URL: [(200, BODY)]})
    assert run(tmp_path, transport, table).exit_code == 1
    assert transport.sent == []


def test_only_narrows_a_run_to_named_rows_and_refuses_a_name_it_does_not_know(tmp_path):
    from .capture_helpers import origin_row, register

    table = register(
        origin_row("fx", "Macro Atlas fixture (synthetic)", [fixture_endpoint()]),
        origin_row("other", "Another origin", [fixture_endpoint("ot-a", "https://o.invalid/a")],
                   signed=False),
    )
    assert run(tmp_path, Scripted({URL: [(200, BODY)]}), table, only=["fx"]).exit_code == 0
    unknown = run(tmp_path, Scripted({}), table, only=["nope"])
    assert unknown.exit_code == 1
    assert any("nope" in text for text in unknown.lines)


def test_a_register_the_gate_cannot_trust_fails_the_run(tmp_path):
    table = fixture_register()
    table["format"] = 99
    transport = Scripted({URL: [(200, BODY)]})
    result = run(tmp_path, transport, table)
    assert result.exit_code == 1
    assert transport.sent == []
    assert any("cannot be trusted" in text for text in result.lines)


def test_a_register_with_no_endpoints_fails_the_run(tmp_path):
    table = fixture_register()
    del table["rows"][0]["capture"]
    assert run(tmp_path, Scripted({}), table).exit_code == 1


def test_a_skipped_day_is_reported(tmp_path):
    run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-08T15:50:00"))
    # Nothing ran on the 9th; the 10th's response was incomplete.
    run(tmp_path, Scripted({URL: [(200, "cut")]}, start="2026-11-10T15:50:00"))
    result = run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-11T15:50:00"))

    assert result.missed == {"fx-a": ["2026-11-09", "2026-11-10"]}
    assert any("MISSED fx-a: 2026-11-09, 2026-11-10" in text for text in result.lines)
    assert result.exit_code == 0  # a missed day cannot be recovered; it is reported, not fatal
    assert finished(tmp_path / "store")[-1]["missed"] == {"fx-a": ["2026-11-09", "2026-11-10"]}


def test_an_endpoint_that_has_never_succeeded_is_missed_from_its_first_run(tmp_path):
    run(tmp_path, Scripted({URL: [(500, "x")] * 4}, start="2026-11-09T15:50:00"))
    result = run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-11T15:50:00"))
    assert result.missed == {"fx-a": ["2026-11-09", "2026-11-10"]}


def test_days_are_counted_in_new_york_where_the_releases_happen(tmp_path):
    # 02:30 UTC on the 10th is still the evening of the 9th in New York.
    run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-10T02:30:00"))
    result = run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-11T15:50:00"))
    assert result.missed == {"fx-a": ["2026-11-10"]}


def test_a_run_line_records_what_was_selected_and_how_it_ended(tmp_path):
    run(tmp_path, Scripted({URL: [(200, BODY)]}))
    started, ended = read_runs(tmp_path / "store")
    assert started["event"] == "started" and ended["event"] == "finished"
    assert started["run_id"] == ended["run_id"]
    assert started["selected"] == ["fx-a"] and started["transport"] == "replay"
    assert started["started_at"] == "2026-11-11T15:50:00Z"
    assert ended["outcomes"] == {"fx-a": "captured"}
    assert ended["exit_code"] == 0


class Crash(BaseException):
    """The process dying mid-run: not an error the run handles."""


def crashed_run(tmp_path, start, kind="replay"):
    transport = Scripted({URL: [Crash()]}, start=start)
    transport.kind = kind
    with pytest.raises(Crash):
        run(tmp_path, transport)


def test_a_run_that_died_is_reported_and_its_day_still_counts_as_due(tmp_path):
    crashed_run(tmp_path, "2026-11-09T15:50:00")
    result = run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-11T15:50:00"))
    assert any("started at 2026-11-09T15:50:00Z and did not finish" in text for text in result.lines)
    assert result.missed == {"fx-a": ["2026-11-09", "2026-11-10"]}


def test_a_run_that_died_still_keeps_replayed_bytes_out_of_a_store_of_real_ones(tmp_path):
    crashed_run(tmp_path, "2026-11-09T15:50:00", kind="live")
    transport = Scripted({URL: [(200, BODY)]})
    result = run(tmp_path, transport)
    assert result.exit_code == 1 and transport.sent == []
    assert "holds a live run and this run is replay" in result.lines[-1]


def test_an_answer_the_adapter_cannot_read_at_all_is_a_failure_with_the_bytes_kept(tmp_path, monkeypatch):
    from atlas.capture.adapters import ADAPTERS

    def broken(scope, bodies):
        raise AttributeError("'NoneType' object has no attribute 'get'")

    monkeypatch.setattr(ADAPTERS["fixture"], "examine", broken)
    other = "https://fixture.invalid/b"
    table = fixture_register(endpoints=[fixture_endpoint(), fixture_endpoint("fx-b", other)])
    result = run(tmp_path, Scripted({URL: [(200, BODY)], other: [(200, BODY)]}), table)

    first, second = read_fetch_log(tmp_path / "store")
    assert first["outcome"] == "failed" and "could not read the answer" in first["error"]
    assert (tmp_path / "store" / first["parts"][0]["blob"]).exists()
    assert second["endpoint"] == "fx-b"  # the run went on
    assert result.exit_code == 1


def test_a_log_line_torn_inside_a_character_does_not_stop_the_next_run(tmp_path):
    run(tmp_path, Scripted({URL: [(200, BODY)]}))
    with open(tmp_path / "store" / "fetchlog.ndjson", "ab") as handle:
        handle.write(b'{"note": "caf' + "é".encode()[:1])  # half of a two-byte character
    result = run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-11T22:45:00"))
    assert result.exit_code == 0
    assert any("fetchlog.ndjson line 2 is not whole" in text for text in result.lines)
    assert len(read_fetch_log(tmp_path / "store")) == 2


def test_an_endpoint_cannot_borrow_another_rows_signature(tmp_path):
    from .capture_helpers import origin_row, register

    endpoint = fixture_endpoint()
    endpoint["datasets"] = ["signed set"]
    table = register(
        origin_row("unsigned", "One origin", [endpoint], signed=False, datasets=["unsigned set"]),
        origin_row("signed", "One origin", [], datasets=["signed set"]),
    )
    transport = Scripted({URL: [(200, BODY)]})
    result = run(tmp_path, transport, table)
    assert result.exit_code == 1 and transport.sent == []
    assert any("names a dataset its row does not cover" in text for text in result.lines)


def test_a_fetch_log_line_says_whether_its_bytes_are_real(tmp_path):
    run(tmp_path, Scripted({URL: [(200, BODY)]}))
    assert read_fetch_log(tmp_path / "store")[0]["real_bytes"] is False


def test_a_second_run_on_a_locked_store_exits_at_once(tmp_path):
    import fcntl

    store = tmp_path / "store"
    store.mkdir()
    with open(store / "LOCK", "w") as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        transport = Scripted({URL: [(200, BODY)]})
        result = run(tmp_path, transport)
    assert result.exit_code == 1
    assert transport.sent == []
    assert any("another capture run holds" in text for text in result.lines)


def test_a_fetch_log_cut_off_mid_line_is_reported_and_the_next_line_is_whole(tmp_path):
    run(tmp_path, Scripted({URL: [(200, BODY)]}))
    log = tmp_path / "store" / "fetchlog.ndjson"
    with open(log, "a") as handle:
        handle.write('{"endpoint": "fx-a", "outc')  # a crash mid-write
    result = run(tmp_path, Scripted({URL: [(200, BODY)]}, start="2026-11-11T22:45:00"))

    assert any("fetchlog.ndjson line 2 is not whole" in text for text in result.lines)
    lines = log.read_text().splitlines()
    assert json.loads(lines[-1])["retrieved_at"] == "2026-11-11T22:45:01Z"
    assert [line["retrieved_at"] for line in read_fetch_log(tmp_path / "store")] == [
        "2026-11-11T15:50:01Z", "2026-11-11T22:45:01Z"]


def test_set_cookie_values_and_secrets_never_reach_the_log(tmp_path):
    headers = [["Set-Cookie", "JSESSIONID=abc123; Path=/"], ["Content-Type", "text/plain"]]
    transport = Scripted({URL + "?key=s3cret": [(200, BODY, headers)]})
    table = fixture_register(endpoints=[fixture_endpoint(url=URL + "?key=s3cret")])
    run(tmp_path, transport, table, secrets=["s3cret"])

    text = (tmp_path / "store" / "fetchlog.ndjson").read_text()
    assert "abc123" not in text and "s3cret" not in text
    assert "REDACTED" in text
    assert transport.sent[0].url.endswith("key=s3cret")  # the real request is not altered
