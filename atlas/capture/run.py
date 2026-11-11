"""A capture run (PLAN M7, 4.7; ADR 0012, ADR 0021): read the endpoint list from the rights
register, ask the gate about every endpoint before anything is fetched, then fetch each one in
turn and keep the bytes and the evidence. Raw only.

The run fails closed on rights: one selected endpoint whose register row Alex has not signed
for storage stops the whole run before the first request. Skipping it quietly would hide a
mistake in the table. After that it fails soft per endpoint: a failed or incomplete endpoint is
logged and the others are still fetched, and the run ends non-zero.
"""
from __future__ import annotations

import secrets as _secrets
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from ..rights import DIRECT, RightsGate
from . import store as S
from .adapters import ADAPTERS, Endpoint, capture
from .http import CaptureError, Fetch, Part, Session, Transport, redact

_ENDPOINT_FIELDS = {"id", "adapter", "datasets", "channel", "params", "note"}


class RegisterError(ValueError):
    """The register's endpoint list cannot be used."""


def endpoints_from_register(table: object) -> list[Endpoint]:
    """Every endpoint the register lists, in the table's order. The list has no other home:
    an endpoint exists only on the origin row whose terms cover it (ADR 0020, decision 7)."""
    gate = RightsGate(table)
    if gate.problem is not None:
        raise RegisterError(f"the rights register cannot be trusted ({gate.problem})")
    found: list[Endpoint] = []
    for row in table["rows"]:
        listed = row.get("capture", [])
        if not listed:
            continue
        if row["kind"] != "origin" or not isinstance(listed, list):
            raise RegisterError(f"row {row['id']}: only an origin row may list capture endpoints")
        for entry in listed:
            where = f"row {row['id']}"
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"]:
                raise RegisterError(f"{where}: a capture endpoint has no id")
            where = f"{where}, endpoint {entry['id']}"
            extra = set(entry) - _ENDPOINT_FIELDS
            if extra:
                raise RegisterError(f"{where}: unknown field {min(extra)}")
            adapter = ADAPTERS.get(entry.get("adapter"))
            if adapter is None:
                raise RegisterError(f"{where}: there is no adapter called {entry.get('adapter')!r}")
            datasets, channel = entry.get("datasets"), entry.get("channel", DIRECT)
            if (not isinstance(datasets, list) or not datasets
                    or not all(isinstance(d, str) and d for d in datasets)):
                raise RegisterError(f"{where}: it does not name its datasets")
            if not isinstance(channel, str) or not channel:
                raise RegisterError(f"{where}: its channel is not a name")
            if row["datasets"] != "*" and not set(datasets) <= set(row["datasets"]):
                # Otherwise an endpoint on an unsigned row could be cleared by another row
                # that happens to cover the dataset it names.
                raise RegisterError(f"{where}: it names a dataset its row does not cover")
            params = entry.get("params", {})
            problem = "its params are not an object" if not isinstance(params, dict) \
                else adapter.problem(params)
            if problem:
                raise RegisterError(f"{where}: {problem}")
            if any(entry["id"] == other.id for other in found):
                raise RegisterError(f"{where}: two endpoints share that id")
            found.append(Endpoint(entry["id"], row["id"], adapter.name, row["origins"][0],
                                  tuple(datasets), channel, params))
    return found


def refusals(table: object, endpoints: Iterable[Endpoint]) -> dict[str, str]:
    """Why each endpoint may not be stored, for those that may not. Empty means all cleared."""
    gate = RightsGate(table)
    rows = {row["id"]: row for row in table["rows"]} if gate.problem is None else {}
    refused: dict[str, str] = {}
    for endpoint in endpoints:
        # The row that lists the endpoint is the row that must be signed: asked directly, and
        # then through the gate, which adds the rule for intermediary Channels.
        decision = rows.get(endpoint.source, {}).get("decision")
        if gate.problem is None and decision is None:
            refused[endpoint.id] = (f"the rights register row for {endpoint.origin} "
                                    f"({endpoint.source}) is not signed")
            continue
        if gate.problem is None and decision.get("store") is not True:
            refused[endpoint.id] = (f"the rights register row for {endpoint.origin} "
                                    f"({endpoint.source}) does not allow store")
            continue
        for dataset in endpoint.datasets:
            decision = gate.may_store(endpoint.origin, dataset, endpoint.channel)
            if not decision.allowed:
                refused[endpoint.id] = decision.reason or "refused"
                break
    return refused


@dataclass
class RunResult:
    exit_code: int
    lines: list[str] = field(default_factory=list)
    outcomes: dict[str, str] = field(default_factory=dict)
    missed: dict[str, list[str]] = field(default_factory=dict)


def select(table: object, only: Iterable[str] | None) -> list[Endpoint]:
    """The endpoints of a run: all of them, or those of the rows and endpoints named."""
    endpoints = endpoints_from_register(table)
    if not endpoints:
        raise RegisterError("the rights register lists no capture endpoints")
    if only:
        names = list(only)
        known = {e.id for e in endpoints} | {e.source for e in endpoints}
        unknown = [name for name in names if name not in known]
        if unknown:
            raise RegisterError(f"the register has no row or endpoint called {unknown[0]}")
        endpoints = [e for e in endpoints if e.id in names or e.source in names]
    return endpoints


def _part_record(store: Path, source: str, part: Part, hide: Callable[[str], str]) -> dict:
    digest, blob = S.write_blob(store, source, part.response.received_at, part.response.body)
    request = part.request
    return {
        "request": {
            "method": request.method,
            "url": hide(request.url),
            "headers": [[name, hide(value)] for name, value in request.headers],
            "body": None if request.body is None else hide(request.body.decode("utf-8", "replace")),
        },
        "status": part.response.status,
        # A cookie is a session, not evidence about the data, and has no place in a log that
        # is committed. The header's presence is kept; its value is not.
        "headers": [[name, "(not kept)" if name.lower() == "set-cookie" else hide(value)]
                    for name, value in part.response.headers],
        "received_at": S.stamp(part.response.received_at),
        "sha256": digest,
        "bytes": len(part.response.body),
        "blob": blob,
        "retried_after": [hide(reason) for reason in part.tries],
    }


def _hidden(value, hide: Callable[[str], str]):
    """``value`` with every secret taken out of every string in it. Nothing is written to the
    store without passing through here."""
    if isinstance(value, str):
        return hide(value)
    if isinstance(value, list):
        return [_hidden(item, hide) for item in value]
    if isinstance(value, dict):
        return {key: _hidden(item, hide) for key, item in value.items()}
    return value


def run_capture(
    store: Path,
    table: object,
    transport: Transport,
    *,
    only: Iterable[str] | None = None,
    register_sha256: str | None = None,
    secrets: Iterable[str] = (),
    sleep: Callable[[float], None] | None = None,
    user_agent: str | None = None,
) -> RunResult:
    """One capture run into ``store``. Returns what happened; raises nothing for a refusal, a
    failed source or a locked store, all of which are results."""
    store = Path(store)
    hidden = [s for s in secrets if s]

    def hide(text: str) -> str:
        return redact(text, hidden)

    try:
        endpoints = select(table, only)
    except RegisterError as error:
        return RunResult(1, [f"REFUSED: {error}. Nothing was fetched."])
    refused = refusals(table, endpoints)
    if refused:
        lines = [f"REFUSED {endpoint.id} (row {endpoint.source}): {refused[endpoint.id]}"
                 for endpoint in endpoints if endpoint.id in refused]
        lines.append("An endpoint whose row is not cleared for storage fails the run. "
                     "Nothing was fetched.")
        return RunResult(1, lines)

    store.mkdir(parents=True, exist_ok=True)
    try:
        with S.locked(store):
            return _run(store, table, endpoints, transport, register_sha256, hide, sleep, user_agent)
    except S.StoreLocked as error:
        return RunResult(1, [f"REFUSED: {error} ({store / 'LOCK'}). Nothing was fetched."])


def _run(store, table, endpoints, transport, register_sha256, hide, sleep, user_agent) -> RunResult:
    result = RunResult(0)
    started = transport.now()
    runs = S.read_runs(store, result.lines)
    fetches = S.read_fetch_log(store, result.lines)
    for run in S.unfinished_runs(runs):
        result.lines.append(f"WARNING run {run.get('run_id')} started at {run.get('started_at')} "
                            "and did not finish")
    other = next((str(record.get("transport")) for record in [*runs, *fetches]
                  if record.get("transport") != transport.kind), None)
    if other is not None:
        # A store of replayed fixtures is not evidence of what an agency served, and the two
        # must never be mixed. Both logs are asked, so a run that died before its last line
        # still counts.
        result.lines.append(f"REFUSED: this store holds a {other} run and this run is "
                            f"{transport.kind}. Nothing was fetched.")
        result.exit_code = 1
        return result
    run_id = f"{started.strftime('%Y%m%dT%H%M%SZ')}-{_secrets.token_hex(3)}"
    register = {"version": table["version"], "sha256": register_sha256}
    selected = [endpoint.id for endpoint in endpoints]
    this_run = {"event": "started", "run_id": run_id, "started_at": S.stamp(started),
                "selected": selected, "transport": transport.kind, "register": register}
    # Written before the first request: a run that dies still shows that these endpoints were
    # due today and what kind of run it was.
    S.append_run(store, this_run)
    result.missed = S.missed_days([*runs, this_run], fetches, selected, started)
    for endpoint_id, days in result.missed.items():
        result.lines.append(f"MISSED {endpoint_id}: {', '.join(days)}")

    options = {} if sleep is None else {"sleep": sleep}
    if user_agent:
        options["user_agent"] = user_agent
    session = Session(transport, **options)
    for endpoint in endpoints:
        fetch = Fetch(session)
        adapter = ADAPTERS[endpoint.adapter]
        record = {
            "capture_id": f"{run_id}/{endpoint.id}", "run_id": run_id, "endpoint": endpoint.id,
            "source": endpoint.source, "origin": endpoint.origin, "datasets": list(endpoint.datasets),
            "channel": endpoint.channel, "adapter": {"name": adapter.name, "version": adapter.version},
            "register": register, "transport": transport.kind,
            "real_bytes": bool(getattr(transport, "real", True)),
            "started_at": S.stamp(transport.now()),
        }
        try:
            raw = capture(endpoint, fetch)
        except CaptureError as error:
            record.update(outcome="failed", retrieved_at=None, evidence=None, error=hide(str(error)))
            result.lines.append(f"FAILED {endpoint.id}: {hide(str(error))}")
        else:
            outcome = "captured" if raw.evidence.complete else "incomplete"
            record.update(outcome=outcome, retrieved_at=S.stamp(raw.retrieved_at),
                          evidence=raw.evidence.as_dict(), error=None)
            size = sum(len(part.response.body) for part in raw.parts)
            if raw.evidence.complete:
                result.lines.append(f"CAPTURED {endpoint.id}: {len(raw.parts)} part(s), {size} bytes, "
                                    f"retrieved {record['retrieved_at']}")
            else:
                result.lines.append(f"INCOMPLETE {endpoint.id}: {'; '.join(raw.evidence.problems)}")
        # Blobs first, then the line that names them: a crash between the two leaves a blob
        # no line mentions, which is harmless, and never a line whose blob is missing.
        record["parts"] = [_part_record(store, endpoint.source, part, hide) for part in fetch.parts]
        S.append_fetch(store, _hidden(record, hide))
        result.outcomes[endpoint.id] = record["outcome"]

    if any(outcome != "captured" for outcome in result.outcomes.values()):
        result.exit_code = 1
    S.append_run(store, {"event": "finished", "run_id": run_id,
                         "finished_at": S.stamp(transport.now()), "transport": transport.kind,
                         "outcomes": result.outcomes, "missed": result.missed,
                         "exit_code": result.exit_code})
    return result
