"""Source adapters: the fetch half, and for BLS the parse half (PLAN 4.2 and M7; ADR 0021).

An adapter knows one source's requests and what a whole answer from it looks like. ``fetch``
makes the requests through a ``Fetch`` and returns the *completeness evidence*: what was asked
for (the scope), what came back (the checks) and every reason the answer is not whole (the
problems). ``examine`` is the same judgement made from kept bytes alone, so a replay can make it
again. An adapter raises ``CaptureError`` when a fetch fails and never calls a partial answer
complete. Parsing for Treasury Fiscal Data and the Federal Reserve Board arrived in M13, the
IMF's SDMX API in M14, and the two sources that want an API key, the BEA and the EIA, in M15.
An adapter never holds a key: it says which one a request wants (``key``) and the Session
adds it as the request is sent (ADR 0029).

Structure and freshness are different questions. "Complete" here means the source answered the
whole of what was asked, in the shape expected. Whether the newest value is recent is not
judged at capture.
"""
from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from types import MappingProxyType
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
        key = params.get("key")
        if key is not None and not (isinstance(key, dict) and set(key) == {"parameter", "name"}
                                    and all(isinstance(v, str) and v for v in key.values())):
            return "its key does not name a query parameter and a key"
        return None if isinstance(params.get("url"), str) else "it names no url"

    def key(self, params: dict) -> tuple[str, str] | None:
        """A made-up source may want a made-up key, so the kit's handling of keys can be tested."""
        key = params.get("key")
        return (key["parameter"], key["name"]) if key else None

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        scope = {"url": endpoint.params["url"]}
        return self.examine(scope, [fetch.get(endpoint.params["url"], key=self.key(endpoint.params)).body])

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        whole = bodies[0].endswith(b"# end\n")
        problems = [] if whole else ["the body does not end with the line '# end'"]
        return _evidence(scope, {"bytes": len(bodies[0])}, problems)


class BlsAdapter:
    """The BLS Public Data API, version 2, without a key: one POST for up to 25 series over at
    most ten years (verified 2026-11-11: a longer range is cut to ten years *from the start
    year* with a message, and an unknown series is left out with a message, both under the
    status REQUEST_SUCCEEDED). So the window asked for is the ``years`` ending this year, ten
    years to a request, oldest first, and any message at all makes the answer incomplete: a
    window must not reach back before any of its series began (the Bureau answers "No Data
    Available for Series ... Year: ..." for such a year).

    A series is monthly (M01 to M12) or quarterly (Q01 to Q04), never both. A value is
    ``unavailable`` where the Bureau prints "-", else ``preliminary`` under footnote P, else
    ``revised`` under footnote R, else ``observed``.

    The scope is what "complete" is complete *for*: these series, these years. A year that has
    rolled out of the window was not asked about, and its absence deletes nothing (M8)."""

    name = "bls"
    version = 2
    URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
    MAX_SERIES = 25
    REQUEST_YEARS = 10  # what one keyless request may span
    DEFAULT_YEARS = 10
    MAX_YEARS = 100

    def problem(self, params: dict) -> str | None:
        series, years = params.get("series"), params.get("years", self.DEFAULT_YEARS)
        if (not isinstance(series, list) or not series or len(series) > self.MAX_SERIES
                or not all(isinstance(s, str) and s for s in series) or len(set(series)) != len(series)):
            return f"it does not name between 1 and {self.MAX_SERIES} distinct series"
        if isinstance(years, bool) or not isinstance(years, int) or not 1 <= years <= self.MAX_YEARS:
            return f"years is not between 1 and {self.MAX_YEARS}"
        return None

    def _requests(self, scope: dict) -> list[tuple[int, int]]:
        """The years of each request, oldest first: ten at a time counted back from the end of
        the window, so the newest request never holds this year alone (in January it would
        come back with no rows at all)."""
        first, last = scope["start_year"], scope["end_year"]
        spans = [(max(end - self.REQUEST_YEARS + 1, first), end)
                 for end in range(last, first - 1, -self.REQUEST_YEARS)]
        return spans[::-1]

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        end = fetch.now().astimezone(RELEASE_ZONE).year
        start = end - endpoint.params.get("years", self.DEFAULT_YEARS) + 1
        scope = {"series": list(endpoint.params["series"]), "start_year": start, "end_year": end}
        bodies = []
        for first, last in self._requests(scope):
            body = json.dumps({"seriesid": scope["series"], "startyear": str(first), "endyear": str(last)})
            bodies.append(fetch.send(Request("POST", self.URL, (("Content-Type", "application/json"),),
                                             body.encode("utf-8"))).body)
        return self.examine(scope, bodies)

    def _read(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
        """Each series' Observations over every part, in order, and the checks: how many rows
        each had, and which have no figure yet this year."""
        requests = self._requests(scope)
        if len(bodies) != len(requests):
            problems.append(f"{len(requests)} parts were asked for and {len(bodies)} were kept")
        series: dict[str, list[dict]] = {}
        counts: dict[str, int] = {}
        waiting: dict[str, list[str]] = {}
        for number, (body, (first, last)) in enumerate(zip(bodies, requests, strict=False), start=1):
            said: list[str] = []
            found, not_yet = self._rows(scope, [body], said)
            if not_yet:
                waiting[str(scope["end_year"])] = not_yet
            for name, rows in found.items():
                counts[name] = counts.get(name, 0) + len(rows)
                series.setdefault(name, []).extend(self._observations(
                    name, rows, {"start_year": first, "end_year": last}, said))
            prefix = f"part {number}: " if len(requests) > 1 else ""
            problems.extend(prefix + problem for problem in said)
        for name, observations in series.items():
            observations.sort(key=lambda o: o["period"])
            if len({"Q" in o["period"] for o in observations}) > 1:
                problems.append(f"series {name} gives both months and quarters")
        checks: dict = {"series": {name: {"rows": counts[name],
                                          "first": observations[0]["period"] if observations else None,
                                          "last": observations[-1]["period"] if observations else None}
                                   for name, observations in series.items()}}
        if waiting:
            checks["no_data_yet"] = waiting
        return series, checks

    def _rows(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], list[str]]:
        """The rows of each series in one answer, and the series the Bureau says have no
        figure yet for the last year asked about."""
        answer = _json(bodies[0], problems, "the answer")
        if answer is None:
            return {}, []
        if answer.get("status") != "REQUEST_SUCCEEDED":
            problems.append(f"the status is {answer.get('status')!r}, not 'REQUEST_SUCCEEDED'")
        messages = answer.get("message") or []
        not_yet: list[str] = []
        if isinstance(messages, list):
            # The one message that is not a fault: this year has no figure yet. Exactly that,
            # of a series asked for and of the last year asked about, and nothing like it.
            excused = {f"No Data Available for Series {name} Year: {scope['end_year']}": name
                       for name in scope["series"]}
            not_yet = [excused[m] for m in messages if isinstance(m, str) and m in excused]
            problems.extend(f"BLS says: {message}" for message in messages
                            if not (isinstance(message, str) and message in excused))
        else:
            problems.append("the message is not a list")
        results = answer.get("Results")
        listed = results.get("series") if isinstance(results, dict) else None
        found: dict[str, list[dict]] = {}
        if not isinstance(listed, list):
            problems.append("the answer lists no series")
            listed = []
        for entry in listed:
            if not (isinstance(entry, dict) and isinstance(entry.get("seriesID"), str)
                    and isinstance(entry.get("data"), list)):
                problems.append("the answer lists something that is not a series")
            elif entry["seriesID"] in found:
                problems.append(f"series {entry['seriesID']} is in the answer twice")
            else:
                found[entry["seriesID"]] = entry["data"]
        for series in scope["series"]:
            if series not in found:
                problems.append(f"series {series} is not in the answer")
            elif not found[series]:
                problems.append(f"series {series} has no rows")
        for series in found:
            if series not in scope["series"]:
                problems.append(f"series {series} was not asked for")
        for series in not_yet:
            if any(isinstance(row, dict) and str(row.get("year")) == str(scope["end_year"])
                   for row in found.get(series, [])):
                problems.append(f"BLS says there is no data for series {series} in "
                                f"{scope['end_year']} and lists some")
        return found, sorted(set(not_yet))

    def _observations(self, series: str, rows: list[dict], scope: dict, problems: list[str]) -> list[dict]:
        out, seen = [], set()
        for row in rows:
            if not isinstance(row, dict):
                problems.append(f"series {series} has a row that is not an object")
                continue
            year, code = str(row.get("year")), str(row.get("period"))
            value = row.get("value")
            numbered = len(code) == 3 and code[1:].isascii() and code[1:].isdigit()
            if year.isascii() and year.isdigit() and numbered and code[0] == "M" and 1 <= int(code[1:]) <= 12:
                period = f"{year}-{code[1:]}"
            elif year.isascii() and year.isdigit() and numbered and code[0] == "Q" and 1 <= int(code[1:]) <= 4:
                period = f"{year}-Q{int(code[1:])}"
            else:
                problems.append(f"series {series} has a row that is not a month or a quarter: {year} {code}")
                continue
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
                codes = {n["code"] for n in notes}
                status = "preliminary" if "P" in codes else "revised" if "R" in codes else "observed"
                out.append({"period": period, "value": value, "status": status, "footnotes": notes})
            else:
                # BLS prints "-" for a month it did not publish. That is a fact about the
                # month, not a deletion and not a zero.
                out.append({"period": period, "value": None, "status": "unavailable", "footnotes": notes})
        out.sort(key=lambda o: o["period"])
        return out

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        _, checks = self._read(scope, bodies, problems)
        return _evidence(scope, checks, problems)

    def coverage(self, scope: dict) -> tuple[str, str]:
        """The first and last calendar day a scope asked about. A Period inside them that the
        answer does not list is gone; a Period outside them was not asked about (M8)."""
        return f"{scope['start_year']:04d}-01-01", f"{scope['end_year']:04d}-12-31"

    def parse(self, capture: RawCapture) -> NormalizedState:
        scope = capture.evidence.scope
        problems: list[str] = []
        series, _ = self._read(scope, capture.bodies, problems)
        return NormalizedState(not problems, scope,
                               {name: rows for name, rows in series.items() if name in scope["series"]},
                               problems)


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
    #: How a table becomes Observations (``read``); ``series`` names the value fields, which
    #: are the Origin's own identifiers for what is read.
    #: ``daily_rows``: one row a day, the Period is its record_date (Debt to the Penny).
    #: ``mts_summary``: table 1 of the Monthly Treasury Statement, see ``_mts``.
    READERS = ("daily_rows", "mts_summary")
    MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
              "September", "October", "November", "December")

    def problem(self, params: dict) -> str | None:
        if not isinstance(params.get("path"), str) or not params["path"] or "?" in params["path"]:
            return "it names no table path"
        key = params.get("key")
        if not isinstance(key, list) or not key or not all(isinstance(k, str) and k for k in key):
            return "it names no key fields"
        read, series = params.get("read"), params.get("series")
        if read is None and series is None:
            return None  # fetched and kept; nothing is read from it yet
        if read is None:
            return "it names series and not how to read the table"
        if read not in self.READERS:
            return f"its read is not {' or '.join(self.READERS)}"
        if (not isinstance(series, list) or not series or len(set(series)) != len(series)
                or not all(isinstance(name, str) and name for name in series)):
            return "it says how to read the table and not which series"
        if key[0] != "record_date":
            return "a table read by record_date is sorted by record_date first"
        return None

    def _url(self, scope: dict, page: int) -> str:
        query = urlencode({"format": "json", "sort": ",".join(scope["key"]),
                           "page[number]": page, "page[size]": scope["page_size"]})
        return f"{self.BASE}{scope['path']}?{query}"

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {"path": params["path"], "key": list(params["key"]),
                 "page_size": params.get("page_size", self.PAGE_SIZE)}
        if params.get("read"):
            scope["read"], scope["series"] = params["read"], list(params["series"])
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
        if scope.get("read"):
            series, extra = self._series(scope, bodies, problems)
            checks.update(extra)
            checks["series"] = {name: {"rows": len(rows), "first": rows[0]["period"] if rows else None,
                                       "last": rows[-1]["period"] if rows else None}
                                for name, rows in series.items()}
        return _evidence(scope, checks, list(dict.fromkeys(problems)))

    # --- reading -------------------------------------------------------------------------

    @staticmethod
    def _table(bodies: list[bytes]) -> list[dict]:
        """Every row that is an object, in the order kept. What is wrong with the pages
        themselves is ``examine``'s to say."""
        rows: list[dict] = []
        for body in bodies:
            try:
                data = json.loads(body.decode("utf-8")).get("data")
            except (UnicodeDecodeError, ValueError, AttributeError):
                continue
            rows.extend(row for row in data if isinstance(row, dict)) if isinstance(data, list) else None
        return rows

    @staticmethod
    def _observation(name: str, period: str, value: object, problems: list[str]) -> dict | None:
        if value == "null":
            # The table lists the Period and prints no number for it.
            return {"period": period, "value": None, "status": "unavailable", "footnotes": []}
        if isinstance(value, str) and _is_number(value):
            return {"period": period, "value": value, "status": "observed", "footnotes": []}
        problems.append(f"{name} has a value that is not a number or null for {period}: {value!r}")
        return None

    def _series(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
        rows = self._table(bodies)
        for row in rows:
            if not isinstance(row.get("record_date"), str) or not _is_day(row["record_date"]):
                problems.append(f"a row's record_date is not a day: {row.get('record_date')!r}")
        rows = [row for row in rows if isinstance(row.get("record_date"), str) and _is_day(row["record_date"])]
        if scope["read"] == "mts_summary":
            series, extra = self._mts(scope["series"], rows, problems)
            return self._not_empty(series, problems), extra
        series: dict[str, list[dict]] = {name: [] for name in scope["series"]}
        for name, out in series.items():
            seen = set()
            for row in rows:
                day = row["record_date"]
                if day in seen:
                    problems.append(f"{name} gives {day} twice")
                    continue
                seen.add(day)
                observation = self._observation(name, day, row.get(name), problems)
                if observation:
                    out.append(observation)
            out.sort(key=lambda o: o["period"])
        return self._not_empty(series, problems), {}

    @staticmethod
    def _not_empty(series: dict[str, list[dict]], problems: list[str]) -> dict[str, list[dict]]:
        """A series with no entry at all is a table that was not read, not a series whose
        every Period has been withdrawn."""
        for name, rows in series.items():
            if not rows:
                problems.append(f"{name} is read and the table has no entry for it")
        return series

    def _mts(self, names: list[str], rows: list[dict], problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
        """Table 1 of the Monthly Treasury Statement. Each statement (one record_date, the
        last day of its month) lists the months of the last fiscal year and of this one:

        - a header per fiscal year: record_type_cd ``SL``, parent_id ``null``, "FY 2026";
        - a row per month: record_type_cd ``MTH``, its parent_id the header's
          classification_id *in the same statement*, named for the month. The fiscal year
          begins in October, so FY 2026's October is October 2025;
        - a year-to-date total under each header: ``SL``, "Year-to-Date". Not read.

        Later statements revise earlier months, so a month is read from the latest statement
        that lists it. A row that is none of the three, a month listed twice in one statement
        or a month after the statement's own keeps the answer from being whole. The statement's
        date says which statement is the later one and nothing about when Macro Atlas knew."""
        statements: dict[str, list[dict]] = {}
        for row in rows:
            statements.setdefault(row["record_date"], []).append(row)
        latest: dict[str, dict] = {}
        for day in sorted(statements):
            where = f"the statement of {day}"
            own = day[:7]
            if _month_after(day) == own:
                problems.append(f"a statement is dated {day}, which is not the last day of a month")
            headers, months = {}, []
            for row in statements[day]:
                kind, desc = row.get("record_type_cd"), row.get("classification_desc")
                desc = desc if isinstance(desc, str) else repr(desc)
                year = desc[3:] if desc.startswith("FY ") else ""
                if kind == "SL" and row.get("parent_id") == "null" and len(year) == 4 and year.isascii() and year.isdigit():
                    headers[str(row.get("classification_id"))] = int(year)
                elif kind == "MTH":
                    months.append((row, desc))
                elif not (kind == "SL" and desc == "Year-to-Date"):
                    problems.append(f"{where} has a row that is not a fiscal-year header, a month "
                                    f"or a year-to-date total: {desc!r}")
            if not months:
                problems.append(f"{where} lists no month")
            listed: dict[str, dict] = {}
            for row, desc in months:
                fiscal = headers.get(str(row.get("parent_id")))
                if fiscal is None:
                    problems.append(f"{where} has a month row under no fiscal-year header: {desc!r}")
                    continue
                if desc not in self.MONTHS:
                    problems.append(f"{where} has a month row that names no month: {desc!r}")
                    continue
                month = self.MONTHS.index(desc) + 1
                period = f"{fiscal - 1 if month >= 10 else fiscal:04d}-{month:02d}"
                if period in listed:
                    problems.append(f"{where} lists {period} twice")
                    continue
                if period > own:
                    problems.append(f"{where} lists {period}, a month after its own")
                    continue
                listed[period] = row
            latest.update(listed)  # statements in date order: the later one wins
        series: dict[str, list[dict]] = {name: [] for name in names}
        for period in sorted(latest):
            for name in names:
                observation = self._observation(name, period, latest[period].get(name), problems)
                if observation:
                    series[name].append(observation)
        return series, {"statements": len(statements)}

    def coverage(self, scope: dict) -> tuple[None, None]:
        """The whole table is asked for, every time: a Period that has left it is gone."""
        return None, None

    def parse(self, capture: RawCapture) -> NormalizedState:
        scope = capture.evidence.scope
        if not scope.get("read"):
            return NormalizedState(False, scope, {}, ["the endpoint does not say how its table is read"])
        evidence = self.examine(scope, capture.bodies)  # the pages must be whole, as at capture
        problems = list(evidence.problems)
        series, _ = self._series(scope, capture.bodies, [])
        return NormalizedState(not problems, scope, series, problems)


def _natural(key: tuple) -> tuple:
    """Order a key as the API does: a field that is all digits counts as a number."""
    return tuple((0, int(cell), "") if cell.isascii() and cell.isdigit() else (1, 0, cell)
                 for cell in key)


class FedBoardAdapter:
    """One package of the Federal Reserve Board's Data Download Program, as CSV, whole history.
    A file is whole when its six label rows are there, its columns are exactly the series
    expected, in order, every data row is a Period of the file's kind, in order, with one cell
    per series, and every cell is a number, a code the Board uses for "no number" or (only
    before a series begins or after it ends) empty.

    ``period`` says how the file names time: ``day`` (2026-11-06), ``week`` (a day, the level
    on that day standing for its ISO week), ``month`` (2026-10) or ``quarter`` (2026Q2).

    ``from_years`` asks for the package in spans. The program answers 200 with an empty body
    when a file would be too large (H.10's daily rates since 1971, verified 2026-11-11), and
    also the first time it is asked for a file it has not built, so an empty answer is asked
    for again; a span that stays empty leaves the capture incomplete, and the cure is another
    cut in ``from_years``. The last span ends on 31 December of this year in New York: an open
    end is not answered.

    ``labels`` holds what the Board's label rows say of a series (unit, multiplier, currency),
    and names the columns that are read: a column with no pinned labels is checked for shape
    and gives no Observations. A label that changes makes the capture incomplete: the figures
    would mean something else. So does a column that is read and has no entry at all."""

    name = "fed_board"
    version = 2
    URL = "https://www.federalreserve.gov/datadownload/Output.aspx"
    LABELS = ("Series Description", "Unit:", "Multiplier:", "Currency:", "Unique Identifier:",
              "Time Period")
    PERIODS = ("day", "week", "month", "quarter")
    #: What the Board prints where it lists a Period and gives no number (seen 2026-11-11).
    NO_NUMBER = ("ND", "NA", "NC")
    _LABEL_FIELDS = ("unit", "multiplier", "currency")

    def problem(self, params: dict) -> str | None:
        if not all(isinstance(params.get(name), str) and params[name] for name in ("rel", "series")):
            return "it names no release and series package"
        expect = params.get("expect")
        if not isinstance(expect, list) or not expect or not all(isinstance(e, str) and e for e in expect):
            return "it does not say which series to expect"
        if params.get("period", "day") not in self.PERIODS:
            return "its period is not day, week, month or quarter"
        years = params.get("from_years")
        if years is not None and (not isinstance(years, list) or not years or not all(
                type(y) is int and 1000 <= y <= 9999 for y in years) or years != sorted(set(years))):
            return "its from_years are not years in order"
        labels = params.get("labels", {})
        if not isinstance(labels, dict):
            return "its labels are not an object"
        for name, said in labels.items():
            if name not in expect:
                return f"its labels name {name}, which it does not expect"
            if not isinstance(said, dict) or set(said) != set(self._LABEL_FIELDS) \
                    or not all(isinstance(v, str) for v in said.values()):
                return f"its labels do not give a unit, a multiplier and a currency for {name}"
        return None

    def _url(self, scope: dict, span: list[str] | None) -> str:
        def us(day: str) -> str:
            return f"{day[5:7]}/{day[8:10]}/{day[0:4]}"

        start, end = (us(span[0]), us(span[1])) if span else ("", "")
        query = urlencode({"rel": scope["rel"], "series": scope["series"], "lastobs": "", "from": start,
                           "to": end, "filetype": "csv", "label": "include", "layout": "seriescolumn"})
        return f"{self.URL}?{query}"

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {"rel": params["rel"], "series": params["series"], "expect": list(params["expect"])}
        if params.get("period", "day") != "day":
            scope["period"] = params["period"]
        if params.get("labels"):
            scope["labels"] = {name: dict(said) for name, said in params["labels"].items()}
        years = params.get("from_years")
        if years:
            this_year = fetch.now().astimezone(RELEASE_ZONE).year
            ends = [year - 1 for year in years[1:]] + [max(this_year, years[-1])]
            scope["spans"] = [[f"{a:04d}-01-01", f"{b:04d}-12-31"] for a, b in zip(years, ends, strict=True)]

        def again(response) -> str | None:
            return None if response.body else "HTTP 200 with an empty body"

        bodies = [fetch.get(self._url(scope, span), again=again).body
                  for span in scope.get("spans", [None])]
        return self.examine(scope, bodies)

    @staticmethod
    def _time(kind: str, cell: str) -> tuple[str, str, str] | None:
        """A time cell as (the Period's label, its first day, its last day), or None."""
        from ..period import period_bounds

        if kind in ("day", "week"):
            if not _is_day(cell):
                return None
            if kind == "day":
                return cell, cell, cell
            iso = date.fromisoformat(cell).isocalendar()
            label, freq = f"{iso[0]:04d}-W{iso[1]:02d}", "weekly"
        elif kind == "month":
            label, freq = cell, "monthly"
        else:
            label, freq = (f"{cell[:4]}-Q{cell[5:]}" if len(cell) == 6 and cell[4] == "Q" else ""), "quarterly"
        bounds = period_bounds(freq, label) if cell.isascii() else None
        return (label, *bounds) if bounds else None

    def _read(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[list[str], dict[str, list[dict]]]:
        """The time cells of every data row, in the order read, and each series' Observations.
        Everything that keeps the answer from being whole is added to ``problems``."""
        kind = scope.get("period", "day")
        spans = scope.get("spans")
        expect = scope["expect"]
        width = len(expect) + 1
        cells_seen: list[str] = []
        columns: dict[str, list[tuple[str, str, str]]] = {name: [] for name in expect}
        if len(bodies) != len(spans or [None]):
            problems.append(f"{len(spans or [None])} parts were asked for and {len(bodies)} were kept")
        for number, body in enumerate(bodies, start=1):
            where = f"part {number}: " if spans else ""
            try:
                rows = list(csv.reader(io.StringIO(body.decode("utf-8"), newline="")))
            except (UnicodeDecodeError, csv.Error):
                problems.append(f"{where}the file is not CSV text")
                continue
            labels = tuple(row[0].strip() if row else "" for row in rows[: len(self.LABELS)])
            if labels != self.LABELS:
                problems.append(f"{where}the file does not begin with the six label rows")
                continue
            identifiers = [cell.split("/") for cell in rows[4][1:]]
            if (rows[5][1:] != expect or len(identifiers) != len(expect) or any(
                    len(parts) != 3 or parts[0] != scope["rel"] or not parts[1] or parts[2] != name
                    for parts, name in zip(identifiers, expect, strict=True))):
                problems.append(f"{where}the columns are not the series expected")
                continue
            for name, want in scope.get("labels", {}).items():
                at = expect.index(name) + 1
                got = {"unit": rows[1][at] if at < len(rows[1]) else "",
                       "multiplier": rows[2][at] if at < len(rows[2]) else "",
                       "currency": rows[3][at] if at < len(rows[3]) else ""}
                if got != want:
                    def say(d: dict) -> str:
                        return ", ".join(f"{f} {d[f]!r}" for f in self._LABEL_FIELDS)
                    problems.append(f"{where}{name} is labelled {say(got)}; {say(want)} was expected")
            if len(rows) == len(self.LABELS) and spans:
                # A span answered with its labels and nothing under them: every Period of the
                # span would read as gone from the file.
                problems.append(f"{where}the file has no data rows")
            for row in rows[len(self.LABELS):]:
                time = self._time(kind, row[0]) if len(row) == width else None
                if time is None:
                    problems.append(f"{where}a data row is not a {kind} and {width - 1} cells: "
                                    f"{row[0] if row else ''!r}")
                    break
                if spans and number <= len(spans) and not spans[number - 1][0] <= time[1] <= time[2] <= spans[number - 1][1]:
                    problems.append(f"part {number} has {row[0]}, outside the span asked for")
                cells_seen.append(row[0])
                for name, cell in zip(expect, row[1:], strict=True):
                    columns[name].append((time[0], row[0], cell))
        if cells_seen != sorted(set(cells_seen)):
            problems.append("the dates are not in order, or one appears twice")
        if not cells_seen and not problems:
            problems.append("the file has no data rows")
        series: dict[str, list[dict]] = {}
        read = scope.get("labels", {})
        for name, column in columns.items():
            filled = [i for i, (_, _, cell) in enumerate(column) if cell != ""]
            if name in read and not filled and cells_seen:
                problems.append(f"{name} is read and the file has no entry for it")
            out, seen = [], set()
            for i, (label, shown, cell) in enumerate(column):
                if cell == "":
                    if filled and filled[0] < i < filled[-1]:
                        problems.append(f"{name} has an empty cell for {shown}, between two Periods "
                                        "it has entries for")
                    continue
                if label in seen:
                    problems.append(f"{name} gives {label} twice")
                    continue
                seen.add(label)
                if cell in self.NO_NUMBER:
                    out.append({"period": label, "value": None, "status": "unavailable",
                                "footnotes": [{"code": cell, "text": ""}]})
                elif _is_number(cell):
                    out.append({"period": label, "value": cell, "status": "observed", "footnotes": []})
                else:
                    problems.append(f"{name} has a cell that is not a number, {', '.join(self.NO_NUMBER)} "
                                    f"or empty for {shown}: {cell!r}")
            if name in read:
                # A column is read only if its labels were pinned when it was captured. The
                # cells of the others are still held to the file's shape, above.
                series[name] = out
        return cells_seen, series

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        seen, _ = self._read(scope, bodies, problems)
        checks = {"rows": len(seen), "first": seen[0] if seen else None, "last": seen[-1] if seen else None}
        return _evidence(scope, checks, list(dict.fromkeys(problems)))

    def coverage(self, scope: dict) -> tuple[str | None, str | None]:
        """What was asked about: everything, for a whole package; for spans, their first day
        to their last. Never what happened to come back, or a Period that left the file
        would not be seen to have gone."""
        spans = scope.get("spans")
        return (spans[0][0], spans[-1][1]) if spans else (None, None)

    def parse(self, capture: RawCapture) -> NormalizedState:
        scope = capture.evidence.scope
        problems: list[str] = []
        _, series = self._read(scope, capture.bodies, problems)
        return NormalizedState(not problems, scope, series, list(dict.fromkeys(problems)))


class ImfSdmxAdapter:
    """One dataflow of the International Monetary Fund's SDMX 3.0 data API, as SDMX-JSON, for a
    named list of series, whole history, in one request (seen 2026-11-11: no key, no paging; the
    consumer price index of nineteen countries is about 0.6 MB).

    ``series`` are full SDMX keys (``JPN.CPI._T.IX.M``). One request asks for every combination
    of the parts it names, so the list must be exactly such a set. The last part is the
    frequency: M, Q or A.

    The answer is read by name and never by position: a series by the ``keyPosition`` of each
    dimension, an attribute by its ``id``. It is whole when it is one data set of the dataflow
    asked for, holds exactly the series asked for, each with a number, and every Observation is
    a Period of the series' frequency, once, with a value that is a number in text or null.

    **Observed, estimated, projected.** The Fund says of each value how it was derived
    (``DERIVATION_TYPE``, its code list CL_DERIVATION_TYPE as read on 2026-11-11): ``O``
    reported official data and ``R`` raw data are *observed*; ``SE``, ``SEME`` and ``SEHI`` (IMF
    staff estimates) are an *estimate*; ``SP`` (IMF staff projections) is *projected*. A value
    with any other code, or with none, keeps the answer from being whole: whether it is
    observed is not said, and it is never guessed. So does a value for a Period that had not
    begun on the day of the fetch (``asked_on``, New York) unless the Fund calls it a
    projection. A dataflow that does not mark its values this way (the World Economic Outlook,
    seen 2026-11-11) cannot be read by this adapter until a contract for it is written.

    ``marks`` are the values of the free-text ``STATUS`` attribute that someone has looked at.
    A listed mark rides along as a footnote and changes nothing; any other keeps the answer from
    being whole. A letter is never read for a meaning: no code list stands behind it.

    ``reference`` pins the reference period of an index (``COMMON_REFERENCE_PERIOD``, such as
    ``2020A``), per series. A rebase changes what every figure means, so it keeps the answer
    from being whole until the endpoint and the Series say the new base.

    A null before a series' first number is padding and no entry (Japan's index is listed from
    1900 and begins in 1955). A null after it is a Period the Fund lists and prints no number
    for. A Period the Fund does not list at all is no entry."""

    name = "imf_sdmx"
    version = 1
    BASE = "https://api.imf.org/external/sdmx/3.0/data/dataflow"
    FREQUENCIES = MappingProxyType({"M": ("monthly", "month"), "Q": ("quarterly", "quarter"),
                                    "A": ("annual", "year")})
    #: What each derivation code makes of a value. Anything else is not read.
    DERIVATION = MappingProxyType({"O": "observed", "R": "observed", "SE": "estimate", "SEME": "estimate",
                                   "SEHI": "estimate", "SP": "projected"})
    _NAME = re.compile(r"[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*")
    _PART = re.compile(r"[A-Za-z0-9_]+")

    def problem(self, params: dict) -> str | None:
        if not all(isinstance(params.get(name), str) and self._NAME.fullmatch(params[name])
                   for name in ("agency", "flow")):
            return "it names no agency and dataflow"
        series = params.get("series")
        if (not isinstance(series, list) or not series or len(set(map(str, series))) != len(series)
                or not all(isinstance(key, str) and len(key.split(".")) >= 2
                           and all(self._PART.fullmatch(part) for part in key.split(".")) for key in series)):
            return "it does not name its series as distinct SDMX keys"
        parts = [key.split(".") for key in series]
        if len({len(p) for p in parts}) != 1:
            return "its series keys are not all of one length"
        if any(p[-1] not in self.FREQUENCIES for p in parts):
            return "its series are not monthly (M), quarterly (Q) or annual (A)"
        combinations = 1
        for position in zip(*parts, strict=True):
            combinations *= len(set(position))
        if combinations != len(series):
            return ("its series are not every combination of their parts, so one request cannot "
                    "ask for exactly them")
        reference = params.get("reference", {})
        if not isinstance(reference, dict):
            return "its reference periods are not an object"
        for key, said in reference.items():
            if key not in series:
                return f"its reference names {key}, which it does not ask for"
            if not isinstance(said, str) or not said:
                return "its reference periods are not text"
        marks = params.get("marks", [])
        if (not isinstance(marks, list) or len(set(map(str, marks))) != len(marks)
                or not all(isinstance(mark, str) and mark for mark in marks)):
            return "its marks are not a list of distinct marks"
        return None

    def _url(self, scope: dict) -> str:
        parts = zip(*(key.split(".") for key in scope["series"]), strict=True)
        key = ".".join("+".join(dict.fromkeys(position)) for position in parts)
        return f"{self.BASE}/{scope['agency']}/{scope['flow']}/+/{key}?dimensionAtObservation=TIME_PERIOD"

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {"agency": params["agency"], "flow": params["flow"], "series": list(params["series"])}
        if params.get("reference"):
            scope["reference"] = dict(params["reference"])
        if params.get("marks"):
            scope["marks"] = list(params["marks"])
        scope["asked_on"] = fetch.now().astimezone(RELEASE_ZONE).date().isoformat()
        return self.examine(scope, [fetch.get(self._url(scope)).body])

    @classmethod
    def _period(cls, frequency: str, time: object) -> tuple[str, str] | None:
        """A TIME_PERIOD as (the Period's label, its first day), or None."""
        from ..period import period_bounds

        if not isinstance(time, str) or not time.isascii():
            return None
        if frequency == "M":
            label = f"{time[:4]}-{time[6:]}" if len(time) == 8 and time[4:6] == "-M" else ""
        elif frequency == "Q":
            label = time if len(time) == 7 and time[4:6] == "-Q" else ""
        else:
            label = time if len(time) == 4 else ""
        bounds = period_bounds(cls.FREQUENCIES[frequency][0], label) if label else None
        return (label, bounds[0]) if bounds else None

    @staticmethod
    def _described(listed: object) -> list[dict] | None:
        """A list of descriptors, each with an id, or None."""
        if not isinstance(listed, list) or not all(isinstance(d, dict) and isinstance(d.get("id"), str)
                                                   for d in listed):
            return None
        return listed

    @staticmethod
    def _said(descriptors: list[dict], cells: list) -> dict[str, object]:
        """Each attribute by its id: text as sent, or the code an index points at. An index
        outside the answer's own list is ``KeyError`` under the attribute's id."""
        out: dict[str, object] = {}
        for descriptor, cell in zip(descriptors, cells, strict=False):
            codes = descriptor.get("values")
            if cell is None or isinstance(cell, str):
                out[descriptor["id"]] = cell
            elif (type(cell) is int and isinstance(codes, list) and 0 <= cell < len(codes)
                    and isinstance(codes[cell], dict) and isinstance(codes[cell].get("id"), str)):
                out[descriptor["id"]] = codes[cell]["id"]
            else:
                raise KeyError(descriptor["id"])
        return out

    def _read(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
        if len(bodies) != 1:
            problems.append(f"1 part was asked for and {len(bodies)} were kept")
            return {}, {}
        answer = _json(bodies[0], problems, "the answer")
        if answer is None:
            return {}, {}
        data = answer.get("data")
        sets = data.get("dataSets") if isinstance(data, dict) else None
        structures = data.get("structures") if isinstance(data, dict) else None
        if not (isinstance(sets, list) and isinstance(structures, list) and len(sets) == 1 and len(structures) == 1
                and isinstance(sets[0], dict) and isinstance(structures[0], dict)
                and isinstance(sets[0].get("series"), dict)):
            problems.append("the answer does not hold exactly one data set and one structure")
            return {}, {}
        structure = structures[0]
        wanted = f"Dataflow={scope['agency']}:{scope['flow']}("
        links = structure.get("links") if isinstance(structure.get("links"), list) else []
        flows = [link["urn"].split("Dataflow=", 1)[1] for link in links
                 if isinstance(link, dict) and isinstance(link.get("urn"), str) and wanted in link["urn"]]
        if not flows:
            problems.append(f"the answer does not say it is the dataflow {scope['agency']}:{scope['flow']}")
            return {}, {}
        checks: dict = {"dataflow": flows[0]}
        dimensions = structure.get("dimensions") if isinstance(structure.get("dimensions"), dict) else {}
        attributes = structure.get("attributes") if isinstance(structure.get("attributes"), dict) else {}
        measures = structure.get("measures") if isinstance(structure.get("measures"), dict) else {}
        by_series = self._described(dimensions.get("series"))
        by_time = self._described(dimensions.get("observation"))
        of_series = self._described(attributes.get("series", []))
        of_observation = self._described(attributes.get("observation", []))
        measured = self._described(measures.get("observation"))
        for listed in (by_series, of_series, of_observation):
            names = [d["id"] for d in listed or []]
            twice = next((name for name in names if names.count(name) > 1), None)
            if twice:
                # Read by name, a second description could say the opposite of the first.
                problems.append(f"the answer describes {twice} twice")
                return {}, checks
        if (not by_series or by_time is None or len(by_time) != 1 or by_time[0]["id"] != "TIME_PERIOD"
                or not isinstance(by_time[0].get("values"), list)
                or not all(type(d.get("keyPosition")) is int and isinstance(d.get("values"), list) for d in by_series)
                or len({d["keyPosition"] for d in by_series}) != len(by_series)):
            problems.append("the answer does not describe its series and its times")
            return {}, checks
        if of_series is None or of_observation is None or measured is None \
                or [d["id"] for d in measured] != ["OBS_VALUE"]:
            problems.append("the answer does not describe its observations as OBS_VALUE and attributes")
            return {}, checks
        times = by_time[0]["values"]
        order = sorted(range(len(by_series)), key=lambda i: by_series[i]["keyPosition"])
        found: dict[str, list[dict]] = {}
        for index, entry in sets[0]["series"].items():
            cells = index.split(":") if isinstance(index, str) else []
            try:
                if len(cells) != len(by_series) or not all(c.isascii() and c.isdigit() for c in cells):
                    raise KeyError(index)
                key = ".".join(by_series[i]["values"][int(cells[i])]["id"] for i in order)
            except (KeyError, IndexError, TypeError):
                problems.append(f"the answer has a series whose key is not in its own lists: {index!r}")
                continue
            if key not in scope["series"]:
                problems.append(f"{key} was not asked for")
                continue
            if key in found:
                problems.append(f"{key} is in the answer twice")
                continue
            found[key] = self._observations(scope, key, entry, of_series, of_observation, times, problems, checks)
        for key in scope["series"]:
            if key not in found:
                problems.append(f"{key} is not in the answer")
            elif not any(o["value"] is not None for o in found[key]):
                problems.append(f"{key} is in the answer without a single number")
        return found, checks

    def _observations(self, scope: dict, key: str, entry: object, of_series: list[dict],
                      of_observation: list[dict], times: list, problems: list[str], checks: dict) -> list[dict]:
        frequency = key.rsplit(".", 1)[1]
        kind = self.FREQUENCIES[frequency][1]
        listed = entry.get("observations") if isinstance(entry, dict) else None
        cells = entry.get("attributes", []) if isinstance(entry, dict) else None
        if not isinstance(listed, dict) or not isinstance(cells, list):
            problems.append(f"{key} is not a series with observations")
            return []
        try:
            said = self._said(of_series, cells)
        except KeyError as error:
            problems.append(f"{key} has an attribute {error.args[0]} that is not in the answer's own list of codes")
            return []
        if said.get("SCALE") != "0":
            scale = said.get("SCALE")
            problems.append(f"{key} is scaled by 10^{scale}; a scale of 0 (units) was expected" if scale is not None
                            else f"{key} does not say its scale; a scale of 0 (units) was expected")
        pinned = scope.get("reference", {}).get(key)
        if pinned is not None and said.get("COMMON_REFERENCE_PERIOD") != pinned:
            problems.append(f"{key} is on the reference period {said.get('COMMON_REFERENCE_PERIOD')!r}; "
                            f"{pinned!r} was expected (a rebase: every figure means something else)")
        marks = scope.get("marks", [])
        rows: list[tuple[str, dict]] = []
        seen: set[str] = set()
        for at, cell in listed.items():
            time = times[int(at)] if isinstance(at, str) and at.isascii() and at.isdigit() and int(at) < len(times) else None
            if not isinstance(time, dict):
                problems.append(f"{key} has an observation whose time is not in the answer's own list: {at!r}")
                continue
            period = self._period(frequency, time.get("value"))
            if period is None:
                problems.append(f"{key} has a time that is not a {kind}: {time.get('value')!r}")
                continue
            label, first_day = period
            if label in seen:
                problems.append(f"{key} gives {label} twice")
                continue
            seen.add(label)
            if not isinstance(cell, list) or not cell:
                problems.append(f"{key} has an observation that is not a list for {label}")
                continue
            try:
                about = self._said(of_observation, cell[1:])
            except KeyError as error:
                problems.append(f"{key} has an attribute {error.args[0]} that is not in the answer's own "
                                f"list of codes for {label}")
                continue
            value = cell[0]
            if value is not None and not (isinstance(value, str) and _is_number(value)):
                problems.append(f"{key} has a value that is not a number in text or null for {label}: {value!r}")
                continue
            notes = []
            mark = about.get("STATUS")
            if mark is not None and mark not in marks:
                problems.append(f"{key} carries the mark {mark!r} for {label}, which the endpoint does not "
                                "list among the marks it has seen (its marks)")
            elif mark is not None:
                notes.append({"code": mark, "text": ""})
            if value is None:
                rows.append((first_day, {"period": label, "value": None, "status": "unavailable", "footnotes": notes}))
                continue
            derivation = about.get("DERIVATION_TYPE")
            status = self.DERIVATION.get(derivation) if isinstance(derivation, str) else None
            if status is None:
                what = "no derivation type" if derivation is None else f"the derivation type {derivation!r}"
                problems.append(f"{key} has {what} for {label}: whether that value is observed, an estimate "
                                "or a projection is not said, and it is not guessed")
                continue
            if first_day > scope["asked_on"] and status != "projected":
                problems.append(f"{key} has a value for {label}, a Period that had not begun on "
                                f"{scope['asked_on']}, and does not call it a projection")
            own = about.get("REFERENCE_PERIOD")
            whole = said.get("COMMON_REFERENCE_PERIOD")
            if pinned is not None and own is not None and own != whole:
                # Against the series' own base: a rebase of the whole series is said once, above.
                problems.append(f"{key} gives {label} on the reference period {own!r}; {whole!r} was expected")
            rows.append((first_day, {"period": label, "value": value, "status": status, "footnotes": notes}))
        rows.sort(key=lambda row: row[0])
        begun = next((i for i, (_, row) in enumerate(rows) if row["value"] is not None), len(rows))
        out = [row for _, row in rows[begun:]]
        check = {"rows": len(out), "first": out[0]["period"] if out else None,
                 "last": out[-1]["period"] if out else None}
        if pinned is not None:
            check["reference"] = said.get("COMMON_REFERENCE_PERIOD")
        checks.setdefault("series", {})[key] = check
        return out

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        _, checks = self._read(scope, bodies, problems)
        return _evidence(scope, checks, list(dict.fromkeys(problems)))

    def coverage(self, scope: dict) -> tuple[None, None]:
        """The whole history is asked for, every time: a Period that has left it is gone."""
        return None, None

    def read(self, scope: dict, bodies: list[bytes]) -> NormalizedState:
        """What kept bytes say, under the scope they were asked for."""
        problems: list[str] = []
        series, _ = self._read(scope, bodies, problems)
        return NormalizedState(not problems, scope, series, list(dict.fromkeys(problems)))

    def parse(self, capture: RawCapture) -> NormalizedState:
        return self.read(capture.evidence.scope, capture.bodies)


class BeaAdapter:
    """The Bureau of Economic Analysis's data API (M15; ADR 0029). It wants a key, sent as the
    query parameter ``UserID``, and repeats that key in every answer; the Session adds the one
    and takes out the other, so nothing here ever holds it.

    One request asks for one whole thing, every year: a table of the National Income and
    Product Accounts with all its lines (``read: nipa``), or one indicator of the International
    Transactions Accounts (``read: ita``). A series is the Bureau's own code for it
    (``A191RX``, ``TSI_ItaBalGdsServ_QSA``). A code can sit on two lines of one table, so a
    NIPA series is read from the line the endpoint pins, and what its rows say of themselves is
    pinned with it (``labels``: unit, multiplier, metric): a change of multiplier stops the
    capture instead of changing every figure by a thousand. ``basis`` pins a text the line or
    the table's own note must hold ("chained (2017) dollars"), because nothing else in a row
    says which year's dollars a chained series is in.

    An error is an HTTP 200 with ``Error`` in place of ``Results``. A value is the Bureau's
    text with the thousands commas taken out and nothing else changed; anything that is then
    not a number makes the capture incomplete, for a line that is read. The Bureau marks no
    value as preliminary: every one is ``observed``, and a later estimate of the same quarter
    is a revision the vintage store sees."""

    name = "bea"
    version = 1
    URL = "https://apps.bea.gov/api/data"
    KEY = ("UserID", "BEA_API_KEY")
    #: For each way of reading: the frequencies it may be asked at and what each makes a
    #: Period; what names a series in a row; the labels pinned, by the row field each is read
    #: from; and the request parameters that say what is asked, by the scope field each takes.
    READS = MappingProxyType({
        "nipa": {"frequencies": {"M": "monthly", "Q": "quarterly", "A": "annual"}, "id": "SeriesCode",
                 "labels": {"unit": "CL_UNIT", "multiplier": "UNIT_MULT", "metric": "METRIC_NAME"},
                 "asks": {"DataSetName": "dataset", "TableName": "table", "Frequency": "frequency"}},
        "ita": {"frequencies": {"QSA": "quarterly", "QNSA": "quarterly", "A": "annual"}, "id": "TimeSeriesId",
                "labels": {"unit": "CL_UNIT", "multiplier": "UNIT_MULT"},
                "asks": {"Indicator": "indicator", "AreaOrCountry": "area", "Frequency": "frequency"}},
    })
    _NAME = re.compile(r"[A-Za-z0-9_]+")
    _TIMES = MappingProxyType({
        "monthly": (re.compile(r"([0-9]{4})M(0[1-9]|1[0-2])"), "{0}-{1}", "month"),
        "quarterly": (re.compile(r"([0-9]{4})Q([1-4])"), "{0}-Q{1}", "quarter"),
        "annual": (re.compile(r"([0-9]{4})"), "{0}", "year"),
    })
    _VALUE = re.compile(r"-?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]+)?")

    def key(self, params: dict) -> tuple[str, str]:
        return self.KEY

    def problem(self, params: dict) -> str | None:
        how = self.READS.get(params.get("read"))
        if how is None:
            return f"its read is not {' or '.join(self.READS)}"
        named = {"nipa": ("dataset", "table"), "ita": ("indicator", "area")}[params["read"]]
        for name in named:
            if not isinstance(params.get(name), str) or not self._NAME.fullmatch(params[name]):
                return f"it names no {name}"
        if params.get("frequency") not in how["frequencies"]:
            listed = list(how["frequencies"])
            return f"its frequency is not {', '.join(listed[:-1])} or {listed[-1]}"
        series = params.get("series")
        if (not isinstance(series, list) or not series or len(set(map(str, series))) != len(series)
                or not all(isinstance(s, str) and self._NAME.fullmatch(s) for s in series)):
            return "it does not name its series"
        labels = params.get("labels")
        wanted = ({"line"} if params["read"] == "nipa" else set()) | set(how["labels"])
        allowed = wanted | ({"basis"} if params["read"] == "nipa" else set())
        for name in series:
            pinned = labels.get(name) if isinstance(labels, dict) else None
            if pinned is None:
                return f"it does not pin the labels of {name}"
            if (not isinstance(pinned, dict) or not wanted <= set(pinned) <= allowed
                    or not all(isinstance(v, str) and v for v in pinned.values())):
                order = [n for n in ("line", "unit", "multiplier", "metric") if n in wanted]
                return f"the labels of {name} are not {', '.join(order)}"
        if isinstance(labels, dict) and set(labels) - set(series):
            return f"it pins labels for {min(set(labels) - set(series))}, which it does not ask for"
        return None

    def _url(self, scope: dict) -> str:
        how = self.READS[scope["read"]]
        asked = {"method": "GetData"}
        if scope["read"] == "ita":
            asked["DataSetName"] = "ITA"
        asked.update({parameter: scope[name] for parameter, name in how["asks"].items()})
        return f"{self.URL}?{urlencode({**asked, 'Year': 'ALL', 'ResultFormat': 'JSON'})}"

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {name: params[name] for name in ("read", "dataset", "table", "indicator", "area", "frequency")
                 if name in params}
        scope["series"] = list(params["series"])
        # The pins go into the scope: an old Capture is read under what it was asked with.
        scope["labels"] = {name: dict(params["labels"][name]) for name in params["series"]}
        scope["asked_on"] = fetch.now().astimezone(RELEASE_ZONE).date().isoformat()
        return self.examine(scope, [fetch.get(self._url(scope), key=self.KEY).body])

    @staticmethod
    def _labelled(pinned: dict) -> str:
        return ", ".join(f"{name} {pinned[name]!r}" for name in ("unit", "multiplier", "metric") if name in pinned)

    def _read(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
        from ..period import period_bounds

        if len(bodies) != 1:
            problems.append(f"1 part was asked for and {len(bodies)} were kept")
            return {}, {}
        answer = _json(bodies[0], problems, "the answer")
        if answer is None:
            return {}, {}
        top = answer.get("BEAAPI")
        results = top.get("Results") if isinstance(top, dict) else None
        for holder in (top, results):
            error = holder.get("Error") if isinstance(holder, dict) else None
            if error is not None:
                detail = error.get("ErrorDetail") if isinstance(error, dict) else None
                words = [error.get("APIErrorCode"), error.get("APIErrorDescription"),
                         detail.get("Description") if isinstance(detail, dict) else None] \
                    if isinstance(error, dict) else [json.dumps(error)[:200]]
                problems.append("BEA says: " + " ".join(str(w) for w in words if w))
                return {}, {}
        how = self.READS[scope["read"]]
        request = top.get("Request") if isinstance(top, dict) else None
        echoed = request.get("RequestParam") if isinstance(request, dict) else None
        if not isinstance(echoed, list) or not all(isinstance(e, dict) for e in echoed):
            problems.append("the answer does not say what it was asked for")
            return {}, {}
        said = {str(e.get("ParameterName", "")).upper(): str(e.get("ParameterValue", "")) for e in echoed}
        expected = {parameter: scope[name] for parameter, name in how["asks"].items()}
        expected["Year"] = "ALL"
        if scope["read"] == "ita":
            expected["DataSetName"] = "ITA"
        for parameter, value in expected.items():
            # The Bureau repeats what it was asked in capitals.
            if said.get(parameter.upper(), "").upper() != value.upper():
                problems.append(f"the answer says it was asked for {parameter} "
                                f"{said.get(parameter.upper()) or 'nothing'}, not {value}")
        data = results.get("Data") if isinstance(results, dict) else None
        if not isinstance(data, list) or not data:
            problems.append("the answer has no rows")
            return {}, {}
        checks: dict = {"rows": len(data)}
        produced = results.get("UTCProductionTime", results.get("TsLastUpdated"))
        if isinstance(produced, str):
            checks["produced"] = produced
        note = None
        if scope["read"] == "nipa":
            notes = results.get("Notes") if isinstance(results.get("Notes"), list) else []
            note = next((n.get("NoteText") for n in notes if isinstance(n, dict)
                         and n.get("NoteRef") == scope["table"] and isinstance(n.get("NoteText"), str)), None)
            if note is not None:
                checks["note"] = note
        fixed = {"TableName": scope["table"]} if scope["read"] == "nipa" else \
            {"Indicator": scope["indicator"], "AreaOrCountry": scope["area"], "Frequency": scope["frequency"]}
        strays = sum(1 for row in data if not isinstance(row, dict)
                     or not isinstance(row.get(how["id"]), str) or not isinstance(row.get("TimePeriod"), str)
                     or any(row.get(field) != value for field, value in fixed.items()))
        if strays:
            what = " and ".join(f"{field} {value}" for field, value in fixed.items())
            problems.append(f"the answer has {strays} row(s) that are not rows of {what}")
            return {}, checks
        frequency = how["frequencies"][scope["frequency"]]
        pattern, label_as, kind = self._TIMES[frequency]
        found: dict[str, list[dict]] = {}
        for name in scope["series"]:
            pinned = scope["labels"][name]
            rows = [row for row in data if row[how["id"]] == name
                    and (scope["read"] != "nipa" or row.get("LineNumber") == pinned["line"])]
            if not rows:
                problems.append(f"{name} is not on line {pinned['line']} of the answer" if scope["read"] == "nipa"
                                else f"{name} is not in the answer")
                continue
            ours = {label: pinned[label] for label in how["labels"]}
            other = next(({label: row.get(field) for label, field in how["labels"].items()} for row in rows
                          if any(row.get(field) != pinned[label] for label, field in how["labels"].items())), None)
            if other is not None:
                problems.append(f"{name} is labelled {self._labelled(other)}; {self._labelled(ours)} was expected")
            basis = pinned.get("basis")
            if basis is not None and not any(isinstance(text, str) and basis.casefold() in text.casefold()
                                             for text in (rows[0].get("LineDescription"), note)):
                problems.append(f"neither the line of {name} nor the table's note says {basis!r} "
                                "(a rebase: every figure means something else)")
            out: list[tuple[str, dict]] = []
            seen: set[str] = set()
            for row in rows:
                time = row["TimePeriod"]
                match = pattern.fullmatch(time) if time.isascii() else None
                label = label_as.format(*match.groups()) if match else None
                bounds = period_bounds(frequency, label) if label else None
                if bounds is None:
                    problems.append(f"{name} has a time that is not a {kind}: {time!r}")
                    continue
                if label in seen:
                    problems.append(f"{name} gives {label} twice")
                    continue
                seen.add(label)
                value = row.get("DataValue")
                if not (isinstance(value, str) and value.isascii() and self._VALUE.fullmatch(value)):
                    # "(D)" and the like are known of other BEA data sets and were not seen in
                    # these. What one would mean here is not guessed.
                    problems.append(f"{name} has a value that is not a number for {label}: {value!r}")
                    continue
                if bounds[0] > scope["asked_on"]:
                    problems.append(f"{name} has a value for {label}, a Period that had not begun on "
                                    f"{scope['asked_on']}")
                out.append((bounds[0], {"period": label, "value": value.replace(",", ""),
                                        "status": "observed", "footnotes": []}))
            out.sort(key=lambda pair: pair[0])
            found[name] = [row for _, row in out]
            checks.setdefault("series", {})[name] = {
                "rows": len(out), "first": out[0][1]["period"] if out else None,
                "last": out[-1][1]["period"] if out else None}
        return found, checks

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        _, checks = self._read(scope, bodies, problems)
        return _evidence(scope, checks, list(dict.fromkeys(problems)))

    def coverage(self, scope: dict) -> tuple[None, None]:
        """Every year is asked for, every time: a Period that has left the table is gone."""
        return None, None

    def parse(self, capture: RawCapture) -> NormalizedState:
        problems: list[str] = []
        series, _ = self._read(capture.evidence.scope, capture.bodies, problems)
        problems = list(dict.fromkeys(problems))
        return NormalizedState(not problems, capture.evidence.scope, series if not problems else {}, problems)


class EiaAdapter:
    """The Energy Information Administration's API, version 2 (M15; ADR 0029). It wants a key,
    sent as the query parameter ``api_key``; the Session adds it and nothing here holds it. A
    missing or wrong key is answered with HTTP 403, which fails the fetch.

    An endpoint is one route (``petroleum/pri/spt``) at one frequency, one column of data
    (``value``; ``generation`` on the electricity route) and the series named by one facet
    (``series``; ``fueltypeid`` where a row has no series id), with any other facet held to one
    value (``facets``). Every Period is asked for, in pages of at most 5,000 rows sorted by
    period and then by the facet. The units each series' rows carry are pinned (``units``).

    A value is the Administration's own text: the answer is read so that a number printed bare
    is kept as its characters, not as a float. One thing is changed: a figure printed without
    a zero before its point (".995", as the gasoline price under a dollar is) is given one. A Period listed with ``null`` is an Observation
    with no value. A weekly row is dated by a day, which names its ISO week.

    Pages are whole when they agree on the total, add up to it, and their rows are in order
    with none repeated. That shows a table that grew or shrank while it was read; a figure
    revised between two pages would not show, and is seen by the next capture instead."""

    name = "eia"
    version = 1
    BASE = "https://api.eia.gov/v2"
    KEY = ("api_key", "EIA_API_KEY")
    PAGE_SIZE = 5000  # the most the API gives in one answer
    MAX_PAGES = 40
    FREQUENCIES = MappingProxyType({"daily": "day", "weekly": "week", "monthly": "month",
                                    "quarterly": "quarter", "annual": "year"})
    _ROUTE = re.compile(r"[a-z0-9-]+(/[a-z0-9-]+)*")
    _BARE = re.compile(r"-?\.[0-9]+")
    _NAME = re.compile(r"[A-Za-z0-9_.-]+")

    def key(self, params: dict) -> tuple[str, str]:
        return self.KEY

    def problem(self, params: dict) -> str | None:
        if not isinstance(params.get("route"), str) or not self._ROUTE.fullmatch(params["route"]):
            return "it names no route"
        if params.get("frequency") not in self.FREQUENCIES:
            return "its frequency is not daily, weekly, monthly, quarterly or annual"
        for name in ("column", "facet"):
            if name in params and not (isinstance(params[name], str) and self._NAME.fullmatch(params[name])):
                return f"its {name} is not a name"
        series = params.get("series")
        if (not isinstance(series, list) or not series or len(set(map(str, series))) != len(series)
                or not all(isinstance(s, str) and self._NAME.fullmatch(s) for s in series)):
            return "it does not name its series"
        facets = params.get("facets", {})
        if not isinstance(facets, dict) or not all(
                isinstance(k, str) and self._NAME.fullmatch(k) and isinstance(v, str) and self._NAME.fullmatch(v)
                for k, v in facets.items()):
            return "its facets are not each one name and one value"
        if params.get("facet", "series") in facets:
            return "its facets hold the facet that names its series"
        units = params.get("units")
        for name in series:
            if not isinstance(units, dict) or not isinstance(units.get(name), str) or not units[name]:
                return f"it does not pin the units of {name}"
        if set(units) - set(series):
            return f"it pins units for {min(set(units) - set(series))}, which it does not ask for"
        size = params.get("page_size", self.PAGE_SIZE)
        if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= self.PAGE_SIZE:
            return f"its page_size is not between 1 and {self.PAGE_SIZE}"
        return None

    def _url(self, scope: dict, offset: int) -> str:
        query = [("frequency", scope["frequency"]), ("data[0]", scope["column"]),
                 *((f"facets[{scope['facet']}][]", name) for name in scope["series"]),
                 *((f"facets[{name}][]", value) for name, value in sorted(scope["facets"].items())),
                 ("sort[0][column]", "period"), ("sort[0][direction]", "asc"),
                 ("sort[1][column]", scope["facet"]), ("sort[1][direction]", "asc"),
                 ("offset", offset), ("length", scope["page_size"])]
        return f"{self.BASE}/{scope['route']}/data/?{urlencode(query)}"

    @staticmethod
    def _load(body: bytes) -> object:
        """The answer, with every number kept as the characters it was printed in."""
        try:
            return json.loads(body.decode("utf-8"), parse_float=str, parse_int=str)
        except (UnicodeDecodeError, ValueError):
            return None

    def _total(self, body: bytes) -> int:
        answer = self._load(body)
        response = answer.get("response") if isinstance(answer, dict) else None
        total = response.get("total") if isinstance(response, dict) else None
        return int(total) if isinstance(total, str) and total.isascii() and total.isdigit() else 0

    def fetch(self, endpoint: Endpoint, fetch: Fetch) -> Evidence:
        params = endpoint.params
        scope = {"route": params["route"], "frequency": params["frequency"],
                 "column": params.get("column", "value"), "facet": params.get("facet", "series"),
                 "series": list(params["series"]), "facets": dict(params.get("facets", {})),
                 "units": {name: params["units"][name] for name in params["series"]},
                 "page_size": params.get("page_size", self.PAGE_SIZE),
                 "asked_on": fetch.now().astimezone(RELEASE_ZONE).date().isoformat()}
        bodies = [fetch.get(self._url(scope, 0), key=self.KEY).body]
        total = self._total(bodies[0])
        while len(bodies) * scope["page_size"] < total and len(bodies) < self.MAX_PAGES:
            bodies.append(fetch.get(self._url(scope, len(bodies) * scope["page_size"]), key=self.KEY).body)
        return self.examine(scope, bodies)

    def _period(self, frequency: str, time: object) -> tuple[str, str] | None:
        """A row's period as (the Period's label, the day it is dated or begins), or None."""
        from ..period import period_bounds

        if not isinstance(time, str) or not time.isascii():
            return None
        if frequency == "weekly":
            if not _is_day(time):
                return None
            iso = date.fromisoformat(time).isocalendar()
            return f"{iso[0]:04d}-W{iso[1]:02d}", time
        bounds = period_bounds(frequency, time)
        return (time, bounds[0]) if bounds else None

    def _read(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], dict]:
        facet, column, kind = scope["facet"], scope["column"], self.FREQUENCIES[scope["frequency"]]
        units_field = "units" if column == "value" else f"{column}-units"
        command = f"/v2/{scope['route']}/data/"
        totals: set[int] = set()
        rows: list[dict] = []
        for number, body in enumerate(bodies, start=1):
            where = f"page {number}: " if len(bodies) > 1 else ""
            answer = self._load(body)
            if not isinstance(answer, dict):
                problems.append(f"{where}the answer is not JSON" if answer is None
                                else f"{where}the answer is not a JSON object")
                continue
            error = answer.get("error")
            if error is not None:
                words = [error.get("code"), error.get("message")] if isinstance(error, dict) else [error]
                problems.append(f"{where}EIA says: " + " ".join(str(w) for w in words if w))
                continue
            warnings = answer.get("warnings") or []
            for warning in warnings if isinstance(warnings, list) else [warnings]:
                words = [warning.get("warning"), warning.get("description")] if isinstance(warning, dict) else [warning]
                problems.append(f"{where}EIA warns: " + " ".join(str(w) for w in words if w))
            response, request = answer.get("response"), answer.get("request")
            data = response.get("data") if isinstance(response, dict) else None
            total = response.get("total") if isinstance(response, dict) else None
            if not isinstance(data, list) or not (isinstance(total, str) and total.isascii() and total.isdigit()):
                problems.append(f"{where}the answer has no data and total")
                continue
            totals.add(int(total))
            said = request.get("command") if isinstance(request, dict) else None
            if said != command:
                problems.append(f"{where}the answer says it is {said}, not {command}")
            if response.get("frequency") != scope["frequency"]:
                problems.append(f"{where}the answer is {response.get('frequency')}, not {scope['frequency']}")
            asked = request.get("params") if isinstance(request, dict) and isinstance(request.get("params"), dict) else {}
            offset = (number - 1) * scope["page_size"]
            if "offset" in asked and str(asked["offset"]) != str(offset):
                problems.append(f"{where}the answer begins at row {asked['offset']}, not {offset}")
            if number < len(bodies) and len(data) != scope["page_size"]:
                problems.append(f"{where}the page has {len(data)} rows, not {scope['page_size']}, and is not the last")
            rows.extend(data)
        if len(totals) > 1:
            problems.append("the pages do not agree on the total; the data changed while it was read")
        elif totals and next(iter(totals)) != len(rows):
            problems.append(f"the answer says there are {next(iter(totals))} rows and {len(rows)} were read")
        checks: dict = {"total": next(iter(totals)) if len(totals) == 1 else None, "pages": len(bodies)}
        if not rows and not problems:
            problems.append("the answer has no rows")
        found: dict[str, list[tuple[str, dict]]] = {}
        seen: dict[str, set[str]] = {}
        before: tuple[str, str] | None = None
        for row in rows:
            name = row.get(facet) if isinstance(row, dict) else None
            time = row.get("period") if isinstance(row, dict) else None
            if not isinstance(name, str) or not isinstance(time, str):
                problems.append(f"the answer has a row without its period and its {facet}")
                continue
            if before is not None and (time, name) <= before:
                problems.append(f"the rows are not in order of period and {facet}, or one is repeated, at {time} {name}")
            before = (time, name)
            if name not in scope["series"]:
                problems.append(f"{name} was not asked for")
                continue
            period = self._period(scope["frequency"], time)
            if period is None:
                problems.append(f"{name} has a time that is not a {kind}: {time!r}")
                continue
            label, day = period
            for other, value in scope["facets"].items():
                if row.get(other) != value:
                    problems.append(f"a row for {name} in {label} has {other} {row.get(other)!r}, not {value!r}")
            if label in seen.setdefault(name, set()):
                problems.append(f"{name} gives {label} twice")
                continue
            seen[name].add(label)
            if row.get(units_field) != scope["units"][name]:
                problems.append(f"{name} is in {row.get(units_field)!r} for {label}; "
                                f"{scope['units'][name]!r} was expected")
            value = row.get(column)
            if value is None:
                found.setdefault(name, []).append(
                    (day, {"period": label, "value": None, "status": "unavailable", "footnotes": []}))
                continue
            if isinstance(value, str) and value.isascii() and self._BARE.fullmatch(value):
                # The Administration prints some figures under one without a zero (".995").
                # The zero is put before the point, and that is the only change made.
                value = value.replace(".", "0.", 1)
            if not (isinstance(value, str) and _is_number(value)):
                problems.append(f"{name} has a value that is not a number or null for {label}: {value!r}")
                continue
            if day > scope["asked_on"]:
                problems.append(f"{name} has a value for {label}, a Period that had not begun on {scope['asked_on']}")
            found.setdefault(name, []).append(
                (day, {"period": label, "value": value, "status": "observed", "footnotes": []}))
        series: dict[str, list[dict]] = {}
        for name in scope["series"]:
            listed = sorted(found.get(name, []), key=lambda pair: pair[0])
            if name not in found:
                if rows:
                    problems.append(f"{name} is not in the answer")
                continue
            if not any(row["value"] is not None for _, row in listed):
                problems.append(f"{name} is in the answer without a single number")
            series[name] = [row for _, row in listed]
            checks.setdefault("series", {})[name] = {"rows": len(listed), "first": listed[0][1]["period"],
                                                     "last": listed[-1][1]["period"]}
        return series, checks

    def examine(self, scope: dict, bodies: list[bytes]) -> Evidence:
        problems: list[str] = []
        _, checks = self._read(scope, bodies, problems)
        return _evidence(scope, checks, list(dict.fromkeys(problems)))

    def coverage(self, scope: dict) -> tuple[None, None]:
        """Every Period is asked for, every time: one that has left the data is gone."""
        return None, None

    def parse(self, capture: RawCapture) -> NormalizedState:
        problems: list[str] = []
        series, _ = self._read(capture.evidence.scope, capture.bodies, problems)
        problems = list(dict.fromkeys(problems))
        return NormalizedState(not problems, capture.evidence.scope, series if not problems else {}, problems)


def _month_after(day: str) -> str | None:
    """The month (YYYY-MM) of the day after ``day``; None after the calendar's last day."""
    try:
        return (date.fromisoformat(day) + timedelta(days=1)).isoformat()[:7]
    except OverflowError:
        return None


def _is_day(text: str) -> bool:
    try:
        return len(text) == 10 and date.fromisoformat(text).isoformat() == text
    except ValueError:
        return False


ADAPTERS = {adapter.name: adapter for adapter in
            (FixtureAdapter(), BlsAdapter(), TreasuryFiscalDataAdapter(), FedBoardAdapter(),
             ImfSdmxAdapter(), BeaAdapter(), EiaAdapter())}


def key_of(endpoint: Endpoint) -> tuple[str, str] | None:
    """(query parameter, name of the key) when the endpoint's source wants an API key, else
    None. The name is that of an environment variable; the key is never in the register."""
    wants = getattr(ADAPTERS[endpoint.adapter], "key", None)
    return wants(endpoint.params) if wants else None


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
