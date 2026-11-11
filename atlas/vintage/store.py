"""The vintage store (PLAN 4.2, 4.3 and M8; ADR 0005, ADR 0022): what Macro Atlas held for each
Series, and from when to when.

    obslog/{key}.parquet    the observation log: one row per version of each Observation
    metalog/{key}.ndjson    the metadata history: one line each time the metadata changed
    caplog/{key}.ndjson     the capture log: one line per complete Capture recorded for the
                            Series. A line whose change is "none" is a capture confirmation

``record`` takes the state one complete Capture gave for one Series and writes what changed:

* a Period not seen before opens a row;
* a value, a Status or the metadata that differs closes the current row and opens another;
* a Period that was current, was asked about and is not in the answer is closed with a
  tombstone. A Period outside the scope was not asked about and is left alone;
* nothing different at all adds a line to the capture log and touches no other byte.

A state that is not complete writes nothing. Every time in the store is a Capture's retrieval
time: this module never reads the clock, so replaying the same Captures gives the same files.
A row is current over the half-open interval from ``recorded_from`` up to ``recorded_to``.

Values are kept as the provider's own decimal text (``"129.250"``), never as a float. Two texts
that are the same number are the same value; the row keeps the spelling that opened it.

The capture-log line is written last and is what makes a record whole. If a run dies before it,
recording the same Capture again finishes the work, and until then the store refuses any other.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from ..capture.store import append_line, read_lines, stamp, unstamp
from ..period import FREQUENCIES, period_bounds

LOG_FORMAT = 1
REPRESENTATION = "native"
#: The release contract's vocabulary (schema/release.schema.json, observationStatus).
STATUSES = ("final", "preliminary", "revised", "estimate", "projected", "partial", "suppressed",
            "missing")
NO_VALUE = ("suppressed", "missing")

_KEY = re.compile(r"[a-z][a-z0-9_]{0,63}")
_DECIMAL = re.compile(r"-?[0-9]+(\.[0-9]+)?")
_INSTANT = pa.timestamp("s", tz="UTC")
SCHEMA = pa.schema([
    ("key", pa.string()), ("period", pa.string()),
    ("period_start", pa.date32()), ("period_end", pa.date32()),
    ("value", pa.string()), ("status", pa.string()), ("deleted", pa.bool_()),
    ("provider_from", _INSTANT), ("provider_to", _INSTANT), ("provider_precision", pa.string()),
    ("recorded_from", _INSTANT), ("recorded_to", _INSTANT),
    ("release_id", pa.string()), ("channel", pa.string()), ("representation", pa.string()),
    ("capture_id", pa.string()), ("metadata_hash", pa.string()),
])
_INSTANTS = ("provider_from", "provider_to", "recorded_from", "recorded_to")
_DAYS = ("period_start", "period_end")


class StoreError(ValueError):
    """The store cannot record this, and wrote nothing."""


@dataclass(frozen=True)
class CaptureRef:
    """The Capture a state came from. ``retrieved_at`` is the only clock the store keeps."""

    capture_id: str
    retrieved_at: datetime
    channel: str
    endpoint: str | None = None
    #: False when the bytes were invented for a fixture. The two kinds never share a store.
    real_bytes: bool = True
    parser: dict | None = None


@dataclass
class SeriesState:
    """What one Capture says about one Series. ``scope`` is the first and last calendar day the
    source was asked about (None for no bound): a Period wholly inside it and absent from
    ``observations`` is gone; a Period outside it was not asked about. ``observations`` are
    ``{period, value, status}`` with the value as decimal text, or None where the Status is
    missing or suppressed."""

    key: str
    freq: str
    complete: bool
    scope: tuple[str | None, str | None]
    observations: list[dict]
    metadata: dict
    problems: list[str] = field(default_factory=list)


@dataclass
class ChangeSet:
    """What recording one state changed. ``change`` is ``first``, ``revision`` (a Period was
    added, revised or withdrawn), ``metadata`` (only the metadata differs), ``none`` (a capture
    confirmation) or ``skipped`` (the state was not complete and nothing was written)."""

    key: str
    capture_id: str
    change: str
    added: list[str] = field(default_factory=list)
    revised: list[str] = field(default_factory=list)
    withdrawn: list[str] = field(default_factory=list)
    relabelled: list[str] = field(default_factory=list)
    metadata_changed: bool = False
    state_hash: str | None = None
    metadata_hash: str | None = None
    reason: str | None = None
    already: bool = False


def canonical(text: str) -> str:
    """One spelling per number: ``"129.250"`` and ``"0129.25"`` are both ``"129.25"``. Done on
    the text, so no precision is ever involved."""
    negative, body = text.startswith("-"), text.lstrip("-")
    whole, _, fraction = body.partition(".")
    whole, fraction = whole.lstrip("0") or "0", fraction.rstrip("0")
    number = f"{whole}.{fraction}" if fraction else whole
    return f"-{number}" if negative and number != "0" else number


def _same_value(a: str | None, b: str | None) -> bool:
    return a == b if a is None or b is None else canonical(a) == canonical(b)


def _digest(value: object, what: str) -> str:
    try:
        text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False)
    except (TypeError, ValueError) as error:
        raise StoreError(f"the {what} is not plain JSON ({error})") from None
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class VintageStore:
    def __init__(self, directory: Path | str):
        self.dir = Path(directory)

    # --- reading ---------------------------------------------------------------------------

    def series_keys(self) -> list[str]:
        """Every Series with at least one complete Capture recorded."""
        return sorted(path.stem for path in (self.dir / "caplog").glob("*.ndjson"))

    def rows(self, key: str) -> list[dict]:
        """The whole observation log of a Series: Periods in order, and for each Period its
        versions in the order they were recorded. Times are text, ``2026-03-10T13:30:01Z``."""
        path = self.dir / "obslog" / f"{key}.parquet"
        if not path.exists():
            return []
        rows = pq.read_table(path, schema=SCHEMA).to_pylist()
        for row in rows:
            for name in _INSTANTS:
                row[name] = None if row[name] is None else stamp(row[name])
            for name in _DAYS:
                row[name] = row[name].isoformat()
        return rows

    def vintage(self, key: str, at: datetime | None = None) -> list[dict]:
        """The Vintage of a Series at an instant: the Observation that was current for each
        Period then. ``at=None`` is the latest. Before the first Capture there is nothing, and
        a withdrawn Period is absent. This is what Macro Atlas held, not what was first
        reported (CONTEXT.md, Atlas-observed vintage)."""
        moment = None if at is None else stamp(at)
        return [row for row in self.rows(key) if not row["deleted"] and (
            row["recorded_to"] is None if moment is None
            else row["recorded_from"] <= moment and (row["recorded_to"] is None
                                                     or moment < row["recorded_to"]))]

    def metadata_history(self, key: str) -> list[dict]:
        """Each metadata the Series has had, in force from ``recorded_from`` up to
        ``recorded_to`` (None for the one in force now)."""
        lines = read_lines(self.dir / "metalog" / f"{key}.ndjson", None)
        ends = [line["recorded_from"] for line in lines[1:]] + [None]
        return [{**line, "recorded_to": end} for line, end in zip(lines, ends, strict=True)]

    def captures(self, key: str) -> list[dict]:
        """Every complete Capture recorded for the Series, oldest first. A Capture confirms
        only the Periods inside its ``scope``."""
        return read_lines(self.dir / "caplog" / f"{key}.ndjson", None)

    # --- writing ---------------------------------------------------------------------------

    def record(self, state: SeriesState, capture: CaptureRef) -> ChangeSet:
        """Record what one Capture says about one Series. Raises ``StoreError``, having written
        nothing, for a state the log cannot hold or a Capture that is out of order."""
        key, capture_id = state.key, capture.capture_id
        if not state.complete:
            return ChangeSet(key, capture_id, "skipped",
                             reason="; ".join(state.problems) or "the state is not complete")
        wanted = _checked(state)
        metadata_hash = _digest(state.metadata, "metadata")
        when = stamp(capture.retrieved_at)

        caplog = self.captures(key)
        done = next((line for line in caplog if line["capture_id"] == capture_id), None)
        if done is not None:
            return _change_set(key, done, already=True)
        rows = self.rows(key)
        metalog = read_lines(self.dir / "metalog" / f"{key}.ndjson", None)
        whole = {line["capture_id"] for line in caplog}
        cut_off = ({row["capture_id"] for row in rows} | {line["capture_id"] for line in metalog}) \
            - whole - {capture_id}
        if cut_off:
            raise StoreError(f"{key}: the record of capture {min(cut_off)} was cut off part way; "
                             "record that capture again before any other")
        if caplog:
            last = caplog[-1]
            if (last["retrieved_at"], last["capture_id"]) >= (when, capture_id):
                raise StoreError(f"{key}: capture {capture_id} ({when}) is not after the last one "
                                 f"recorded, {last['capture_id']} ({last['retrieved_at']})")
            if last["freq"] != state.freq:
                raise StoreError(f"{key} is {last['freq']} and this state is {state.freq}")
        self._refuse_a_mix(key, caplog, capture)

        current = {row["period"]: row for row in rows if row["recorded_to"] is None}
        opened = []
        for period, (value, status, first_day, last_day) in wanted.items():
            row = current.get(period)
            if (row is not None and not row["deleted"] and _same_value(row["value"], value)
                    and row["status"] == status and row["metadata_hash"] == metadata_hash):
                continue
            opened.append({"period": period, "period_start": first_day, "period_end": last_day,
                           "value": value, "status": status, "deleted": False})
        for period, row in current.items():
            if period not in wanted and not row["deleted"] and _inside(row, state.scope):
                opened.append({"period": period, "period_start": row["period_start"],
                               "period_end": row["period_end"], "value": None, "status": None,
                               "deleted": True})
        for new in opened:
            if new["period"] in current:
                current[new["period"]]["recorded_to"] = when
            rows.append({"key": key, **new, "provider_from": None, "provider_to": None,
                         "provider_precision": None, "recorded_from": when, "recorded_to": None,
                         "release_id": None, "channel": capture.channel,
                         "representation": REPRESENTATION, "capture_id": capture_id,
                         "metadata_hash": metadata_hash})
        rows.sort(key=lambda row: (row["period_start"], row["period"]))  # stable: versions keep their order

        # Metadata, then observations, then the line that makes the record whole.
        if not metalog or metalog[-1]["metadata_hash"] != metadata_hash:
            line = {"format": LOG_FORMAT, "key": key, "recorded_from": when,
                    "capture_id": capture_id, "metadata": state.metadata,
                    "metadata_hash": metadata_hash}
            self._line("metalog", key, line)
            metalog.append(line)
        if opened:
            self._write_rows(key, rows)
        line = self._capture_line(state, capture, when, rows, metalog, metadata_hash, first=not caplog)
        self._line("caplog", key, line)
        return _change_set(key, line)

    def _refuse_a_mix(self, key: str, caplog: list[dict], capture: CaptureRef) -> None:
        if caplog:
            held = caplog[0]["real_bytes"]
        else:
            other = next(iter(self.series_keys()), None)
            if other is None:
                return
            held = self.captures(other)[0]["real_bytes"]
        if held != capture.real_bytes:
            kinds = {True: "values an agency served", False: "invented values"}
            raise StoreError(f"this store holds {kinds[held]} and capture {capture.capture_id} "
                             f"holds {kinds[capture.real_bytes]}; invented and agency values "
                             "are never mixed in one store")

    def _capture_line(self, state, capture, when, rows, metalog, metadata_hash, *, first) -> dict:
        """The capture-log line, worked out from what the files now hold rather than from what
        this call did, so that finishing a record that was cut off writes the same line."""
        chains: dict[str, list[dict]] = {}
        for row in rows:
            chains.setdefault(row["period"], []).append(row)
        kinds: dict[str, list[str]] = {"added": [], "revised": [], "withdrawn": [], "relabelled": []}
        for period, chain in chains.items():
            for index, row in enumerate(chain):
                if row["capture_id"] != capture.capture_id:
                    continue
                before = chain[index - 1] if index else None
                if row["deleted"]:
                    kinds["withdrawn"].append(period)
                elif before is None or before["deleted"]:
                    kinds["added"].append(period)
                elif not _same_value(before["value"], row["value"]) or before["status"] != row["status"]:
                    kinds["revised"].append(period)
                else:
                    kinds["relabelled"].append(period)
        metadata_changed = any(line["capture_id"] == capture.capture_id for line in metalog[1:])
        if first:
            change = "first"
        elif kinds["added"] or kinds["revised"] or kinds["withdrawn"]:
            change = "revision"
        elif metadata_changed or kinds["relabelled"]:
            change = "metadata"
        else:
            change = "none"
        now = [row for row in rows if row["recorded_to"] is None and not row["deleted"]]
        state_hash = _digest({"key": state.key, "observations": [
            [row["period"], None if row["value"] is None else canonical(row["value"]), row["status"]]
            for row in now]}, "state")
        return {"format": LOG_FORMAT, "key": state.key, "capture_id": capture.capture_id,
                "retrieved_at": when, "endpoint": capture.endpoint, "channel": capture.channel,
                "real_bytes": capture.real_bytes, "parser": capture.parser, "freq": state.freq,
                "scope": list(state.scope), "change": change, **kinds,
                "metadata_changed": metadata_changed, "observations": len(now),
                "state_hash": state_hash, "metadata_hash": metadata_hash}

    def _line(self, log: str, key: str, record: dict) -> None:
        path = self.dir / log / f"{key}.ndjson"
        path.parent.mkdir(parents=True, exist_ok=True)
        append_line(path, record)

    def _write_rows(self, key: str, rows: list[dict]) -> None:
        columns = {name: [] for name in SCHEMA.names}
        for row in rows:
            for name in SCHEMA.names:
                value = row[name]
                if value is not None and name in _INSTANTS:
                    value = unstamp(value)
                elif name in _DAYS:
                    value = datetime.strptime(value, "%Y-%m-%d").date()
                columns[name].append(value)
        packed = io.BytesIO()
        pq.write_table(pa.table(columns, schema=SCHEMA), packed, compression="zstd")
        path = self.dir / "obslog" / f"{key}.parquet"
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{key}.{os.getpid()}.tmp")
        with open(temporary, "wb") as handle:
            handle.write(packed.getvalue())
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)  # a reader never sees half a log


def _change_set(key: str, line: dict, *, already: bool = False) -> ChangeSet:
    return ChangeSet(key, line["capture_id"], line["change"], line["added"], line["revised"],
                     line["withdrawn"], line["relabelled"], line["metadata_changed"],
                     line["state_hash"], line["metadata_hash"], None, already)


def _inside(row: dict, scope: tuple[str | None, str | None]) -> bool:
    """A Period is inside the scope only if every day of it was asked about."""
    first, last = scope
    return (first is None or row["period_start"] >= first) and (last is None or row["period_end"] <= last)


def _checked(state: SeriesState) -> dict[str, tuple]:
    """The state's Observations by Period, in Period order, as ``(value, status, first day,
    last day)``. Raises ``StoreError`` for anything the log cannot hold."""
    key = state.key
    if not isinstance(key, str) or not _KEY.fullmatch(key):
        raise StoreError(f"{key!r} is not a Series key")
    if state.freq not in FREQUENCIES:
        raise StoreError(f"{key}: {state.freq!r} is not a frequency")
    if not isinstance(state.metadata, dict):
        raise StoreError(f"{key}: the metadata is not an object")
    scope = tuple(state.scope)
    if len(scope) != 2 or not all(day is None or period_bounds("daily", day) for day in scope):
        raise StoreError(f"{key}: the scope is not a pair of calendar days")
    found: dict[str, tuple] = {}
    for observation in state.observations:
        period, value, status = (observation.get(name) for name in ("period", "value", "status"))
        bounds = period_bounds(state.freq, period)
        if bounds is None:
            raise StoreError(f"{key}: {period!r} is not a {state.freq} Period")
        if period in found:
            raise StoreError(f"{key}: {period} is given twice")
        if status not in STATUSES:
            raise StoreError(f"{key}: {period} has a status the log does not know, {status!r}")
        if status in NO_VALUE:
            if value is not None:
                raise StoreError(f"{key}: {period} is {status} and carries a value")
        elif value is None:
            raise StoreError(f"{key}: {period} is {status} and has no value")
        elif not isinstance(value, str) or not _DECIMAL.fullmatch(value):
            raise StoreError(f"{key}: the value for {period} is not a decimal number: {value!r}")
        if not _inside({"period_start": bounds[0], "period_end": bounds[1]}, scope):
            raise StoreError(f"{key}: {period} is outside the scope the state says was asked about")
        found[period] = (value, status, *bounds)
    return dict(sorted(found.items(), key=lambda item: (item[1][2], item[0])))
