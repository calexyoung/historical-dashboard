"""Writes the capture kit's committed fixtures: one recorded exchange for every endpoint the
rights register lists (BLS, Treasury Fiscal Data, the Federal Reserve Board).

Every value in them is invented. The *shape* of each answer (field names, header rows, the way
BLS prints an unpublished month or a quarter, the paging block of Fiscal Data, the statements
of the Monthly Treasury Statement, the Board's label rows, time cells and "ND") was copied from
the answers the three sources gave on 2026-11-11; none of their numbers was. The repository is
public and no row of the rights register is signed, so real agency bytes may not be committed
yet (PLAN 6.1; fixtures/README.md). When Alex has signed a row, a real capture replaces the
invented one: see "Real captures" in fixtures/capture/README.md.

The requests are not written by hand: each endpoint is taken from schema/rights-register.json
and fetched by its real adapter from a transport that answers each request with invented bytes
of the shape that request would get, so a fixture always matches what the adapter asks today.

    python fixtures/capture/make_fixtures.py        # rewrite fixtures/capture/
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from atlas.capture.adapters import capture
from atlas.capture.http import Fetch, Response, Session
from atlas.capture.replay import write_exchange
from atlas.capture.run import endpoints_from_register
from atlas.capture.store import stamp
from atlas.catalog import load_catalog
from atlas.rights import load_register

RECORDED_AT = datetime(2026, 11, 11, 15, 50, 0, tzinfo=UTC)
NOTE = ("Invented values in the shape of the source's answer of 2026-11-11. Not a measurement "
        "of anything and not a capture: written by fixtures/capture/make_fixtures.py.")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


QUARTERLY = ("PRS85006173", "LES1252881600")
#: Invented levels and steps, by series: value = level + step * (months since January 1997).
BLS_SHAPE = {
    "CUUR0000SA0": (100, 0.25, 3), "CUSR0000SA0": (100, 0.2, 3), "CES0000000001": (100000, 150, 0),
    "CUSR0000SA0L1E": (110, 0.15, 3), "CUSR0000SEHA": (120, 0.3, 3), "CES0500000008": (10, 0.05, 2),
    "APU0000708111": (1, 0.004, 3), "PRS85006173": (110, -0.03, 3), "LES1252881600": (330, 0.1, 0),
}
LAST = (2026, 10)  # the newest month the invented Bureau has published


def bls_body(series: list[str], first: int, last: int) -> bytes:
    """One answer of the API for these series and years, newest first, as BLS lists them."""
    gap = "Data unavailable due to the 2025 lapse in appropriations"

    def rows(series_id):
        quarterly = series_id in QUARTERLY
        months = [(year, month) for year in range(last, first - 1, -1) for month in range(12, 0, -1)
                  if (year, month) <= LAST and (not quarterly or month % 3 == 0)]
        out = []
        for index, (year, month) in enumerate(months):
            age = (year - 1997) * 12 + month - 1
            code = f"Q{month // 3:02d}" if quarterly else f"M{month:02d}"
            name = f"{month // 3}{('st', 'nd', 'rd', 'th')[month // 3 - 1]} Quarter" if quarterly else MONTHS[month - 1]
            row = {"year": str(year), "period": code, "periodName": name}
            if index == 0 and last == LAST[0]:
                row["latest"] = "true"
            newest = last == LAST[0]
            if series_id in ("LNS14000000", "LNS11300000"):
                value = f"{(5 if series_id == 'LNS14000000' else 62) + (age * 7 % 11) / 10:.1f}"
            else:
                level, step, places = BLS_SHAPE[series_id]
                value = f"{level + age * step:.{places}f}"
            if (year, month) == (2025, 10) and series_id not in ("CES0000000001", "CES0500000008", "PRS85006173"):
                # The month the Bureau did not publish, with the footnote each survey gives it.
                cps = series_id.startswith("LNS")
                row["value"] = "-"
                row["footnotes"] = [{"code": "9" if cps else "X", "text": gap + ("." if cps else "")}]
            elif (year, month) == (2025, 12) and series_id == "LES1252881600":
                row["value"] = "-"
                row["footnotes"] = [{"code": "10", "text": "Data for Q4 2025 were not produced."}]
            elif newest and index < 2 and series_id.startswith("CES"):
                row["value"], row["footnotes"] = value, [{"code": "P", "text": "preliminary"}]
            elif newest and 1 <= index <= 2 and series_id == "PRS85006173":
                row["value"], row["footnotes"] = value, [{"code": "R", "text": "revised"}]
            else:
                row["value"], row["footnotes"] = value, [{}]
            out.append(row)
        return {"seriesID": series_id, "data": out}

    compact = json.dumps([rows(series_id) for series_id in series], separators=(",", ":"))
    return ('{"status":"REQUEST_SUCCEEDED","responseTime":62,"message":[],"Results":{\n'
            f'"series":\n{compact}\n}}}}').encode()


def treasury_body() -> bytes:
    fields = {
        "record_date": ("Record Date", "DATE", "YYYY-MM-DD"),
        "debt_held_public_amt": ("Debt Held by the Public", "CURRENCY", "$10.20"),
        "intragov_hold_amt": ("Intragovernmental Holdings", "CURRENCY", "$10.20"),
        "tot_pub_debt_out_amt": ("Total Public Debt Outstanding", "CURRENCY", "$10.20"),
        "src_line_nbr": ("Source Line Number", "INTEGER", "10"),
        "record_fiscal_year": ("Fiscal Year", "YEAR", "YYYY"),
        "record_fiscal_quarter": ("Fiscal Quarter Number", "QUARTER", "Q"),
        "record_calendar_year": ("Calendar Year", "YEAR", "YYYY"),
        "record_calendar_quarter": ("Calendar Quarter Number", "QUARTER", "Q"),
        "record_calendar_month": ("Calendar Month Number", "MONTH", "MM"),
        "record_calendar_day": ("Calendar Day Number", "DAY", "DD"),
    }
    rows, day = [], date(2026, 9, 28)
    while len(rows) < 30:
        if day.isoweekday() <= 5:
            n = len(rows)
            public, intragov = 1_000_000_000 + n * 1_000_000.25, 500_000_000 + n * 250_000.5
            fiscal_year = day.year + (day.month >= 10)
            rows.append({
                "record_date": day.isoformat(),
                "debt_held_public_amt": f"{public:.2f}",
                "intragov_hold_amt": f"{intragov:.2f}",
                "tot_pub_debt_out_amt": f"{public + intragov:.2f}",
                "src_line_nbr": "1",
                "record_fiscal_year": str(fiscal_year),
                "record_fiscal_quarter": str((day.month - 10) % 12 // 3 + 1),
                "record_calendar_year": str(day.year),
                "record_calendar_quarter": str((day.month - 1) // 3 + 1),
                "record_calendar_month": f"{day.month:02d}",
                "record_calendar_day": f"{day.day:02d}",
            })
        day += timedelta(days=1)
    page = "&page%5Bnumber%5D=1&page%5Bsize%5D=10000"
    answer = {
        "data": rows,
        "meta": {"count": len(rows), "labels": {k: v[0] for k, v in fields.items()},
                 "dataTypes": {k: v[1] for k, v in fields.items()},
                 "dataFormats": {k: v[2] for k, v in fields.items()},
                 "total-count": len(rows), "total-pages": 1},
        "links": {"self": page, "first": page, "prev": None, "next": None, "last": page},
    }
    return json.dumps(answer, separators=(",", ":")).encode()


def mts_body() -> bytes:
    """Table 1 of the Monthly Treasury Statement: four statements, each listing the months of
    the last fiscal year and of this one. The August statement revises July's outlays."""
    month_names = MONTHS
    rows, ident = [], 59_000_000

    def amount(year, month, kind, revised=False):
        base = 300_000_000 + ((year * 12 + month) % 17) * 10_000_000.25 + (150_000_000 if kind else 0)
        return f"{base + (1234.5 if revised else 0):.2f}"

    for statement in (date(2026, 6, 30), date(2026, 7, 31), date(2026, 8, 31), date(2026, 9, 30)):
        line = 0
        for fiscal in (2025, 2026):
            ident += 4
            header = ident
            line += 1
            rows.append((statement, line, "SL", "S", "null", header, f"FY {fiscal}", "null", "null", "null"))
            totals = [0.0, 0.0]
            for offset in range(12):
                month = (9 + offset) % 12 + 1
                year = fiscal - 1 if month >= 10 else fiscal
                if (year, month) > (statement.year, statement.month):
                    break
                revised = (year, month) == (2026, 7) and statement.month >= 8
                receipts, outlays = amount(year, month, 0), amount(year, month, 1, revised)
                totals[0] += float(receipts)
                totals[1] += float(outlays)
                ident += 3
                line += 1
                rows.append((statement, line, "MTH", "D", str(header), ident, month_names[month - 1],
                             receipts, outlays, f"{float(outlays) - float(receipts):.2f}"))
            ident += 3
            line += 1
            rows.append((statement, line, "SL", "T", str(header), ident, "Year-to-Date",
                         f"{totals[0]:.2f}", f"{totals[1]:.2f}", f"{totals[1] - totals[0]:.2f}"))
    data = [{
        "record_date": day.isoformat(), "parent_id": parent, "classification_id": str(ident),
        "classification_desc": desc, "current_month_gross_rcpt_amt": receipts,
        "current_month_gross_outly_amt": outlays, "current_month_dfct_sur_amt": deficit,
        "table_nbr": "1", "src_line_nbr": str(line), "print_order_nbr": str(line),
        "line_code_nbr": str(line * 10), "data_type_cd": data_type, "record_type_cd": kind,
        "sequence_level_nbr": "1" if parent == "null" else "2", "sequence_number_cd": str(line),
        "record_fiscal_year": str(day.year + (day.month >= 10)),
        "record_fiscal_quarter": str((day.month - 10) % 12 // 3 + 1),
        "record_calendar_year": str(day.year), "record_calendar_quarter": str((day.month - 1) // 3 + 1),
        "record_calendar_month": f"{day.month:02d}", "record_calendar_day": f"{day.day:02d}",
    } for day, line, kind, data_type, parent, ident, desc, receipts, outlays, deficit in rows]
    page = "&page%5Bnumber%5D=1&page%5Bsize%5D=10000"
    answer = {"data": data,
              "meta": {"count": len(data), "labels": {"record_date": "Record Date"},
                       "dataTypes": {"record_date": "DATE"}, "dataFormats": {"record_date": "YYYY-MM-DD"},
                       "total-count": len(data), "total-pages": 1},
              "links": {"self": page, "first": page, "prev": None, "next": None, "last": page}}
    return json.dumps(answer, separators=(",", ":")).encode()


def fed_body(params: dict, span: tuple[date, date] | None, ranges: dict[str, list]) -> bytes:
    """One file of the Data Download Program for an endpoint's package: the six label rows as
    the Board writes them, then invented rows in the file's own kind of time cell. A column a
    Series with a declared range is read from stays inside that range, as the release writer
    will require of it."""
    expect, rel, kind = params["expect"], params["rel"], params.get("period", "day")
    labels = params.get("labels", {})

    def line(label, cells):
        return ",".join(f'"{cell}"' for cell in [label, *cells])

    def said(field, default):
        return [labels.get(name, {}).get(field, default) for name in expect]

    lines = [
        line("Series Description", [f"Invented series {n + 1}, not a measurement" for n in range(len(expect))]),
        line("Unit:", said("unit", "Percent:_Per_Year")),
        line("Multiplier:", said("multiplier", "1")),
        line("Currency:", said("currency", "NA")),
        line("Unique Identifier: ", [f"{rel}/{rel}/{name}" for name in expect]),
        line("Time Period", expect),
    ]

    def cells(n, code=None):
        # The first column of a package begins late: the Board leaves the cell empty before a
        # series begins. One day (or its like) is listed with no number.
        out = [code or f"{1 + column * 0.1 + n * 0.01:.2f}" for column in range(len(expect))]
        for name, (low, high) in ranges.items():
            if not code:
                out[expect.index(name)] = f"{low + (high - low) * (0.4 + 0.001 * n):.4f}"
        if n < 2 and len(expect) > 1 and (span is None or span[0].year == params["from_years"][0]):
            out[-1] = ""
        return out

    times: list[str] = []
    if kind == "day":
        def business_days(start: date, count: int, step: int) -> list[str]:
            found, day = [], start
            while len(found) < count:
                if day.isoweekday() <= 5:
                    found.append(day.isoformat())
                day += timedelta(days=step)
            return found

        newest = date(2026, 11, 6)
        if span is None:
            times = business_days(date(2026, 10, 5), 25, 1)
        else:
            # A span is answered from its first business days to its last, or to the newest
            # day the invented Board has published.
            times = sorted({*business_days(span[0], 5, 1), *business_days(min(span[1], newest), 22, -1)})
    elif kind == "week":
        times = [(date(2026, 8, 19) + timedelta(weeks=n)).isoformat() for n in range(12)]
    elif kind == "month":
        times = [f"{2024 + (n + 9) // 12}-{(n + 9) % 12 + 1:02d}" for n in range(25)]  # 2024-10 to 2026-10
    else:
        times = [f"{2021 + (n + 2) // 4}Q{(n + 2) % 4 + 1}" for n in range(20)]  # 2021Q3 to 2026Q2
    for n, time in enumerate(times):
        holiday = kind == "day" and time in ("2026-10-12", "1971-01-01", "1990-01-01", "2010-01-01")
        lines.append(",".join([time, *cells(n, "ND" if holiday else None)]))
    return ("\n".join(lines) + "\n").encode()


class Synthetic:
    """Answers each request of a real adapter with invented bytes of the shape that request
    would get, and remembers nothing else."""

    kind = "synthetic"
    real = False

    def __init__(self, endpoints):
        self._endpoints = endpoints
        self._clock = RECORDED_AT

    def now(self):
        return RECORDED_AT

    def _answer(self, request) -> tuple[str, bytes]:
        url = urlsplit(request.url)
        query = parse_qs(url.query, keep_blank_values=True)
        if url.netloc == "api.bls.gov":
            asked = json.loads(request.body)
            return "application/json", bls_body(asked["seriesid"], int(asked["startyear"]), int(asked["endyear"]))
        if url.netloc == "api.fiscaldata.treasury.gov":
            return "application/json", mts_body() if url.path.endswith("mts_table_1") else treasury_body()
        endpoint = next(e for e in self._endpoints if e.adapter == "fed_board"
                        and e.params["rel"] == query["rel"][0] and e.params["series"] == query["series"][0])
        params = endpoint.params
        ranges = {entry["source"]["origin"]["origin_id"]: entry["range"]
                  for entry in load_catalog().values()
                  if (entry.get("source", {}).get("channel") or {}).get("endpoint") == endpoint.id
                  and "range" in entry}
        span = None
        if query["from"][0]:
            span = tuple(datetime.strptime(query[name][0], "%m/%d/%Y").date() for name in ("from", "to"))
        return "text/csv", fed_body(params, span, ranges)

    def send(self, request):
        kind, body = self._answer(request)
        self._clock += timedelta(seconds=1)
        date_header = self._clock.strftime("%a, %d %b %Y %H:%M:%S GMT")
        headers = [["Content-Type", kind], ["Date", date_header], ["Content-Length", str(len(body))],
                   ["Set-Cookie", "(not kept)"]]
        return Response(200, headers, body, self._clock)


def build(out: Path) -> list[str]:
    endpoints = endpoints_from_register(load_register())
    written = []
    transport = Synthetic(endpoints)
    for endpoint in endpoints:
        raw = capture(endpoint, Fetch(Session(transport, sleep=lambda seconds: None)))
        assert raw.evidence.complete, (endpoint.id, raw.evidence.problems)
        parts = [{"request": {"method": p.request.method, "url": p.request.url,
                              "body": None if p.request.body is None else p.request.body.decode()},
                  "status": p.response.status, "headers": p.response.headers,
                  "received_at": stamp(p.response.received_at), "body": p.response.body}
                 for p in raw.parts]
        write_exchange(out, endpoint.source, endpoint.id, parts, recorded_at=RECORDED_AT,
                       provenance={"synthetic": True, "transport": transport.kind,
                                   "origin": endpoint.origin, "datasets": list(endpoint.datasets),
                                   "retrieved_at": stamp(raw.retrieved_at), "capture_id": None,
                                   "note": NOTE})
        written.append(endpoint.id)
    return written


if __name__ == "__main__":
    for name in build(Path(__file__).resolve().parent):
        print("wrote", name)
