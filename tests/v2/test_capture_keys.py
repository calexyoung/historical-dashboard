"""API keys (PLAN M15; ADR 0029): a key is added to a request as it is sent to a source and is
in nothing the kit keeps: no URL, no header, no body, no reason for a retry. A replay asks for
none and sends none."""
import pytest

from atlas.capture.http import CaptureError, Request, Session, usable_key

from .capture_helpers import LiveScripted, Scripted, refused

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
    body = '{"Request":[{"ParameterName":"USERID","ParameterValue":"%s"}],"again":"%s"}' % (KEY, KEY)
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
