"""Recorded exchanges: the capture kit's fixtures, and reading a Capture back out of a store
(PLAN M7 and 9; ADR 0021).

An *exchange directory* holds, for one endpoint, the requests of one Capture and the exact
bytes that answered them, in files a person can read in review:

    {source}/{endpoint}/exchange.json     the requests, statuses, headers, times and provenance
    {source}/{endpoint}/part-1.{ext}      the body of the first answer, byte for byte

``ReplayTransport`` answers from such directories instead of the network, with the recorded
times, so ``atlas capture --replay`` and the tests run the real adapters and the real run
without a request leaving the machine. A request with no recorded answer fails; nothing falls
back to the network.

``export_exchanges`` writes a store's latest complete Captures out in this form. It is how a
real capture becomes a committed fixture, and committing is redistribution: for bytes that
a source served, fetched now or replayed from a real recording, it asks the rights gate for ``redistribute`` on the production Surface,
for every dataset of the endpoint, and refuses without it.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

from ..rights import RightsGate
from . import store as S
from .adapters import ADAPTERS, Evidence, RawCapture
from .http import CaptureError, Part, Request, Response

EXCHANGE_FORMAT = 1
_EXTENSIONS = {"application/json": "json", "text/csv": "csv"}


class ExportRefused(RuntimeError):
    pass


def _request_key(method: str, url: str, body: str | None) -> tuple[str, str, str | None]:
    return method, url, body


def write_exchange(out: Path, source: str, endpoint: str, parts: list[dict], *,
                   recorded_at: datetime, provenance: dict) -> Path:
    """Write one endpoint's exchange directory. Each part is ``{request: {method, url, body},
    status, headers, received_at, body}`` with ``body`` as bytes."""
    directory = Path(out) / source / endpoint
    directory.mkdir(parents=True, exist_ok=True)
    listed = []
    for number, part in enumerate(parts, start=1):
        kind = next((v for k, v in part["headers"] if k.lower() == "content-type"), "")
        extension = _EXTENSIONS.get(kind.split(";")[0].strip().lower(), "bin")
        name = f"part-{number}.{extension}"
        (directory / name).write_bytes(part["body"])
        listed.append({"request": part["request"], "status": part["status"],
                       "headers": part["headers"], "received_at": part["received_at"],
                       "body_file": name, "sha256": hashlib.sha256(part["body"]).hexdigest(),
                       # Said of bytes a source served with the key it was asked with in them:
                       # the copies were replaced before anything was kept (ADR 0029).
                       **({"key_removed": part["key_removed"]} if part.get("key_removed") else {})})
    record = {"format": EXCHANGE_FORMAT, "source": source, "endpoint": endpoint,
              "recorded_at": S.stamp(recorded_at), "provenance": provenance, "exchanges": listed}
    (directory / "exchange.json").write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return directory


def read_exchanges(directory: Path) -> list[dict]:
    """Every exchange record under ``directory``, each with its ``directory`` added."""
    records = []
    for path in sorted(Path(directory).rglob("exchange.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        if record.get("format") != EXCHANGE_FORMAT:
            raise ValueError(f"{path} is not exchange format {EXCHANGE_FORMAT}")
        records.append({**record, "directory": path.parent})
    return records


class ReplayTransport:
    """Answers from recorded exchanges. The clock is the recording's: ``now`` is when the
    recorded run began, and each answer arrives when it arrived then."""

    kind = "replay"

    def __init__(self, directory: Path):
        records = read_exchanges(directory)
        if not records:
            raise ValueError(f"{directory} holds no recorded exchanges")
        # Bytes a source once served are still its bytes when replayed. Unless every exchange
        # says it is invented, what this transport returns is treated as real.
        self.real = not all(record.get("provenance", {}).get("synthetic") is True
                            for record in records)
        self._now = min(S.unstamp(record["recorded_at"]) for record in records)
        self._answers: dict[tuple, Response] = {}
        for record in records:
            for exchange in record["exchanges"]:
                body = (record["directory"] / exchange["body_file"]).read_bytes()
                if hashlib.sha256(body).hexdigest() != exchange["sha256"]:
                    raise ValueError(f"{record['directory'] / exchange['body_file']} is not the "
                                     "bytes its exchange recorded")
                request = exchange["request"]
                key = _request_key(request["method"], request["url"], request["body"])
                self._answers[key] = Response(exchange["status"], exchange["headers"], body,
                                              S.unstamp(exchange["received_at"]))

    def now(self) -> datetime:
        return self._now

    def send(self, request: Request) -> Response:
        body = None if request.body is None else request.body.decode("utf-8")
        answer = self._answers.get(_request_key(request.method, request.url, body))
        if answer is None:
            raise CaptureError(f"no recorded exchange for {request.method} {request.url}; "
                               "a replay never asks the network")
        return answer


def load_capture(store: Path, line: dict) -> RawCapture:
    """A Capture read back from a store by its fetch-log line: the kept bytes, checked against
    their hashes, with the evidence recorded then and the original retrieval time. This is what
    an adapter's ``parse`` and the vintage store's replay (M8) are given."""
    if line.get("outcome") not in ("captured", "incomplete"):
        raise ValueError(f"capture {line.get('capture_id')} failed; there is nothing to load")
    parts = []
    for part in line["parts"]:
        request = part["request"]
        body = None if request["body"] is None else request["body"].encode("utf-8")
        parts.append(Part(
            Request(request["method"], request["url"], tuple(map(tuple, request["headers"])), body),
            Response(part["status"], part["headers"], S.read_blob(Path(store), part["blob"]),
                     S.unstamp(part["received_at"])),
            list(part.get("retried_after", [])),
            int(part.get("key_removed", 0)),
        ))
    return RawCapture(line["endpoint"], line["adapter"]["name"], parts,
                      Evidence(**line["evidence"]), S.unstamp(line["retrieved_at"]))


def reexamine(capture: RawCapture) -> Evidence:
    """The completeness evidence judged again from the kept bytes, by today's adapter."""
    return ADAPTERS[capture.adapter].examine(capture.evidence.scope, capture.bodies)


def export_exchanges(store: Path, out: Path, table: object, *, note: str) -> list[str]:
    """Write the latest complete Capture of every endpoint in ``store`` to ``out`` as exchange
    directories. Returns the endpoints written. Raises ``ExportRefused`` if any of them holds
    bytes a source served (fetched now, or replayed from a real recording; a line that does not
    say is taken to be real) and the register does not let its data be redistributed."""
    latest: dict[str, dict] = {}
    for line in S.read_fetch_log(Path(store)):
        if line.get("outcome") == "captured":
            latest[line["endpoint"]] = line
    gate = RightsGate(table)
    for line in latest.values():
        if line.get("real_bytes", True) is False:
            continue
        lineage = [{"origin": line["origin"], "dataset": dataset, "channel": line["channel"],
                    "representation": "native", "permission": "redistribute"}
                   for dataset in line["datasets"]]
        decision = gate.permits(lineage, "production")
        if not decision.allowed:
            raise ExportRefused(f"{line['endpoint']}: {decision.reason}. A committed fixture is "
                                "a public copy; nothing was written.")
    for endpoint, line in latest.items():
        capture = load_capture(Path(store), line)
        parts = [{"request": {"method": part.request.method, "url": part.request.url,
                              "body": None if part.request.body is None
                              else part.request.body.decode("utf-8")},
                  "status": part.response.status, "headers": part.response.headers,
                  "received_at": S.stamp(part.response.received_at), "body": part.response.body,
                  "key_removed": part.key_removed}
                 for part in capture.parts]
        synthetic = line.get("real_bytes", True) is False
        write_exchange(out, line["source"], endpoint, parts,
                       recorded_at=S.unstamp(line["started_at"]),
                       provenance={"synthetic": synthetic, "transport": line["transport"],
                                   "origin": line["origin"], "datasets": line["datasets"],
                                   "retrieved_at": line["retrieved_at"],
                                   "capture_id": line["capture_id"], "note": note})
    return sorted(latest)
