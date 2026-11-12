"""API keys (PLAN M15; ADR 0029): a key is added to a request as it is sent to a source and is
in nothing the kit keeps: no URL, no header, no body, no reason for a retry. A replay asks for
none and sends none."""
import gzip
import json

import pytest

from atlas.capture import run_capture
from atlas.capture.cli import main as capture_main
from atlas.capture.http import CaptureError, Request, Session, usable_key
from atlas.capture.replay import ReplayTransport, export_exchanges
from atlas.capture.store import read_fetch_log, read_runs

from .capture_helpers import LiveScripted, Scripted, fixture_endpoint, fixture_register, refused

KEY = "AB12CD34-EF56-7890-ABCD-EF1234567890"
URL = "https://keyed.invalid/api/data?method=GetData"
SENT = URL + "&UserID=" + KEY
ASK = Request("GET", URL, key=("UserID", "BEA_API_KEY"))


def live(answers, keys):
    transport = LiveScripted(answers)
    return Session(transport, sleep=lambda s: None, monotonic=lambda: 0.0, keys=keys), transport


def test_the_key_is_sent_and_the_request_that_is_kept_does_not_hold_it():
    http, transport = live({SENT: [(200, "ok")]}, {"BEA_API_KEY": KEY})
    part = http.send(ASK)
    assert transport.sent[0].url == SENT
    assert part.request.url == URL
    assert part.response.body == b"ok" and part.key_removed == 0


def test_a_key_the_source_echoes_is_taken_out_of_the_body_and_the_headers_before_anything_is_kept():
    body = '{"Request":[{"ParameterName":"USERID","ParameterValue":"KEY"}],"again":"KEY"}'.replace("KEY", KEY)
    headers = [["Content-Type", "application/json"], ["Location", "/x?UserID=" + KEY]]
    http, _ = live({SENT: [(200, body, headers)]}, {"BEA_API_KEY": KEY})
    part = http.send(ASK)
    assert part.response.body == (
        b'{"Request":[{"ParameterName":"USERID","ParameterValue":"REDACTED"}],"again":"REDACTED"}')
    assert part.response.headers[1] == ["Location", "/x?UserID=REDACTED"]
    assert part.key_removed == 3


def test_every_key_of_the_run_is_taken_out_and_the_longer_first():
    other = KEY + "-LONGER"
    http, _ = live({SENT: [(200, f"a {other} b {KEY} c")]}, {"BEA_API_KEY": KEY, "EIA_API_KEY": other})
    assert http.send(ASK).response.body == b"a REDACTED b REDACTED c"


def test_a_network_error_that_quotes_the_url_does_not_carry_the_key_into_the_reasons():
    http, _ = live({SENT: [refused(f"timed out reading {SENT}"), (200, "ok")]}, {"BEA_API_KEY": KEY})
    assert http.send(ASK).tries == [f"timed out reading {URL}&UserID=REDACTED"]
    http, _ = live({SENT: [refused(f"reset by {SENT}")] * 4}, {"BEA_API_KEY": KEY})
    with pytest.raises(CaptureError) as error:
        http.send(ASK)
    assert KEY not in str(error.value) and "REDACTED" in str(error.value)


def test_a_live_request_that_needs_a_key_the_run_does_not_have_is_never_sent():
    http, transport = live({}, {})
    with pytest.raises(CaptureError, match="BEA_API_KEY is not set"):
        http.send(ASK)
    assert transport.sent == []


def test_a_replay_sends_the_request_as_it_was_recorded_whatever_keys_are_about():
    transport = Scripted({URL: [(200, f"echo {KEY}")]})
    http = Session(transport, sleep=lambda s: None, monotonic=lambda: 0.0, keys={"BEA_API_KEY": KEY})
    part = http.send(ASK)
    assert transport.sent[0].url == URL
    assert part.response.body == f"echo {KEY}".encode()  # recorded bytes are not altered


def test_a_key_is_usable_only_in_the_shape_that_survives_a_url_and_json_unchanged():
    assert usable_key(KEY) and usable_key("abcDEF0123456789abcDEF0123456789abcdefgh")
    for bad in ("", "short", "has space 0123456789", "pct%2Fslash0123456", 'quo"te0123456789ab', "ünïcode0123456789"):
        assert not usable_key(bad)


# --- a run -------------------------------------------------------------------------------

PLAIN = "https://fixture.invalid/a"
KEYED = "https://fixture.invalid/keyed?table=1"
KEYED_SENT = KEYED + "&token=" + KEY
ECHO = f'asked with "{KEY}"\n# end\n'


def keyed_register():
    keyed = fixture_endpoint("fx-keyed", KEYED)
    keyed["params"]["key"] = {"parameter": "token", "name": "FIXTURE_API_KEY"}
    return fixture_register(endpoints=[keyed, fixture_endpoint()])


def everything_under(directory) -> bytes:
    """Every byte a run left behind, blobs unpacked."""
    out = b""
    for path in sorted(directory.rglob("*")):
        if path.is_file():
            data = path.read_bytes()
            out += path.name.encode() + (gzip.decompress(data) if path.suffix == ".gz" else data)
    return out


def test_a_run_with_its_key_keeps_the_answer_and_the_key_is_in_no_byte_it_writes(tmp_path):
    headers = [["Content-Type", "text/plain"], ["X-Request", KEYED_SENT]]
    transport = LiveScripted({KEYED_SENT: [refused(f"reset by {KEYED_SENT}"), (200, ECHO, headers)],
                              PLAIN: [(200, "x\n# end\n")]})
    result = run_capture(tmp_path / "store", keyed_register(), transport, sleep=lambda s: None,
                         keys={"FIXTURE_API_KEY": KEY})
    assert result.exit_code == 0, result.lines
    kept = everything_under(tmp_path / "store")
    assert KEY.encode() not in kept and KEY not in "\n".join(result.lines)
    line = read_fetch_log(tmp_path / "store")[0]
    [part] = line["parts"]
    assert part["request"]["url"] == KEYED and part["key_removed"] == 2
    assert line["key"] == "FIXTURE_API_KEY"
    blob = gzip.decompress((tmp_path / "store" / part["blob"]).read_bytes())
    assert blob == b'asked with "REDACTED"\n# end\n'
    assert part["retried_after"] == [f"reset by {KEYED}&token=REDACTED"]
    assert "key" not in read_fetch_log(tmp_path / "store")[1]


def test_a_failed_keyed_fetch_keeps_the_error_page_without_the_key(tmp_path):
    transport = LiveScripted({KEYED_SENT: [(403, f'{{"error":"bad key {KEY}"}}')], PLAIN: [(200, "x\n# end\n")]})
    result = run_capture(tmp_path / "store", keyed_register(), transport, sleep=lambda s: None,
                         keys={"FIXTURE_API_KEY": KEY})
    assert result.outcomes == {"fx-keyed": "failed", "fx-a": "captured"}
    assert KEY.encode() not in everything_under(tmp_path / "store")
    assert KEY not in "\n".join(result.lines)


def test_without_its_key_an_endpoint_is_not_asked_and_is_stale_and_the_rest_is_fetched(tmp_path):
    store = tmp_path / "store"
    first = LiveScripted({KEYED_SENT: [(200, ECHO)], PLAIN: [(200, "x\n# end\n")]})
    run_capture(store, keyed_register(), first, sleep=lambda s: None, keys={"FIXTURE_API_KEY": KEY})

    second = LiveScripted({PLAIN: [(200, "x\n# end\n")]}, start="2026-11-12T15:50:00")
    result = run_capture(store, keyed_register(), second, sleep=lambda s: None, keys={})
    assert result.outcomes == {"fx-keyed": "no_key", "fx-a": "captured"}
    assert result.exit_code == 1
    assert ("STALE fx-keyed: stale, last fetched 2026-11-11T15:50:01Z (FIXTURE_API_KEY is not set; "
            "nothing was asked)") in result.lines
    assert [request.url for request in second.sent] == [PLAIN]
    line = read_fetch_log(store)[2]
    assert (line["outcome"], line["parts"], line["retrieved_at"], line["evidence"]) == ("no_key", [], None, None)
    assert line["error"] == "FIXTURE_API_KEY is not set" and line["key"] == "FIXTURE_API_KEY"
    assert [r for r in read_runs(store) if r["event"] == "finished"][-1]["outcomes"]["fx-keyed"] == "no_key"


def test_an_endpoint_never_fetched_says_so_and_a_key_of_the_wrong_shape_is_not_sent(tmp_path):
    transport = LiveScripted({PLAIN: [(200, "x\n# end\n")]})
    result = run_capture(tmp_path / "store", keyed_register(), transport, sleep=lambda s: None,
                         keys={"FIXTURE_API_KEY": "wrong shape!"})
    assert ("STALE fx-keyed: stale, never fetched (FIXTURE_API_KEY is not a key of the expected "
            "shape; nothing was asked)") in result.lines
    assert "wrong shape!" not in (tmp_path / "store" / "fetchlog.ndjson").read_text()
    assert [request.url for request in transport.sent] == [PLAIN]


def test_a_missing_key_does_not_get_a_run_past_the_rights_gate(tmp_path):
    table = keyed_register()
    table["rows"][0]["decision"] = None
    result = run_capture(tmp_path / "store", table, LiveScripted({}), keys={})
    assert result.exit_code == 1 and not (tmp_path / "store").exists()
    assert all(line.startswith("REFUSED") or "Nothing was fetched" in line for line in result.lines)


def test_a_capture_made_with_a_key_exports_and_replays_without_one(tmp_path, monkeypatch):
    store, out = tmp_path / "store", tmp_path / "fixtures"
    transport = LiveScripted({KEYED_SENT: [(200, ECHO)], PLAIN: [(200, "x\n# end\n")]})
    transport.real = False
    run_capture(store, keyed_register(), transport, sleep=lambda s: None, keys={"FIXTURE_API_KEY": KEY})
    assert export_exchanges(store, out, keyed_register(), note="test") == ["fx-a", "fx-keyed"]
    assert KEY.encode() not in everything_under(out)
    exchange = json.loads((out / "fx" / "fx-keyed" / "exchange.json").read_text())
    assert exchange["exchanges"][0]["request"]["url"] == KEYED
    assert exchange["exchanges"][0]["key_removed"] == 1

    # A replay, with a key lying about in the environment: none is sent and nothing is altered.
    again = run_capture(tmp_path / "again", keyed_register(), ReplayTransport(out), sleep=lambda s: None,
                        keys={"FIXTURE_API_KEY": KEY})
    assert again.exit_code == 0, again.lines
    [first] = [line for line in read_fetch_log(tmp_path / "again") if line["endpoint"] == "fx-keyed"]
    assert first["parts"][0]["sha256"] == read_fetch_log(store)[0]["parts"][0]["sha256"]


def test_the_command_reads_keys_from_the_environment_and_says_only_whether_each_is_set(tmp_path, monkeypatch, capsys):
    register = tmp_path / "register.json"
    register.write_text(json.dumps(keyed_register()))
    monkeypatch.setenv("FIXTURE_API_KEY", KEY)
    assert capture_main(["--register", str(register), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "fx-keyed (row fx, fixture adapter): cleared for storage; needs FIXTURE_API_KEY, which is set" in out
    monkeypatch.delenv("FIXTURE_API_KEY")
    assert capture_main(["--register", str(register), "--dry-run"]) == 0
    out += capsys.readouterr().out
    assert "needs FIXTURE_API_KEY, which is not set: it would not be asked" in out
    assert KEY not in out


def test_status_says_stale_and_when_it_was_last_fetched(tmp_path, capsys):
    store, register = tmp_path / "store", tmp_path / "register.json"
    register.write_text(json.dumps(keyed_register()))
    run_capture(store, keyed_register(), LiveScripted({KEYED_SENT: [(200, ECHO)], PLAIN: [(200, "x\n# end\n")]}),
                sleep=lambda s: None, keys={"FIXTURE_API_KEY": KEY})
    run_capture(store, keyed_register(), LiveScripted({PLAIN: [(200, "x\n# end\n")]}, start="2026-11-11T22:45:00"),
                sleep=lambda s: None, keys={})
    assert capture_main(["--store", str(store), "--register", str(register), "--status",
                         "--as-of", "2026-11-11T23:00:00Z"]) == 0
    assert ("STALE fx-keyed: stale, last fetched 2026-11-11T15:50:01Z (FIXTURE_API_KEY is not set)"
            in capsys.readouterr().out)
