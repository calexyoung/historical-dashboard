"""How the capture kit talks to a source (PLAN 4.2, Source adapter; ADR 0021).

A *transport* sends one request and returns the exact bytes that came back, with the time they
arrived. The live transport uses ``requests``; tests and ``--replay`` use transports that answer
from recorded exchanges, so no test touches the network. A ``Session`` puts manners around a
transport: one request at a time, a pause between requests to one host, retries with backoff on
5xx, 429 and network errors, and a breaker that stops asking a host that keeps answering 429.
A ``Fetch`` records every final answer of one Capture, including the answer that made it fail.

Hand-entered files (M16; ADR 0030). A request whose method is ``READ`` asks no one: the live
transport answers it with the bytes of a file under ``catalog/manual`` in the repository, and a
replay answers it from a recording, so a hand-entered value is captured, kept and replayed like
any other.

API keys (M15; ADR 0029). A request that needs a key says which (``Request.key``) and never
holds it. On a live run the ``Session`` adds the key to the URL it hands the transport, and
takes every key of the run out of what comes back (the body, the headers, the text of a network
error) before anything else sees it: BEA's answers repeat the key they were asked with. What is
recorded is the request without its key and the answer without any. A replay sends requests as
they were recorded and needs no key.
"""
from __future__ import annotations

import math
import re
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote, urlsplit

#: Sent on every request unless ATLAS_CAPTURE_USER_AGENT says otherwise. It names the job
#: honestly and carries no personal detail; the runbook says how to add a contact address.
USER_AGENT = "macro-atlas-capture/1 (daily archival fetch of public statistical releases)"
RETRIES = 3
BACKOFF_SECONDS = 2.0
MIN_DELAY_SECONDS = 1.0
BREAKER = 2  # requests to one host that ended in 429 before the host is left alone for the run
MAX_RETRY_AFTER_SECONDS = 60.0
TIMEOUT_SECONDS = 60
#: What stands where a key was.
REDACTED = "REDACTED"
#: A key is letters, digits and hyphens: text that a URL, a header and JSON all carry unchanged,
#: so the one literal search below finds every copy of it. A key of any other shape is not used.
_KEY_SHAPE = re.compile(r"[A-Za-z0-9-]{16,128}")
_JSON_ESCAPE = re.compile(r"\\u([0-9a-fA-F]{4})")


#: The method of a request that asks no one: it reads a hand-entered file of the repository.
READ = "READ"
READ_SCHEME = "repo:"
READ_PATH = re.compile(r"catalog/manual/[a-z0-9][a-z0-9_-]{0,63}\.json")


def usable_key(value: object) -> bool:
    return isinstance(value, str) and _KEY_SHAPE.fullmatch(value) is not None


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
    #: (query parameter, name of the key) when the source wants an API key. The key itself is
    #: added by the Session as the request is sent; a Request never holds it.
    key: tuple[str, str] | None = None


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

    def __init__(self, timeout: float = TIMEOUT_SECONDS, root: Path | None = None):
        self._requests = None
        self._http = None
        self._timeout = timeout
        #: Where a hand-entered file is read from: the repository this code is in.
        self._root = Path(root) if root is not None else Path(__file__).resolve().parents[2]

    def now(self) -> datetime:
        return _whole_second_not_before(datetime.now(UTC))

    def _read(self, request: Request) -> Response:
        """A hand-entered file, as it is in the working tree now (M16; ADR 0030). Only a file
        directly under ``catalog/manual`` is read, by a name of the expected shape, and never
        through a link that leads out of that directory. A file that is not there is a 404:
        an answer, not a network failure, so nothing is tried again."""
        where = request.url.removeprefix(READ_SCHEME)
        directory = (self._root / "catalog" / "manual").resolve()
        path = (self._root / where).resolve() if READ_PATH.fullmatch(where) else None
        if path is None or path.parent != directory:
            raise TransportError(f"{request.url} is not a file under catalog/manual")
        try:
            body = path.read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            return Response(404, [], b"", self.now())
        except OSError as error:
            raise TransportError(f"{type(error).__name__}: {where}") from error
        return Response(200, [["Content-Type", "application/json"]], body, self.now())

    def send(self, request: Request) -> Response:
        if request.method == READ:
            return self._read(request)
        if self._http is None:
            import requests

            self._requests = requests
            self._http = requests.Session()
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
    #: How many copies of a key were taken out of the kept answer's body and headers.
    key_removed: int = 0


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
        keys: Mapping[str, str] | None = None,
    ):
        self.transport = transport
        self._sleep = sleep
        self._monotonic = monotonic
        self._user_agent = user_agent
        self._min_delay = min_delay
        self._retries = retries
        # Keys are for a source. A transport that answers from recordings is sent none, and
        # its recorded bytes are left as they are.
        self._live = transport.kind == "live"
        self._keys = {name: value for name, value in (keys or {}).items() if usable_key(value)} \
            if self._live else {}
        self._secrets = sorted(set(self._keys.values()), key=len, reverse=True)
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

    def _without_keys(self, response: Response) -> tuple[Response, int]:
        """``response`` with every key of the run replaced, in whatever letter case it comes
        back (the BEA repeats what it was asked in capitals), and how many copies there were.
        Byte for byte otherwise: nothing is parsed or written out again.

        A key spelt some other way (JSON's ``\\u002d`` for a hyphen, a percent-encoding) cannot
        be replaced without rewriting the answer, and whoever decoded the answer would have the
        key. Such an answer is refused whole: ``CaptureError``, and nothing of it is kept."""
        if not self._secrets:
            return response, 0
        count, body = 0, response.body
        for secret in self._secrets:
            body, found = re.subn(re.escape(secret.encode()), REDACTED.encode(), body, flags=re.IGNORECASE)
            count += found
        headers = []
        for name, value in response.headers:
            for secret in self._secrets:
                value, found = re.subn(re.escape(secret), REDACTED, value, flags=re.IGNORECASE)
                count += found
            headers.append([name, value])
        text = "\n".join([body.decode("utf-8", "replace"), *(value for _, value in headers)])
        decoded = unquote(_JSON_ESCAPE.sub(lambda m: chr(int(m[1], 16)), text)).casefold()
        if any(secret.casefold() in decoded for secret in self._secrets):
            raise CaptureError("the answer repeats an API key in an encoded spelling; it was not kept")
        if not count:
            return response, 0
        return Response(response.status, headers, body, response.received_at), count

    def send(self, request: Request, again: Callable[[Response], str | None] | None = None) -> Part:
        """The final answer to ``request``, whatever its status, after retries. Raises
        ``CaptureError`` only when no answer arrived at all or the host is being left alone;
        ``Fetch.send`` decides what a bad status means. ``again`` is the adapter's word on a
        200: a reason to ask once more (the answer is not one yet), or None."""
        if request.method == READ:
            # A file of the repository: no host to be polite to, no key, nothing to try again.
            try:
                response, removed = self._without_keys(self.transport.send(request))
            except TransportError as error:
                raise CaptureError(redact(str(error), self._secrets)) from error
            return Part(request, response, [], removed)
        host = urlsplit(request.url).netloc
        if self._rate_limited.get(host, 0) >= BREAKER:
            raise CaptureError(f"{host} answered HTTP 429 earlier in this run; it is left alone")
        headers = (("User-Agent", self._user_agent), *request.headers)
        request = Request(request.method, request.url, headers, request.body, request.key)
        sent = request
        if request.key is not None and self._live:
            parameter, name = request.key
            if name not in self._keys:
                raise CaptureError(f"{name} is not set; {host} was not asked")
            joiner = "&" if "?" in request.url else "?"
            sent = Request(request.method, f"{request.url}{joiner}{parameter}={self._keys[name]}",
                           headers, request.body)
        tries: list[str] = []
        removed = 0
        response: Response | None = None  # the last answer that did arrive, whatever came after
        answered_last = False
        for attempt in range(self._retries + 1):
            self._wait_for(host)
            wait = BACKOFF_SECONDS * 2**attempt
            try:
                response, removed = self._without_keys(self.transport.send(sent))
            except TransportError as error:
                answered_last = False
                tries.append(redact(str(error), self._secrets))
            else:
                answered_last = True
                not_yet = again(response) if again is not None and response.status == 200 else None
                if response.status != 429 and response.status < 500 and not_yet is None:
                    break
                tries.append(not_yet or f"HTTP {response.status}")
                wait = max(wait, _retry_after(response))
            if attempt < self._retries:
                self._sleep(wait)
        if response is None:
            raise CaptureError(f"no answer from {host} after {len(tries)} tries: {tries[-1]}")
        if response.status == 429:
            self._rate_limited[host] = self._rate_limited.get(host, 0) + 1
        # ``tries`` is why each try was repeated. When the kept answer is the last try's own
        # (it ran out of retries), that try is not listed as a reason for another.
        ran_out_on_it = answered_last and (response.status == 429 or response.status >= 500
                                           or (again is not None and response.status == 200
                                               and again(response) is not None))
        return Part(request, response, tries[:-1] if ran_out_on_it else tries, removed)


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

    def send(self, request: Request, again: Callable[[Response], str | None] | None = None) -> Response:
        part = self._session.send(request, again)
        self.parts.append(part)
        if part.response.status != 200:
            raise CaptureError(f"HTTP {part.response.status} from {request.method} {request.url}")
        return part.response

    def get(self, url: str, headers: Iterable[tuple[str, str]] = (),
            again: Callable[[Response], str | None] | None = None,
            key: tuple[str, str] | None = None) -> Response:
        return self.send(Request("GET", url, tuple(headers), key=key), again)

    def read(self, path: str) -> Response:
        """The bytes of a hand-entered file of the repository (``catalog/manual/x.json``), kept
        as a part like any answer. A live run reads the working tree; a replay answers from
        its recording and never looks at today's files."""
        part = self._session.send(Request(READ, READ_SCHEME + path))
        self.parts.append(part)
        if part.response.status != 200:
            raise CaptureError(f"the hand-entered file {path} is not in the repository")
        return part.response


def redact(text: str, secrets: Iterable[str]) -> str:
    """``text`` with every secret value replaced, the longest first so that one secret inside
    another leaves nothing behind. Applied to everything the kit writes."""
    for secret in sorted({s for s in secrets if s}, key=len, reverse=True):
        text = re.sub(re.escape(secret), REDACTED, text, flags=re.IGNORECASE)
    return text
