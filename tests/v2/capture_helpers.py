"""Shared pieces for the capture tests: a register whose rows a test may sign, and a transport
that answers from a script. No test of the capture kit touches the network (PLAN 9)."""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

from atlas.capture.http import Response, TransportError

FIXTURE_ORIGIN = "Macro Atlas fixture (synthetic)"
ALLOW = {"display": True, "redistribute": True, "store": True, "ml_use": True,
         "signed_by": "Alex", "signed_on": "2026-11-11"}
PROPOSAL = {"display": True, "redistribute": True, "store": True, "ml_use": True, "note": "test"}


def origin_row(row_id, origin, capture, *, signed=True, store=True, datasets="*"):
    decision = None
    if signed:
        decision = {**ALLOW, "store": store}
    return {"id": row_id, "kind": "origin", "name": row_id, "origins": [origin],
            "datasets": datasets, "used_for": "test", "terms": [], "licence_class": "public_domain",
            "attribution": None, "proposal": PROPOSAL, "open_questions": [], "decision": decision,
            "capture": capture}


def fixture_endpoint(endpoint_id="fx-a", url="https://fixture.invalid/a"):
    return {"id": endpoint_id, "adapter": "fixture", "channel": "fixture",
            "datasets": ["fixture set"], "params": {"url": url}}


def register(*rows):
    """A test register. Its decisions are test data: nothing here is Alex's signature on the
    committed table."""
    return copy.deepcopy({"format": 1, "version": "test-1", "about": "test",
                          "cleared_intermediaries": [], "rows": list(rows)})


def fixture_register(*, signed=True, store=True, endpoints=None):
    return register(origin_row("fx", FIXTURE_ORIGIN, endpoints or [fixture_endpoint()],
                               signed=signed, store=store))


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


class Scripted:
    """A transport that answers each request from a queue for its URL. An answer is a
    (status, body) pair, a (status, body, headers) triple, or an exception to raise. Each
    answer takes one second of the transport's clock."""

    kind = "replay"

    def __init__(self, answers: dict, start="2026-11-11T15:50:00"):
        self.answers = {url: list(queue) for url, queue in answers.items()}
        self.clock = at(start)
        self.sent = []

    def now(self):
        return self.clock

    def send(self, request):
        self.sent.append(request)
        queue = self.answers.get(request.url)
        if not queue:
            raise AssertionError(f"unexpected request {request.method} {request.url}")
        answer = queue.pop(0)
        self.clock += timedelta(seconds=1)
        if isinstance(answer, Exception):
            raise answer
        status, body, *rest = answer
        headers = rest[0] if rest else [["Content-Type", "text/plain"]]
        if isinstance(body, str):
            body = body.encode()
        return Response(status, headers, body, self.clock)


def refused(message="connection reset"):
    return TransportError(message)
