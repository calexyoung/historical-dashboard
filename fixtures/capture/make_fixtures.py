"""Writes the capture kit's committed fixtures: one recorded exchange for one endpoint of each of
the first three sources (BLS, Treasury Fiscal Data, the Federal Reserve Board).

Every value in them is invented. The *shape* of each answer (field names, header rows, the way
BLS prints an unpublished month, the paging block of Fiscal Data) was copied from the answers
the three sources gave on 2026-11-11; none of their numbers was. The repository is public and
no row of the rights register is signed, so real agency bytes may not be committed yet
(PLAN 6.1; fixtures/README.md). When Alex has signed a row, a real capture replaces the
invented one: see "Real captures" in fixtures/capture/README.md.

The requests are not written by hand: each endpoint is taken from schema/rights-register.json
and fetched by its real adapter from a transport that serves the invented bytes, so a fixture
always matches what the adapter asks for today.

    python fixtures/capture/make_fixtures.py        # rewrite fixtures/capture/
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from atlas.capture.adapters import capture
from atlas.capture.http import Fetch, Response, Session
from atlas.capture.replay import write_exchange
from atlas.capture.run import endpoints_from_register
from atlas.capture.store import stamp
from atlas.rights import load_register

RECORDED_AT = datetime(2026, 11, 11, 15, 50, 0, tzinfo=UTC)
NOTE = ("Invented values in the shape of the source's answer of 2026-11-11. Not a measurement "
        "of anything and not a capture: written by fixtures/capture/make_fixtures.py.")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


def _months():
    """2026-10 back to 2017-01, newest first, as BLS lists them."""
    return [(year, month) for year in range(2026, 2016, -1) for month in range(12, 0, -1)
            if (year, month) <= (2026, 10)]


def bls_body() -> bytes:
    def series(series_id, value, *, gap_code=None, gap_text=None, preliminary=0):
        rows = []
        months = _months()
        for index, (year, month) in enumerate(months):
            age = len(months) - 1 - index  # 0 for the oldest month
            row = {"year": str(year), "period": f"M{month:02d}", "periodName": MONTHS[month - 1]}
            if index == 0:
                row["latest"] = "true"
            if gap_code and (year, month) == (2025, 10):
                row["value"] = "-"
                row["footnotes"] = [{"code": gap_code, "text": gap_text}]
            else:
                row["value"] = value(age)
                row["footnotes"] = [{"code": "P", "text": "preliminary"}] if index < preliminary else [{}]
            rows.append(row)
        return {"seriesID": series_id, "data": rows}

    gap = "Data unavailable due to the 2025 lapse in appropriations"
    listed = [
        series("CUUR0000SA0", lambda age: f"{100 + age * 0.25:.3f}", gap_code="X", gap_text=gap),
        series("CUSR0000SA0", lambda age: f"{100 + age * 0.2:.3f}", gap_code="X", gap_text=gap),
        series("LNS14000000", lambda age: f"{5 + (age * 7 % 11) / 10:.1f}", gap_code="9", gap_text=gap + "."),
        series("CES0000000001", lambda age: str(100000 + age * 150), preliminary=2),
    ]
    compact = json.dumps(listed, separators=(",", ":"))
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


def fed_body(expect: list[str]) -> bytes:
    def line(label, cells):
        return ",".join(f'"{cell}"' for cell in [label, *cells])

    lines = [
        line("Series Description", [f"Invented yield series {n + 1}, not a market rate" for n in range(len(expect))]),
        line("Unit:", ["Percent:_Per_Year"] * len(expect)),
        line("Multiplier:", ["1"] * len(expect)),
        line("Currency:", ["NA"] * len(expect)),
        line("Unique Identifier: ", [f"H15/H15/{name}" for name in expect]),
        line("Time Period", expect),
    ]
    day, written = date(2026, 10, 5), 0
    while written < 25:
        if day.isoweekday() <= 5:
            if day == date(2026, 10, 12):  # the Board prints ND on a day with no data
                cells = ["ND"] * len(expect)
            else:
                cells = [f"{1 + column * 0.1 + written * 0.01:.2f}" for column in range(len(expect))]
            lines.append(",".join([day.isoformat(), *cells]))
            written += 1
        day += timedelta(days=1)
    return ("\n".join(lines) + "\n").encode()


class Synthetic:
    """Serves the invented bodies to the real adapters, and remembers what was asked."""

    kind = "synthetic"

    def __init__(self, bodies: dict[str, tuple[str, bytes]]):
        self._bodies = bodies
        self._clock = RECORDED_AT

    def now(self):
        return RECORDED_AT

    def send(self, request):
        kind, body = next(v for host, v in self._bodies.items() if host in request.url)
        self._clock += timedelta(seconds=1)
        date_header = self._clock.strftime("%a, %d %b %Y %H:%M:%S GMT")
        headers = [["Content-Type", kind], ["Date", date_header], ["Content-Length", str(len(body))],
                   ["Set-Cookie", "(not kept)"]]
        return Response(200, headers, body, self._clock)


def build(out: Path) -> list[str]:
    endpoints = endpoints_from_register(load_register())
    fed = next(e for e in endpoints if e.adapter == "fed_board")
    transport = Synthetic({
        "api.bls.gov": ("application/json", bls_body()),
        "api.fiscaldata.treasury.gov": ("application/json", treasury_body()),
        "www.federalreserve.gov": ("text/csv", fed_body(fed.params["expect"])),
    })
    session = Session(transport, sleep=lambda seconds: None)
    written = []
    for endpoint in endpoints:
        raw = capture(endpoint, Fetch(session))
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
