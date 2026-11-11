"""The manners of the capture kit towards a source (PLAN 4.2: per-host pause, serial requests,
backoff, the 429 breaker, User-Agent). Driven through Session with a scripted transport."""
from types import SimpleNamespace

import pytest

from atlas.capture.http import USER_AGENT, CaptureError, Fetch, Request, Session

from .capture_helpers import Scripted, refused

A = "https://a.invalid/x"
B = "https://b.invalid/y"


class Clock:
    """A monotonic clock that only moves when the session sleeps."""

    def __init__(self):
        self.t = 0.0
        self.slept = []

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds

    def monotonic(self):
        return self.t


def session(answers, **kw):
    clock = Clock()
    transport = Scripted(answers)
    return Session(transport, sleep=clock.sleep, monotonic=clock.monotonic, **kw), transport, clock


def test_a_server_error_is_retried_with_a_growing_wait_and_the_reasons_are_kept():
    http, transport, clock = session({A: [(503, "busy"), refused("timed out"), (200, "ok")]})
    part = http.send(Request("GET", A))
    assert part.response.status == 200
    assert part.tries == ["HTTP 503", "timed out"]
    assert clock.slept == [2.0, 4.0]
    assert len(transport.sent) == 3


def test_a_client_error_is_final_at_once():
    http, transport, clock = session({A: [(404, "no")]})
    assert http.send(Request("GET", A)).response.status == 404
    assert len(transport.sent) == 1 and clock.slept == []


def test_no_answer_after_every_try_raises():
    http, _, _ = session({A: [refused("reset")] * 4})
    with pytest.raises(CaptureError, match="no answer from a.invalid after 4 tries: reset"):
        http.send(Request("GET", A))


def test_a_fetch_raises_on_any_status_but_200_and_keeps_the_answer():
    http, _, _ = session({A: [(500, "down")] * 4})
    fetch = Fetch(http)
    with pytest.raises(CaptureError, match="HTTP 500"):
        fetch.get(A)
    assert [part.response.status for part in fetch.parts] == [500]
    assert fetch.parts[0].tries == ["HTTP 500"] * 3


def test_requests_to_one_host_are_spaced_and_other_hosts_are_not_held_up():
    http, _, clock = session({A: [(200, "1"), (200, "2")], B: [(200, "3")]}, min_delay=1.0)
    http.send(Request("GET", A))
    http.send(Request("GET", B))
    assert clock.slept == []
    http.send(Request("GET", A))
    assert clock.slept == [1.0]


def test_retry_after_is_honoured_up_to_a_minute():
    http, _, clock = session({A: [(429, "", [["Retry-After", "30"]]),
                                  (429, "", [["Retry-After", "86400"]]), (200, "ok")]})
    http.send(Request("GET", A))
    assert clock.slept == [30.0, 60.0]


def test_a_host_that_keeps_answering_429_is_left_alone_for_the_rest_of_the_run():
    http, transport, _ = session({A: [(429, "")] * 8, B: [(200, "ok")]})
    for _ in range(2):
        assert http.send(Request("GET", A)).response.status == 429
    asked = len(transport.sent)
    with pytest.raises(CaptureError, match="429 earlier in this run"):
        http.send(Request("GET", A))
    assert len(transport.sent) == asked
    assert http.send(Request("GET", B)).response.status == 200  # another host is unaffected


def test_every_request_says_who_is_asking():
    http, transport, _ = session({A: [(200, "ok")], B: [(200, "ok")]})
    http.send(Request("GET", A))
    assert dict(transport.sent[0].headers)["User-Agent"] == USER_AGENT
    assert "@" not in USER_AGENT  # no personal detail by default
    named, transport, _ = session({A: [(200, "ok")]}, user_agent="atlas (ops@example.org)")
    named.send(Request("GET", A))
    assert dict(transport.sent[0].headers)["User-Agent"] == "atlas (ops@example.org)"


def test_an_answer_that_did_arrive_is_kept_when_the_later_tries_get_none():
    http, _, _ = session({A: [(503, "busy"), refused("reset"), refused("reset"), refused("reset")]})
    fetch = Fetch(http)
    with pytest.raises(CaptureError, match="HTTP 503"):
        fetch.get(A)
    [part] = fetch.parts
    assert part.response.status == 503 and part.response.body == b"busy"
    assert part.tries == ["HTTP 503", "reset", "reset", "reset"]


def test_the_live_transport_follows_no_redirect(monkeypatch):
    # A cleared endpoint that redirects would fetch bytes from somewhere the gate was never
    # asked about. The 3xx itself is the answer, and it fails the capture.
    import requests

    from atlas.capture.http import LiveTransport

    seen = {}

    class Answer:
        status_code, content = 302, b""
        raw = SimpleNamespace(headers={"Location": "https://elsewhere.invalid/"})

    def request(self, method, url, **kw):
        seen.update(kw)
        return Answer()

    monkeypatch.setattr(requests.Session, "request", request)
    response = LiveTransport().send(Request("GET", A))
    assert seen["allow_redirects"] is False
    assert response.status == 302 and response.header("location") == "https://elsewhere.invalid/"
    assert LiveTransport.real is True
