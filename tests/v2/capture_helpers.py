"""Shared pieces for the capture tests: a register whose rows a test may sign, and a transport
that answers from a script. No test of the capture kit touches the network (PLAN 9)."""
from __future__ import annotations

import copy
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from atlas.capture.http import Response, TransportError
from atlas.rights import load_register

FIXTURE_ORIGIN = "Macro Atlas fixture (synthetic)"
ALLOW = {"display": True, "redistribute": True, "store": True, "ml_use": True,
         "signed_by": "Alex", "signed_on": "2026-11-11"}
PROPOSAL = {"display": True, "redistribute": True, "store": True, "ml_use": True, "note": "test"}


def signed_in_committed() -> set[str]:
    """The ids of the rows Alex has signed in the committed register, read from the file. A test
    of what the committed register does today works its expectation out from this, so that the
    next signature changes no test."""
    return {row["id"] for row in load_register()["rows"] if row["decision"] is not None}


def committed_with(signed=(), **grants) -> dict:
    """The committed register's rows under test decisions: exactly the rows named are signed
    (ALLOW, with ``grants`` changed) and every other row is unsigned, whatever Alex has signed
    in the file. A test of what a signature does, or of what its absence does, uses this and so
    says the same thing before and after Alex signs a row. The decisions are test data."""
    table = load_register()
    unknown = set(signed) - {row["id"] for row in table["rows"]}
    assert not unknown, f"the register has no row {sorted(unknown)}"
    for row in table["rows"]:
        row["decision"] = {**ALLOW, **grants} if row["id"] in signed else None
    return table


def committed_with_file(directory: Path, signed=(), name="register.json", **grants) -> Path:
    """``committed_with`` written to a file, for a command that takes ``--register``."""
    path = directory / name
    path.write_text(json.dumps(committed_with(signed, **grants)))
    return path


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
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


class Scripted:
    """A transport that answers each request from a queue for its URL. An answer is a
    (status, body) pair, a (status, body, headers) triple, or an exception to raise. Each
    answer takes one second of the transport's clock."""

    kind = "replay"
    real = False  # the bytes are invented

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
        if isinstance(answer, BaseException):
            raise answer
        status, body, *rest = answer
        headers = rest[0] if rest else [["Content-Type", "text/plain"]]
        if isinstance(body, str):
            body = body.encode()
        return Response(status, headers, body, self.clock)


def refused(message="connection reset"):
    return TransportError(message)


class LiveScripted(Scripted):
    """A scripted transport that calls itself live: keys are sent through it, as they would be
    to a source. The bytes are still invented and nothing leaves the machine."""

    kind = "live"
