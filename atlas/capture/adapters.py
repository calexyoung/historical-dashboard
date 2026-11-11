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

import csv
import io
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from urllib.parse import urlencode

from .http import CaptureError, Fetch, Part, Request
from .store import RELEASE_ZONE


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


class BlsAdapter:
    """The BLS Public Data API, version 2, without a key: one POST for up to 25 series over at
    most ten years (verified 2026-11-11: a longer range is cut to ten years *from the start
    year* with a message, and an unknown series is left out with a message, both under the
    status REQUEST_SUCCEEDED). So the window asked for is always the ten years ending this
    year, and any message at all makes the answer incomplete.

    The scope is what "complete" is complete *for*: these series, these years. A year that has
    rolled out of the window was not asked about, and its absence deletes nothing (M8)."""

    name = "bls"
    version = 1
    URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
    MAX_SERIES = 25
    MAX_YEARS = 10

    def problem(self, params: dict) -> str | None:
        series, years = params.get("series"), params.get("years", self.MAX_YEARS)
        if (not isinstance(series, list) or not series or len(series) > self.MAX_SERIES
                or not all(isinstance(s, str) and s for s in series) or len(set(series)) != len(series)):
            return f"it does not name between 1 and {self.MAX_SERIES} distinct series"
        if isinstance(years, bool) or not isinstance(years, int) or not 1 <= years <= self.MAX_YEARS:
            return f"years is not between 1 and {self.MAX_YEARS}"
        return None

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        end = fetch.now().astimezone(RELEASE_ZONE).year
        start = end - endpoint.params.get("years", self.MAX_YEARS) + 1
        scope = {"series": list(endpoint.params["series"]), "start_year": start, "end_year": end}
        body = json.dumps({"seriesid": scope["series"], "startyear": str(start), "endyear": str(end)})
        response = fetch.send(Request("POST", self.URL, (("Content-Type", "application/json"),),
                                      body.encode("utf-8")))
        return self.examine(scope, [response.body])

    def _rows(self, scope: dict, bodies: list[bytes], problems: list[str]) -> dict[str, list[dict]]:
        answer = _json(bodies[0], problems, "the answer")
        if answer is None:
            return {}
        if answer.get("status") != "REQUEST_SUCCEEDED":
            problems.append(f"the status is {answer.get('status')!r}, not 'REQUEST_SUCCEEDED'")
        messages = answer.get("message") or []
        if isinstance(messages, list):
            problems.extend(f"BLS says: {message}" for message in messages)
        else:
            problems.append("the message is not a list")
        results = answer.get("Results")
        listed = results.get("series") if isinstance(results, dict) else None
        found: dict[str, list[dict]] = {}
        for entry in listed if isinstance(listed, list) else []:
            if isinstance(entry, dict) and isinstance(entry.get("data"), list):
                found[str(entry.get("seriesID"))] = entry["data"]
        for series in scope["series"]:
            if series not in found:
                problems.append(f"series {series} is not in the answer")
            elif not found[series]:
                problems.append(f"series {series} has no rows")
        for series in found:
            if series not in scope["series"]:
                problems.append(f"series {series} was not asked for")
        return found

    def _observations(self, series: str, rows: list[dict], scope: dict, problems: list[str]) -> list[dict]:
        out, seen = [], set()
        for row in rows:
            if not isinstance(row, dict):
                problems.append(f"series {series} has a row that is not an object")
                continue
            year, code = str(row.get("year")), str(row.get("period"))
            value = row.get("value")
            if not (year.isascii() and year.isdigit() and len(code) == 3 and code[0] == "M"
                    and code[1:].isascii() and code[1:].isdigit() and 1 <= int(code[1:]) <= 12):
                problems.append(f"series {series} has a row that is not a month: {year} {code}")
                continue
            period = f"{year}-{code[1:]}"
            if period in seen:
                problems.append(f"series {series} gives {period} twice")
                continue
            seen.add(period)
            if not scope["start_year"] <= int(year) <= scope["end_year"]:
                problems.append(f"series {series} has {period}, outside the years asked for")
            footnotes = row.get("footnotes") or []
            if not isinstance(footnotes, list):
                problems.append(f"series {series} has footnotes that are not a list for {period}")
                continue
            notes = [{"code": str(n.get("code", "")), "text": str(n.get("text", ""))}
                     for n in footnotes if isinstance(n, dict) and n]
            if value != "-" and not (isinstance(value, str) and _is_number(value)):
                # Only "-" is known to mean "not published". Anything else unreadable is a
                # fault in the answer, and no Observation is made up from it.
                problems.append(f"series {series} has a value that is not a number or '-' "
                                f"for {period}: {value!r}")
                continue
            if value != "-":
                preliminary = any(n["code"] == "P" for n in notes)
                out.append({"period": period, "value": value,
                            "status": "preliminary" if preliminary else "observed", "footnotes": notes})
            else:
                # BLS prints "-" for a month it did not publish. That is a fact about the
                # month, not a deletion and not a zero.
                out.append({"period": period, "value": None, "status": "unavailable", "footnotes": notes})
        out.sort(key=lambda o: o["period"])
        return out

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        found = self._rows(scope, bodies, problems)
        checks = {}
        for series, rows in found.items():
            observations = self._observations(series, rows, scope, problems)
            checks[series] = {"rows": len(rows),
                              "first": observations[0]["period"] if observations else None,
                              "last": observations[-1]["period"] if observations else None}
        return _evidence(scope, {"series": checks}, problems)

    def parse(self, capture: RawCapture) -> NormalizedState:
        scope = capture.evidence.scope
        problems: list[str] = []
        found = self._rows(scope, capture.bodies, problems)
        series = {name: self._observations(name, rows, scope, problems)
                  for name, rows in found.items() if name in scope["series"]}
        return NormalizedState(not problems, scope, series, problems)


def _is_number(text: str) -> bool:
    body = text[1:] if text[:1] == "-" else text
    whole, _, fraction = body.partition(".")
    return whole.isdigit() and whole.isascii() and (fraction == "" and "." not in body
                                                    or fraction.isdigit() and fraction.isascii())


class TreasuryFiscalDataAdapter:
    """One table of the Fiscal Data API, every row, in pages. The pages are whole when they all
    report the same totals, their rows add up to the total, the rows are in the order asked for
    and no key appears twice (a table that changes while it is being paged shows up as one of
    those)."""

    name = "treasury_fiscal_data"
    version = 1
    BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    PAGE_SIZE = 10000
    MAX_PAGES = 50

    def problem(self, params: dict) -> str | None:
        if not isinstance(params.get("path"), str) or not params["path"] or "?" in params["path"]:
            return "it names no table path"
        key = params.get("key")
        if not isinstance(key, list) or not key or not all(isinstance(k, str) and k for k in key):
            return "it names no key fields"
        return None

    def _url(self, scope: dict, page: int) -> str:
        query = urlencode({"format": "json", "sort": ",".join(scope["key"]),
                           "page[number]": page, "page[size]": scope["page_size"]})
        return f"{self.BASE}{scope['path']}?{query}"

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {"path": params["path"], "key": list(params["key"]),
                 "page_size": params.get("page_size", self.PAGE_SIZE)}
        bodies = [fetch.get(self._url(scope, 1)).body]
        pages = self._total(bodies[0], "total-pages")
        for page in range(2, min(pages, self.MAX_PAGES) + 1):
            bodies.append(fetch.get(self._url(scope, page)).body)
        return self.examine(scope, bodies)

    @staticmethod
    def _total(body: bytes, name: str) -> int:
        try:
            value = json.loads(body.decode("utf-8"))["meta"][name]
        except (UnicodeDecodeError, ValueError, KeyError, TypeError):
            return 1
        return value if isinstance(value, int) and not isinstance(value, bool) else 1

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        keys: list[tuple] = []
        totals = set()
        for number, body in enumerate(bodies, start=1):
            page = _json(body, problems, f"page {number}")
            if page is None:
                continue
            data, meta = page.get("data"), page.get("meta")
            if not isinstance(data, list) or not isinstance(meta, dict):
                problems.append(f"page {number} has no data and meta")
                continue
            if meta.get("count") != len(data):
                problems.append(f"page {number} says it has {meta.get('count')} rows and has {len(data)}")
            total = (meta.get("total-count"), meta.get("total-pages"))
            if not all(isinstance(n, int) and not isinstance(n, bool) for n in total):
                problems.append(f"page {number} does not give its totals as numbers")
                continue
            totals.add(total)
            for row in data:
                if not isinstance(row, dict) or not all(
                        isinstance(row.get(field), (str, int)) and not isinstance(row.get(field), bool)
                        for field in scope["key"]):
                    problems.append(f"page {number} has a row without its key")
                    break
                keys.append(tuple(str(row[field]) for field in scope["key"]))
        total_count = total_pages = None
        if len(totals) > 1:
            problems.append("the pages do not agree on the totals; the table changed while it was read")
        elif totals:
            total_count, total_pages = next(iter(totals))
            if total_pages != len(bodies):
                problems.append(f"the table has {total_pages} pages and {len(bodies)} were read")
            if total_count != len(keys):
                problems.append(f"the table has {total_count} rows and {len(keys)} were read")
        if len(set(keys)) != len(keys):
            problems.append("a row's key appears twice")
        if keys != sorted(keys, key=_natural):
            problems.append("the rows are not in the order asked for")
        if not keys and not problems:
            problems.append("the table has no rows")
        checks = {"pages": len(bodies), "rows": len(keys), "total_count": total_count,
                  "total_pages": total_pages, "first": list(keys[0]) if keys else None,
                  "last": list(keys[-1]) if keys else None}
        return _evidence(scope, checks, problems)


def _natural(key: tuple) -> tuple:
    """Order a key as the API does: a field that is all digits counts as a number."""
    return tuple((0, int(cell), "") if cell.isascii() and cell.isdigit() else (1, 0, cell)
                 for cell in key)


class FedBoardAdapter:
    """One package of the Federal Reserve Board's Data Download Program, as CSV, whole history.
    The file is whole when its six label rows are there, its columns are exactly the series
    expected, in order, and every data row is a date, in order, with one cell per series."""

    name = "fed_board"
    version = 1
    URL = "https://www.federalreserve.gov/datadownload/Output.aspx"
    LABELS = ("Series Description", "Unit:", "Multiplier:", "Currency:", "Unique Identifier:",
              "Time Period")

    def problem(self, params: dict) -> str | None:
        if not all(isinstance(params.get(name), str) and params[name] for name in ("rel", "series")):
            return "it names no release and series package"
        expect = params.get("expect")
        if not isinstance(expect, list) or not expect or not all(isinstance(e, str) and e for e in expect):
            return "it does not say which series to expect"
        return None

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {"rel": params["rel"], "series": params["series"], "expect": list(params["expect"])}
        query = urlencode({"rel": scope["rel"], "series": scope["series"], "lastobs": "", "from": "",
                           "to": "", "filetype": "csv", "label": "include", "layout": "seriescolumn"})
        return self.examine(scope, [fetch.get(f"{self.URL}?{query}").body])

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        checks: dict = {"rows": 0, "first": None, "last": None}
        try:
            rows = list(csv.reader(io.StringIO(bodies[0].decode("utf-8"), newline="")))
        except (UnicodeDecodeError, csv.Error):
            return _evidence(scope, checks, ["the file is not CSV text"])
        labels = tuple(row[0].strip() if row else "" for row in rows[: len(self.LABELS)])
        if labels != self.LABELS:
            return _evidence(scope, checks, ["the file does not begin with the six label rows"])
        prefix = f"{scope['rel']}/{scope['rel']}/"
        columns = [cell.removeprefix(prefix) for cell in rows[4][1:]]
        if columns != scope["expect"] or rows[5][1:] != scope["expect"]:
            problems.append("the columns are not the series expected")
        width, days = len(scope["expect"]) + 1, []
        for row in rows[len(self.LABELS):]:
            if len(row) != width or not _is_day(row[0]):
                problems.append(f"a data row is not a date and {width - 1} cells: {row[0] if row else ''!r}")
                break
            days.append(row[0])
        if days != sorted(set(days)):
            problems.append("the dates are not in order, or one appears twice")
        if not days and not problems:
            problems.append("the file has no data rows")
        checks = {"rows": len(days), "first": days[0] if days else None,
                  "last": days[-1] if days else None}
        return _evidence(scope, checks, problems)


def _is_day(text: str) -> bool:
    try:
        return len(text) == 10 and date.fromisoformat(text).isoformat() == text
    except ValueError:
        return False


ADAPTERS = {adapter.name: adapter for adapter in
            (FixtureAdapter(), BlsAdapter(), TreasuryFiscalDataAdapter(), FedBoardAdapter())}


def capture(endpoint: Endpoint, fetch: Fetch) -> RawCapture:
    """Fetch one endpoint: the plan's ``fetch(spec) -> RawCapture``. Raises ``CaptureError``
    when the fetch fails; what did arrive stays in ``fetch.parts``."""
    adapter = ADAPTERS[endpoint.adapter]
    try:
        evidence = adapter.fetch(endpoint, fetch)
    except CaptureError:
        raise
    except Exception as error:
        # An answer in a shape no check foresaw. It must not take the run down with it: the
        # bytes are in ``fetch.parts`` and are kept as a failed capture.
        raise CaptureError(f"the {adapter.name} adapter could not read the answer "
                           f"({type(error).__name__}: {error})") from error
    if not fetch.parts:
        raise CaptureError(f"the {adapter.name} adapter made no request")
    return RawCapture(endpoint.id, adapter.name, list(fetch.parts), evidence,
                      max(part.response.received_at for part in fetch.parts))
