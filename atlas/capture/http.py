"""How the capture kit talks to a source (PLAN 4.2, Source adapter; ADR 0021).

A *transport* sends one request and returns the exact bytes that came back, with the time they
arrived. The live transport uses ``requests``; tests and ``--replay`` use transports that answer
from recorded exchanges, so no test touches the network. A ``Session`` puts manners around a
transport: one request at a time, a pause between requests to one host, retries with backoff on
5xx, 429 and network errors, and a breaker that stops asking a host that keeps answering 429.
A ``Fetch`` records every final answer of one Capture, including the answer that made it fail.
"""
from __future__ import annotations

import math
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol
from urllib.parse import urlsplit

#: Sent on every request unless ATLAS_CAPTURE_USER_AGENT says otherwise. It names the job
#: honestly and carries no personal detail; the runbook says how to add a contact address.
USER_AGENT = "macro-atlas-capture/1 (daily archival fetch of public statistical releases)"
RETRIES = 3
BACKOFF_SECONDS = 2.0
MIN_DELAY_SECONDS = 1.0
BREAKER = 2  # requests to one host that ended in 429 before the host is left alone for the run
MAX_RETRY_AFTER_SECONDS = 60.0
TIMEOUT_SECONDS = 60


class CaptureError(RuntimeError):
    """A fetch failed. Adapters raise this; they never return partial data as complete."""


class TransportError(RuntimeError):
    """The network failed before any answer arrived (refused, reset, timed out)."""


@dataclass(frozen=True)
class Request:
    method: str
    url: str
    headers: tuple[tuple[str, str], ...] = ()
    body: bytes | None = None


@dataclass(frozen=True)
class Response:
    status: int
    headers: list[list[str]]  # in the order received; a name may repeat
    body: bytes
    received_at: datetime

    def header(self, name: str) -> str | None:
        return next((v for k, v in self.headers if k.lower() == name.lower()), None)


class Transport(Protocol):
    kind: str  # "live" or "replay"; written on every fetch-log line
    real: bool  # whether the bytes it returns were served by a source, now or when recorded

    def now(self) -> datetime: ...

    def send(self, request: Request) -> Response: ...


def _whole_second_not_before(moment: datetime) -> datetime:
    """Retrieval times are whole seconds, rounded up: a value was public no later than this."""
    moment = moment.astimezone(UTC)
    if moment.microsecond:
        moment = moment.replace(microsecond=0) + timedelta(seconds=1)
    return moment


class LiveTransport:
    """The network, through ``requests``. Imported lazily so that reading a store needs nothing
    outside the standard library."""

    kind = "live"
    real = True

    def __init__(self, timeout: float = TIMEOUT_SECONDS):
        import requests

        self._requests = requests
        self._http = requests.Session()
        self._timeout = timeout

    def now(self) -> datetime:
        return _whole_second_not_before(datetime.now(UTC))

    def send(self, request: Request) -> Response:
        try:
            answer = self._http.request(
                request.method, request.url, headers=dict(request.headers), data=request.body,
                # A redirect would fetch from somewhere the rights gate was never asked about,
                # and file the bytes under this request. The 3xx is the answer; it fails the fetch.
                timeout=self._timeout, allow_redirects=False,
            )
        except self._requests.RequestException as error:
            raise TransportError(f"{type(error).__name__}: {error}") from error
        finally:
            self._http.cookies.clear()  # every request stands alone; no session is carried
        headers = [[name, value] for name, value in answer.raw.headers.items()]
        return Response(answer.status_code, headers, answer.content, self.now())


@dataclass
class Part:
    """One request of a Capture and the final answer to it."""

    request: Request
    response: Response
    tries: list[str] = field(default_factory=list)  # why each earlier try was repeated


class Session:
    """Serial, polite requests through one transport for the length of a run."""

    def __init__(
        self,
        transport: Transport,
        *,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        user_agent: str = USER_AGENT,
        min_delay: float = MIN_DELAY_SECONDS,
        retries: int = RETRIES,
    ):
        self.transport = transport
        self._sleep = sleep
        self._monotonic = monotonic
        self._user_agent = user_agent
        self._min_delay = min_delay
        self._retries = retries
        self._last_call: dict[str, float] = {}
        self._rate_limited: dict[str, int] = {}

    def now(self) -> datetime:
        return self.transport.now()

    def _wait_for(self, host: str) -> None:
        last = self._last_call.get(host)
        if last is not None:
            wait = self._min_delay - (self._monotonic() - last)
            if wait > 0:
                self._sleep(wait)
        self._last_call[host] = self._monotonic()

    def send(self, request: Request) -> Part:
        """The final answer to ``request``, whatever its status, after retries. Raises
        ``CaptureError`` only when no answer arrived at all or the host is being left alone;
        ``Fetch.send`` decides what a bad status means."""
        host = urlsplit(request.url).netloc
        if self._rate_limited.get(host, 0) >= BREAKER:
            raise CaptureError(f"{host} answered HTTP 429 earlier in this run; it is left alone")
        headers = (("User-Agent", self._user_agent), *request.headers)
        request = Request(request.method, request.url, headers, request.body)
        tries: list[str] = []
        response: Response | None = None  # the last answer that did arrive, whatever came after
        answered_last = False
        for attempt in range(self._retries + 1):
            self._wait_for(host)
            wait = BACKOFF_SECONDS * 2**attempt
            try:
                response = self.transport.send(request)
            except TransportError as error:
                answered_last = False
                tries.append(str(error))
            else:
                answered_last = True
                if response.status != 429 and response.status < 500:
                    break
                tries.append(f"HTTP {response.status}")
                wait = max(wait, _retry_after(response))
            if attempt < self._retries:
                self._sleep(wait)
        if response is None:
            raise CaptureError(f"no answer from {host} after {len(tries)} tries: {tries[-1]}")
        if response.status == 429:
            self._rate_limited[host] = self._rate_limited.get(host, 0) + 1
        # ``tries`` is why each try was repeated. When the kept answer is the last try's own
        # (it ran out of retries), that try is not listed as a reason for another.
        ran_out_on_it = answered_last and (response.status == 429 or response.status >= 500)
        return Part(request, response, tries[:-1] if ran_out_on_it else tries)


def _retry_after(response: Response) -> float:
    value = response.header("Retry-After")
    try:
        seconds = float(value) if value is not None else 0.0
    except ValueError:
        return 0.0
    return min(seconds, MAX_RETRY_AFTER_SECONDS) if math.isfinite(seconds) and seconds > 0 else 0.0


class Fetch:
    """The requests of one Capture. Every final answer is kept in ``parts``, including one that
    fails the Capture, so that what the source did say is evidence either way."""

    def __init__(self, session: Session):
        self._session = session
        self.parts: list[Part] = []

    def now(self) -> datetime:
        return self._session.now()

    def send(self, request: Request) -> Response:
        part = self._session.send(request)
        self.parts.append(part)
        if part.response.status != 200:
            raise CaptureError(f"HTTP {part.response.status} from {request.method} {request.url}")
        return part.response

    def get(self, url: str, headers: Iterable[tuple[str, str]] = ()) -> Response:
        return self.send(Request("GET", url, tuple(headers)))


def redact(text: str, secrets: Iterable[str]) -> str:
    """``text`` with every secret value replaced. Applied to everything the kit writes."""
    for secret in secrets:
        if secret:
            text = text.replace(secret, "REDACTED")
    return text
