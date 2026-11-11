"""What a capture run writes (PLAN 4.3; ADR 0012, ADR 0021). All of it is under one directory,
``$ATLAS_STORE``, and all of it is append-only:

    raw/{source}/{yyyy-mm-dd}/{sha256}.gz   the exact bytes of one response, gzipped
    fetchlog.ndjson                         one line per Capture attempted, whatever its outcome
    runs.ndjson                             two lines per run, one when it starts and one when
                                            it finishes; missed days are counted from it
    LOCK                                    held for the length of a run

The day in a blob's path is the UTC day the bytes arrived. A blob is named by the SHA-256 of
the bytes as served, and gzip is written without a time or a name, so the same bytes always
make the same file: fetching an unchanged response again adds a fetch-log line and no blob.
The vintage store (M8) is built by replaying these files with their original retrieval times.
"""
from __future__ import annotations

import fcntl
import gzip
import hashlib
import io
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

LOG_FORMAT = 1
FETCH_LOG = "fetchlog.ndjson"
RUNS = "runs.ndjson"
#: Expected capture days are counted where the releases happen (PLAN 4.7).
RELEASE_ZONE = ZoneInfo("America/New_York")


class StoreLocked(RuntimeError):
    pass


def stamp(moment: datetime) -> str:
    """A time as the logs write it: UTC, whole seconds, ``Z``."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def unstamp(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def write_blob(store: Path, source: str, received_at: datetime, body: bytes) -> tuple[str, str]:
    """Keep ``body`` exactly. Returns its SHA-256 and the blob's path relative to the store."""
    digest = hashlib.sha256(body).hexdigest()
    day = received_at.astimezone(UTC).date().isoformat()
    relative = f"raw/{source}/{day}/{digest}.gz"
    path = store / relative
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        packed = io.BytesIO()
        with gzip.GzipFile(filename="", mode="wb", fileobj=packed, mtime=0, compresslevel=9) as out:
            out.write(body)
        temporary = path.with_name(f".{digest}.{os.getpid()}.tmp")
        temporary.write_bytes(packed.getvalue())
        os.replace(temporary, path)  # a reader never sees half a blob
    return digest, relative


def read_blob(store: Path, relative: str) -> bytes:
    """The bytes of a blob, checked against the hash in its name."""
    path = store / relative
    body = gzip.decompress(path.read_bytes())
    if hashlib.sha256(body).hexdigest() != path.name.removesuffix(".gz"):
        raise ValueError(f"{relative} does not hold the bytes its name promises")
    return body


def append_line(path: Path, record: dict) -> None:
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    with open(path, "a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() > 0:
            handle.seek(-1, os.SEEK_END)
            if handle.read(1) != b"\n":
                handle.write(b"\n")  # an earlier run was cut off mid-line; start a new one
        handle.write(line.encode("utf-8") + b"\n")
        handle.flush()
        os.fsync(handle.fileno())


def read_lines(path: Path, problems: list[str] | None) -> list[dict]:
    if not path.exists():
        return []
    records = []
    for number, line in enumerate(path.read_bytes().split(b"\n"), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line.decode("utf-8"))
        except ValueError:  # cut short by a crash, possibly inside a character
            record = None
        if not isinstance(record, dict):
            if problems is not None:
                problems.append(f"{path.name} line {number} is not whole and is passed over")
            continue
        records.append(record)
    return records


def append_fetch(store: Path, record: dict) -> None:
    append_line(store / FETCH_LOG, {"format": LOG_FORMAT, **record})


def append_run(store: Path, record: dict) -> None:
    append_line(store / RUNS, {"format": LOG_FORMAT, **record})


def read_fetch_log(store: Path, problems: list[str] | None = None) -> list[dict]:
    """Every whole line of the fetch log, oldest first. A line cut off by a crash is passed
    over and named in ``problems``."""
    return read_lines(Path(store) / FETCH_LOG, problems)


def read_runs(store: Path, problems: list[str] | None = None) -> list[dict]:
    return read_lines(Path(store) / RUNS, problems)


@contextmanager
def locked(store: Path) -> Iterator[None]:
    """Hold the store for one run. The lock is the operating system's, so it goes when the
    process does and a crash leaves nothing to clear."""
    with open(store / "LOCK", "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise StoreLocked("another capture run holds this store") from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def release_day(moment: datetime) -> date:
    return moment.astimezone(RELEASE_ZONE).date()


def unfinished_runs(runs: list[dict]) -> list[dict]:
    """The runs that wrote their starting line and never their finishing one."""
    ended = {run.get("run_id") for run in runs if run.get("event") == "finished"}
    return [run for run in runs if run.get("event") == "started" and run.get("run_id") not in ended]


def missed_days(runs: list[dict], fetches: list[dict], endpoints: list[str], now: datetime) -> dict:
    """For each endpoint, the finished days on which a capture was due and no complete one was
    made. An endpoint is due every day from the first run that selected it, whether or not that
    run got anything or even finished, up to yesterday. Days are New York's. A missed day is permanent: it shows
    later as a Capture gap."""
    today = release_day(now)
    missed: dict[str, list[str]] = {}
    for endpoint in endpoints:
        starts = [release_day(unstamp(run["started_at"])) for run in runs
                  if endpoint in run.get("selected", [])]
        if not starts:
            continue
        got = {release_day(unstamp(line["retrieved_at"])) for line in fetches
               if line.get("endpoint") == endpoint and line.get("outcome") == "captured"}
        day, days = min(starts), []
        while day < today:
            if day not in got:
                days.append(day.isoformat())
            day += timedelta(days=1)
        if days:
            missed[endpoint] = days
    return missed
