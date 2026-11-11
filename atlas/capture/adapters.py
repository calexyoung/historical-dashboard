"""Source adapters: the fetch half, and for BLS the parse half (PLAN 4.2 and M7; ADR 0021).

An adapter knows one source's requests and what a whole answer from it looks like. ``fetch``
makes the requests through a ``Fetch`` and returns the *completeness evidence*: what was asked
for (the scope), what came back (the checks) and every reason the answer is not whole (the
problems). ``examine`` is the same judgement made from kept bytes alone, so a replay can make it
again. An adapter raises ``CaptureError`` when a fetch fails and never calls a partial answer
complete. Parsing for Treasury Fiscal Data and the Federal Reserve Board arrives in M13 and
replays the captures made from here on.

Structure and freshness are different questions. "Complete" here means the source answered the
whole of what was asked, in the shape expected. Whether the newest value is recent is not
judged at capture.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime

from .http import CaptureError, Fetch, Part


@dataclass(frozen=True)
class Endpoint:
    """One thing the capture job fetches, as its register row lists it."""

    id: str
    source: str  # the register row's id
    adapter: str
    origin: str
    datasets: tuple[str, ...]
    channel: str
    params: dict


@dataclass
class Evidence:
    complete: bool
    scope: dict
    checks: dict
    problems: list[str]

    def as_dict(self) -> dict:
        return {"complete": self.complete, "scope": self.scope, "checks": self.checks,
                "problems": self.problems}


def _evidence(scope: dict, checks: dict, problems: list[str]) -> Evidence:
    return Evidence(not problems, scope, checks, problems)


@dataclass
class RawCapture:
    """The exact answers of one Capture and the evidence about them. ``retrieved_at`` is when
    the last part arrived: the whole was not in hand before then."""

    endpoint: str
    adapter: str
    parts: list[Part]
    evidence: Evidence
    retrieved_at: datetime

    @property
    def bodies(self) -> list[bytes]:
        return [part.response.body for part in self.parts]


@dataclass
class NormalizedState:
    """What a parsed capture says: Observations by the source's own series id, each value the
    provider's own text, never rounded and never invented. ``complete`` is false when the
    capture was not whole or something in it could not be read; a state that is not complete
    must not be recorded as the state of a Series (M8)."""

    complete: bool
    scope: dict
    series: dict[str, list[dict]]
    problems: list[str] = field(default_factory=list)


def _json(body: bytes, problems: list[str], what: str) -> dict | None:
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        problems.append(f"{what} is not JSON")
        return None
    if not isinstance(value, dict):
        problems.append(f"{what} is not a JSON object")
        return None
    return value


class FixtureAdapter:
    """Synthetic bytes in a made-up format: any text whose last line is ``# end``. It exists so
    the kit can be tested, and tried on a capture host, without asking an agency anything."""

    name = "fixture"
    version = 1

    def problem(self, params: dict) -> str | None:
        return None if isinstance(params.get("url"), str) else "it names no url"

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        scope = {"url": endpoint.params["url"]}
        return self.examine(scope, [fetch.get(endpoint.params["url"]).body])

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        whole = bodies[0].endswith(b"# end\n")
        problems = [] if whole else ["the body does not end with the line '# end'"]
        return _evidence(scope, {"bytes": len(bodies[0])}, problems)


ADAPTERS = {adapter.name: adapter for adapter in
            (FixtureAdapter(),)}


def capture(endpoint: Endpoint, fetch: Fetch) -> RawCapture:
    """Fetch one endpoint: the plan's ``fetch(spec) -> RawCapture``. Raises ``CaptureError``
    when the fetch fails; what did arrive stays in ``fetch.parts``."""
    adapter = ADAPTERS[endpoint.adapter]
    evidence = adapter.fetch(endpoint, fetch)
    if not fetch.parts:
        raise CaptureError(f"the {adapter.name} adapter made no request")
    return RawCapture(endpoint.id, adapter.name, list(fetch.parts), evidence,
                      max(part.response.received_at for part in fetch.parts))
