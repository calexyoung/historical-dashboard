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
from datetime import date, datetime, timedelta
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
        """The years of each request, oldest first: ten at a time, the last ending the window."""
        first, last = scope["start_year"], scope["end_year"]
        return [(start, min(start + self.REQUEST_YEARS - 1, last))
                for start in range(first, last + 1, self.REQUEST_YEARS)]

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

    def _read(self, scope: dict, bodies: list[bytes], problems: list[str]) -> tuple[dict[str, list[dict]], dict[str, int]]:
        """Each series' Observations over every part, in order, and how many rows it had."""
        requests = self._requests(scope)
        if len(bodies) != len(requests):
            problems.append(f"{len(requests)} parts were asked for and {len(bodies)} were kept")
        series: dict[str, list[dict]] = {}
        counts: dict[str, int] = {}
        for number, (body, (first, last)) in enumerate(zip(bodies, requests, strict=False), start=1):
            said: list[str] = []
            for name, rows in self._rows(scope, [body], said).items():
                counts[name] = counts.get(name, 0) + len(rows)
                series.setdefault(name, []).extend(self._observations(
                    name, rows, {"start_year": first, "end_year": last}, said))
            prefix = f"part {number}: " if len(requests) > 1 else ""
            problems.extend(prefix + problem for problem in said)
        for name, observations in series.items():
            observations.sort(key=lambda o: o["period"])
            if len({"Q" in o["period"] for o in observations}) > 1:
                problems.append(f"series {name} gives both months and quarters")
        return series, counts

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
        return found

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
        series, counts = self._read(scope, bodies, problems)
        checks = {name: {"rows": counts[name],
                         "first": observations[0]["period"] if observations else None,
                         "last": observations[-1]["period"] if observations else None}
                  for name, observations in series.items()}
        return _evidence(scope, {"series": checks}, problems)

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
            return self._mts(scope["series"], rows, problems)
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
        return series, {}

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

    ``labels`` holds what the Board's label rows say of a series (unit, multiplier, currency).
    A label that changes makes the capture incomplete: the figures would mean something else."""

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
        for name, column in columns.items():
            filled = [i for i, (_, _, cell) in enumerate(column) if cell != ""]
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


def _month_after(day: str) -> str:
    """The month (YYYY-MM) of the day after ``day``."""
    return (date.fromisoformat(day) + timedelta(days=1)).isoformat()[:7]


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
