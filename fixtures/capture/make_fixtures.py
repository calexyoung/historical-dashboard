"""Writes the capture kit's committed fixtures: one recorded exchange for every endpoint the
rights register lists (BLS, Treasury Fiscal Data, the Federal Reserve Board, the IMF, the BEA,
the EIA, the Census Bureau).

Every value in them is invented. The *shape* of each answer (field names, header rows, the way
BLS prints an unpublished month or a quarter, the paging block of Fiscal Data, the statements
of the Monthly Treasury Statement, the Board's label rows, time cells and "ND", the IMF's
SDMX-JSON with its positions and unordered times, the BEA's echo of what it was asked and its
commas, the EIA's nulls and its prices printed without a leading zero, the Census Bureau's
flat file with its tables of codes and its workbook with its marks) was copied from the
answers the seven sources gave on 2026-11-11; none of their numbers was. The two sources that
want a key are asked without one here, as a replay asks them: no key was used to make these
files and none is in them (where the BEA would repeat it, the file says REDACTED). The repository is
public and no row of the rights register is signed, so real agency bytes may not be committed
yet (PLAN 6.1; fixtures/README.md). When Alex has signed a row, a real capture replaces the
invented one: see "Real captures" in fixtures/capture/README.md.

The requests are not written by hand: each endpoint is taken from schema/rights-register.json
and fetched by its real adapter from a transport that answers each request with invented bytes
of the shape that request would get, so a fixture always matches what the adapter asks today.

    python fixtures/capture/make_fixtures.py        # rewrite fixtures/capture/
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from xml.sax.saxutils import escape

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


def imf_body(params: dict, ranges: dict[str, list]) -> bytes:
    """One answer of the IMF's SDMX 3.0 data API for an endpoint's series, as SDMX-JSON 2.0 with
    the time on the observation: series keyed by position in each dimension's list, attributes
    as positions in theirs, and the times in the order the series first mention them, which is
    no order at all. What the real answers of 2026-11-11 showed is here in small: a series
    listed with nulls before it begins (Japan), a month that is not listed (the United States,
    October 2025), a series that begins late (Australia), series that end at different months,
    the mark T at a change of regime, and a rate printed in today's unit from before a
    redenomination, with as many decimals as the Fund prints."""
    flow, series = params["flow"], params["series"]
    cpi = flow == "CPI"
    names = (("COUNTRY", "INDEX_TYPE", "COICOP_1999", "TYPE_OF_TRANSFORMATION", "FREQUENCY") if cpi
             else ("COUNTRY", "INDICATOR", "TYPE_OF_TRANSFORMATION", "FREQUENCY"))
    months = [f"{2023 + (n + 9) // 12}-M{(n + 9) % 12 + 1:02d}" for n in range(37)]  # 2023-M10 to 2026-M10
    values = [list(dict.fromkeys(key.split(".")[position] for key in series)) for position in range(len(names))]
    times: list[str] = []
    out = {}
    for number, key in enumerate(series):
        country = key.split(".")[0]
        high = ranges.get(key, [0.0, 300.0])[1]
        rows = {}
        for n, month in enumerate(months):
            # Newest first for every other series: the Fund's lists are in no order.
            if month < "2024-M01":
                if country != "JPN":
                    continue
                value = None  # listed, with no number, before the series begins
            elif (country, month) == ("USA", "2025-M10") or (country == "AUS" and month < "2024-M04") \
                    or month > ("2026-M07", "2026-M09", "2026-M10")[number % 3]:
                continue
            elif cpi:
                value = f"{90 + number * 1.5 + n * 0.25:.{(1, 2, 13)[number % 3]}f}"
            elif country == "BRA" and month < "2024-M04":
                value = f"0.0000000000010{n:02d}00000000123"  # before the invented redenomination
            else:
                value = f"{high * (0.2 + 0.001 * n):.{(4, 10, 13)[number % 3]}f}".rstrip("0").rstrip(".")
            mark = "T" if not cpi and (country, month) in (("BRA", "2024-M04"), ("CHN", "2025-M01")) else None
            rows[month] = [value, None, 0, params["reference"][key], None] if cpi else [value, None, 0, mark]
        ordered = list(rows) if number % 2 else list(reversed(rows))
        for month in ordered:
            if month not in times:
                times.append(month)
        index = ":".join(str(values[position].index(part)) for position, part in enumerate(key.split(".")))
        attributes = [0, None, 0, params["reference"][key], "true"] if cpi else [0, None, 0, "true"]
        out[index] = {"attributes": attributes,
                      "observations": {str(times.index(month)): rows[month] for month in ordered}}

    def described(listed, related):
        return [{"id": name, "roles": [], "isMandatory": False, "relationship": related,
                 **({"values": [{"id": code}]} if code else {})} for name, code in listed]

    version = "5.0.0" if cpi else "4.0.1"
    structure = {
        "dataSets": [0],
        "links": [{"urn": f"urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow={params['agency']}:{flow}({version})",
                   "title": "Dataflow"},
                  {"urn": ("urn:sdmx:org.sdmx.infomodel.datastructure.DataStructure="
                           f"{params['agency']}:DSD_{flow}{'' if cpi else '_PUB'}({version[:-1]}0)"),
                   "title": "DataStructureDefinition"}],
        "dimensions": {
            "series": [{"id": name, "keyPosition": position, "roles": ["FREQ"] if name == "FREQUENCY" else [],
                        "values": [{"id": value} for value in values[position]]}
                       for position, name in enumerate(names)],
            "observation": [{"id": "TIME_PERIOD", "keyPosition": len(names),
                             "values": [{"value": time} for time in times]}]},
        "measures": {"observation": [{"id": "OBS_VALUE", "roles": []}]},
        "attributes": {
            "dimensionGroup": described([("TRANSFORMATION", None), ("UNIT", None)],
                                        {"dimensions": ["TYPE_OF_TRANSFORMATION"]}),
            "series": described([("SCALE", "0"), ("DECIMALS_DISPLAYED", None), ("OVERLAP", "OL"),
                                 *([("COMMON_REFERENCE_PERIOD", None)] if cpi else []), ("IFS_FLAG", None)],
                                {"dimensions": list(names)}),
            "observation": described([("PRECISION", None), ("DERIVATION_TYPE", "O" if cpi else "R"),
                                      *([("REFERENCE_PERIOD", None)] if cpi else []), ("STATUS", None)],
                                     {"observation": {}})},
        "annotations": [],
    }
    answer = {"meta": {}, "data": {"dataSets": [{"structure": 0, "action": "Replace", "series": out}],
                                   "structures": [structure]}}
    return json.dumps(answer, separators=(",", ":")).encode()


def bea_body(params: dict) -> bytes:
    """One answer of the BEA's API: a whole NIPA table or one indicator of the international
    accounts. What the real answers of 2026-11-11 showed is here in small: the request
    repeated in capitals with the key (here the word the capture kit leaves in its place),
    figures in millions with thousands commas, a code that sits on two lines, a line that is
    not read and holds no number, a line that ends a quarter before the others (profits), and
    a note that names the table, its unit and the day it was last revised."""
    frequency = params["frequency"]
    if params["read"] == "ita":
        (series,) = params["series"]
        pinned = params["labels"][series]
        quarters = [(year, quarter) for year in range(2018, 2027) for quarter in range(1, 5)
                    if (year, quarter) <= (2026, 2)]
        data = [{"Indicator": params["indicator"], "AreaOrCountry": params["area"], "Frequency": frequency,
                 "Year": str(year), "TimeSeriesId": series,
                 "TimeSeriesDescription": "Balance on goods and services; quarterly seasonally adjusted",
                 "TimePeriod": f"{year}Q{quarter}", "CL_UNIT": pinned["unit"], "UNIT_MULT": pinned["multiplier"],
                 "DataValue": str(-150000 - 1250 * index + (4000 if quarter == 1 else 0)), "NoteRef": "Q"}
                for index, (year, quarter) in enumerate(quarters)]
        asked = [("DATASETNAME", "ITA"), ("INDICATOR", params["indicator"].upper()),
                 ("AREAORCOUNTRY", params["area"].upper()), ("FREQUENCY", frequency), ("YEAR", "ALL")]
        results = {"TsLastUpdated": "2026-09-24 08:30:00.000",
                   "Dimensions": [{"Ordinal": str(n), "Name": name, "DataType": "string", "IsValue": "0"}
                                  for n, name in enumerate(("Indicator", "AreaOrCountry", "Frequency", "Year",
                                                            "TimeSeriesId", "TimeSeriesDescription", "TimePeriod",
                                                            "CL_UNIT", "UNIT_MULT", "DataValue"), start=1)],
                   "Data": data,
                   "Notes": {"NoteRef": "Q", "NoteText": "Quarterly estimates are not annualized and are "
                                                         "expressed at quarterly rates."}}
    else:
        table = params["table"]
        if frequency == "M":
            times = [f"{year}M{month:02d}" for year in range(2018, 2027) for month in range(1, 13)
                     if (year, month) <= (2026, 9)]
        else:
            times = [f"{year}Q{quarter}" for year in range(2018, 2027) for quarter in range(1, 5)
                     if (year, quarter) <= (2026, 3)]
        lines = []
        for position, series in enumerate(params["series"]):
            pinned = params["labels"][series]
            chained = "basis" in pinned
            name = "Total, Billions of chained (2017) dollars" if chained and table != "T10106" \
                else f"An invented line ({series})"
            own = times[:-1] if table == "T11200" else times  # profits come a release later
            lines.append((series, pinned["line"], name, pinned, own, position))
        first = lines[0]
        # The same code again further down the table, as the Bureau repeats a line in an
        # addendum; and a line nobody reads, with a mark where a number would be.
        lines.append((first[0], str(int(first[1]) + 100), first[2], first[3], first[4], first[5]))
        lines.append(("ZZ99RC", "200", "An invented line that is not read",
                      {"unit": "Level", "multiplier": "6", "metric": "Current Dollars"}, times[-2:], 9))
        data = []
        for series, line, name, pinned, own, position in sorted(lines, key=lambda item: int(item[1])):
            for index, time in enumerate(own):
                if series == "ZZ99RC":
                    value = "(D)"
                elif pinned["unit"] != "Level":  # a rate of change: small, sometimes below zero
                    value = f"{((index * 7 + position) % 13 - 3) / 2:.1f}"
                elif pinned["multiplier"] == "0":  # a ratio in percent
                    value = f"{4 + ((index * 5 + position) % 9) / 2:.1f}"
                else:
                    value = f"{15_000_000 + 1_500_000 * position + 37_219 * index:,}"
                data.append({"TableName": table, "SeriesCode": series, "LineNumber": line,
                             "LineDescription": name, "TimePeriod": time, "METRIC_NAME": pinned["metric"],
                             "CL_UNIT": pinned["unit"], "UNIT_MULT": pinned["multiplier"], "DataValue": value,
                             "NoteRef": table})
        unit = "Billions of chained (2017) dollars" if table == "T10106" else "Billions of dollars"
        asked = [("DATASETNAME", params["dataset"].upper()), ("TABLENAME", table.upper()),
                 ("FREQUENCY", frequency), ("YEAR", "ALL")]
        results = {"Statistic": "NIPA Table", "UTCProductionTime": "2026-11-11T15:50:00.000",
                   "Dimensions": [{"Ordinal": str(n), "Name": name, "DataType": "string", "IsValue": "0"}
                                  for n, name in enumerate(("TableName", "SeriesCode", "LineNumber",
                                                            "LineDescription", "TimePeriod", "CL_UNIT",
                                                            "UNIT_MULT", "METRIC_NAME", "DataValue"), start=1)],
                   "Data": data,
                   "Notes": [{"NoteRef": table, "NoteText": f"Table {table}. An invented table [{unit}] - "
                                                            "LastRevised: October 29, 2026"}]}
    echo = [("USERID", "REDACTED"), ("RESULTFORMAT", "JSON"), ("METHOD", "GETDATA"), *asked]
    answer = {"BEAAPI": {"Request": {"RequestParam": [{"ParameterName": name, "ParameterValue": value}
                                                      for name, value in echo]},
                         "Results": results}}
    return json.dumps(answer, separators=(",", ":")).encode()


#: Invented levels for the EIA's series: (level, step per Period, decimals).
EIA_SHAPE = {"RWTC": (60, 0.11, 2), "RBRTE": (64, 0.09, 2), "RNGWHHD": (2.5, 0.013, 2),
             "EMM_EPMR_PTE_NUS_DPG": (3.1, 0.004, 3), "ALL": (330000, 410.25, 5)}


def eia_body(params: dict, offset: int, length: int) -> bytes:
    """One page of an answer of the EIA's API v2. In small, what the real answers of
    2026-11-11 showed: the total and every value as text, rows sorted by period and then by
    series, a week listed with no number, a price under a dollar printed without its zero,
    two series that begin at different months, and the request repeated without the key."""
    column, facet = params.get("column", "value"), params.get("facet", "series")
    weekly = params["frequency"] == "weekly"
    if weekly:
        day, periods = date(2025, 1, 6), []
        while day <= date(2026, 11, 9):
            periods.append(day.isoformat())
            day += timedelta(days=7)
    else:
        last = (2026, 8) if column == "generation" else (2026, 10)
        periods = [f"{year}-{month:02d}" for year in range(2019, 2027) for month in range(1, 13)
                   if (year, month) <= last]
    rows = []
    for index, period in enumerate(periods):
        for position, series in enumerate(sorted(params["series"])):
            if position and index < 6:
                continue  # the second series begins half a year after the first
            level, step, places = EIA_SHAPE[series]
            value = f"{level + step * index:.{places}f}"
            if weekly and index == 3:
                value = None
            elif weekly and index == 5:
                value = ".995"
            if column == "generation":
                row = {"period": period, "location": params["facets"]["location"], "stateDescription": "U.S. Total",
                       "sectorid": params["facets"]["sectorid"], "sectorDescription": "All Sectors",
                       facet: series, "fuelTypeDescription": "all fuels", column: value,
                       f"{column}-units": params["units"][series]}
            else:
                row = {"period": period, "duoarea": "NUS", "area-name": "NA", "product": "EPX",
                       "product-name": "An invented product", "process": "PX0", "process-name": "An invented price",
                       facet: series, "series-description": f"An invented series ({params['units'][series]})",
                       column: value, "units": params["units"][series]}
            rows.append(row)
    facets = {facet: list(params["series"]), **{name: [value] for name, value in sorted(params.get("facets", {}).items())}}
    answer = {"response": {"total": str(len(rows)), "dateFormat": "YYYY-MM-DD" if weekly else "YYYY-MM",
                           "frequency": params["frequency"], "data": rows[offset:offset + length]},
              "request": {"command": f"/v2/{params['route']}/data/",
                          "params": {"frequency": params["frequency"], "data": [column], "facets": facets,
                                     "sort": [{"column": "period", "direction": "asc"},
                                              {"column": facet, "direction": "asc"}],
                                     "offset": str(offset), "length": str(length)}},
              "apiVersion": "2.1.14", "ExcelAddInVersion": "2.1.0"}
    return json.dumps(answer, separators=(",", ":")).encode()


CENSUS_STAMP = (2026, 11, 2, 9, 0, 20)  # every member of an invented zip is dated the same
CENSUS_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
#: Invented levels and steps for the Census series: value = level + step * (months since the start).
CENSUS_SHAPE = {
    "44X72:SM:US:SA": (150000, 1400, 0), "ASTARTS:TOTAL:US:SA": (1500, -0.4, 0), "BOPGS:BAL:US:SA": (-9000, -160, 0),
    "Total Construction1": (460000, 4250, 0), "Total Private Construction2": (330000, 3200, 0),
    "Total Public Construction3": (130000, 1050, 0),
}


def _zip(members: dict[str, bytes]) -> bytes:
    """A zip whose bytes depend on nothing but its members: fixed dates, fixed order, and
    stored, not deflated, so that no version of a compression library can change them. (The
    Bureau's own zips are deflated; a reader does not care.)"""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as archive:
        for name, data in members.items():
            archive.writestr(zipfile.ZipInfo(name, CENSUS_STAMP), data)
    return out.getvalue()


def _census_value(series: str, age: int) -> str:
    level, step, places = CENSUS_SHAPE[series]
    return f"{level + age * step:.{places}f}"


def census_flat_body(params: dict) -> bytes:
    """One flat file of the Economic Indicators, in a zip with its README: the tables of codes
    under their headings, CR LF line ends with a bare line feed between sections, a section of
    sampling error where the program has one, months listed to the end of the year with no
    figure after September, one other category with a value that is a code, and a row of
    sampling error for a month that is read."""
    program = params["program"]
    first = 2012  # the Bureau's files begin in 1992 or 1959; an invented one need not be so long
    begins = {"FTD": (2013, 1)}.get(program, (first, 1))  # as the Bureau's balance begins later than its file
    codes = [dict(zip(("category", "data_type", "geo", "adjusted"), name.split(":"), strict=True))
             for name in params["series"]]
    labels = [params["labels"][name] for name in params["series"]]
    categories = [(c["category"], l["category"]) for c, l in zip(codes, labels, strict=True)] + [("OTHER", "Another Category")]
    data_types = [(c["data_type"], l["data_type"], l["unit"]) for c, l in zip(codes, labels, strict=True)] \
        + [("MPC", "Monthly Percent Change", "PCT")]
    geos = [(codes[0]["geo"], labels[0]["geo"])]
    errors = program != "FTD"
    months = [(year, month) for year in range(first, 2027) for month in range(1, 13)]
    sections = [
        ["CATEGORIES", "cat_idx,cat_code,cat_desc,cat_indent",
         *(f'{n},{code},"{text}",0' for n, (code, text) in enumerate(categories, start=1))],
        ["DATA TYPES", "dt_idx,dt_code,dt_desc,dt_unit",
         *(f'{n},{code},"{text}",{unit}' for n, (code, text, unit) in enumerate(data_types, start=1))],
        *([["ERROR TYPES", "et_idx,err_code,err_desc,err_unit", '1,E_X,"An invented measure of sampling error",PCT']]
          if errors else []),
        ["GEO LEVELS", "geo_idx,geo_code,geo_desc", *(f'{n},{code},"{text}"' for n, (code, text) in enumerate(geos, start=1))],
        ["TIME PERIODS", "per_idx,per_name",
         *(f"{n},{CENSUS_MONTHS[month - 1]}-{year}" for n, (year, month) in enumerate(months, start=1))],
        ["NOTES", '"An invented file in the shape of the Bureau\'s. No figure in it is a measurement."'],
        ["DATA UPDATED ON", "Thursday, 15-Oct-26 07:31:23 EDT"],
    ]
    data = ["DATA", "per_idx,cat_idx,dt_idx,et_idx,geo_idx,is_adj,val" if errors else "per_idx,cat_idx,dt_idx,geo_idx,is_adj,val"]

    def row(period, category, data_type, adjusted, value, error="0"):
        cells = [str(period), str(category), str(data_type), *([error] if errors else []), "1", adjusted, value]
        data.append(",".join(cells))

    for n, (year, month) in enumerate(months, start=1):
        if (year, month) > (2026, 9) or (year, month) < begins:
            continue
        age = (year - begins[0]) * 12 + month - begins[1]
        for index, (name, code) in enumerate(zip(params["series"], codes, strict=True), start=1):
            adjusted = "1" if code["adjusted"] == "SA" else "0"
            row(n, index, index, adjusted, _census_value(name, age))
            row(n, index, len(data_types), adjusted, "Z" if age % 40 == 0 else f"{(age % 7 - 3) / 10:.1f}")
            if errors and age % 12 == 0:
                row(n, index, 0, adjusted, "0.5", error="1")
        row(n, len(categories), 1, "0", str(1000 + age))
    text = "\r\n\n\n".join("\r\n".join(section) for section in sections[:-1] + [sections[-1], data]) + "\r\n"
    readme = b"Economic Measures Time Series Dataset\n\nAn invented README: see fixtures/capture/README.md.\n"
    return _zip({f"{program}-mf.csv": text.encode(), "/README": readme})


def census_c30_body(params: dict) -> bytes:
    """The construction workbook: a title, a line on units, the row of headings (each with its
    line break as Excel writes it, and the footnote number at its end), a row a month from
    September 2026 back to January 2012 (the Bureau's goes back to 1993) with the Bureau's marks on the newest three, then the
    notes under the table."""
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    strings: list[str] = []

    def text_cell(reference: str, text: str) -> str:
        if text not in strings:
            strings.append(text)
        return f'<c r="{reference}" s="1" t="s"><v>{strings.index(text)}</v></c>'

    headings = ["Total\r\n_x000D_Residential", *(f"Total\r\n_x000D_{name.removeprefix('Total ')}" for name in params["series"])]
    letters = "BCDEFGH"
    rows = [f'<row r="1">{text_cell("A1", params["title"])}</row>', f'<row r="2">{text_cell("A2", params["units"])}</row>',
            '<row r="3"><c r="A3" s="11"/></row>',
            '<row r="4">' + text_cell("A4", "Date")
            + "".join(text_cell(f"{letters[n]}4", heading) for n, heading in enumerate(headings)) + "</row>"]
    months = [(year, month) for year in range(2026, 2011, -1) for month in range(12, 0, -1) if (year, month) <= (2026, 9)]
    for n, (year, month) in enumerate(months):
        r = 5 + n
        age = (year - 2012) * 12 + month - 1
        mark = "p" if n == 0 else "r" if n < 3 else ""
        cells = [text_cell(f"A{r}", f"{CENSUS_MONTHS[month - 1]}-{year % 100:02d}{mark}"),
                 f'<c r="B{r}" s="4"><v>{200000 + age * 1900}</v></c>',
                 *(f'<c r="{letters[i + 1]}{r}" s="4"><v>{_census_value(name, age)}</v></c>'
                   for i, name in enumerate(params["series"]))]
        rows.append(f'<row r="{r}">' + "".join(cells) + "</row>")
    last = 5 + len(months)
    for n, note in enumerate(["p Preliminary r Revised", "1An invented note.", "Source: an invented workbook."]):
        rows.append(f'<row r="{last + n}">{text_cell(f"A{last + n}", note)}</row>')
    head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    sheet = f'{head}<worksheet xmlns="{main}"><sheetData>{"".join(rows)}</sheetData></worksheet>'
    shared = (f'{head}<sst xmlns="{main}" count="{len(strings)}" uniqueCount="{len(strings)}">'
              + "".join(f"<si><t>{escape(text)}</t></si>" for text in strings) + "</sst>")
    book = f'{head}<workbook xmlns="{main}"><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>'
    return _zip({"[Content_Types].xml": b"<Types/>", "xl/workbook.xml": book.encode(),
                 "xl/worksheets/sheet1.xml": sheet.encode(), "xl/sharedStrings.xml": shared.encode()})


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
        if url.netloc == "apps.bea.gov":
            named = query.get("TableName", query.get("Indicator"))[0]
            endpoint = next(e for e in self._endpoints if e.adapter == "bea"
                            and named in (e.params.get("table"), e.params.get("indicator")))
            return "application/json", bea_body(endpoint.params)
        if url.netloc == "api.eia.gov":
            route = url.path.removeprefix("/v2/").removesuffix("/data/")
            endpoint = next(e for e in self._endpoints if e.adapter == "eia" and e.params["route"] == route)
            return "application/json", eia_body(endpoint.params, int(query["offset"][0]), int(query["length"][0]))
        if url.netloc == "www.census.gov" and url.path == "/econ_getzippedfile/":
            endpoint = next(e for e in self._endpoints if e.adapter == "census_eits"
                            and e.params["program"] == query["programCode"][0])
            return "application/octet-stream", census_flat_body(endpoint.params)
        if url.netloc == "www.census.gov":
            endpoint = next(e for e in self._endpoints if e.adapter == "census_c30"
                            and url.path.endswith("/" + e.params["file"]))
            return ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    census_c30_body(endpoint.params))
        if url.netloc == "api.imf.org":
            agency, flow = url.path.split("/")[-4:-2]
            endpoint = next(e for e in self._endpoints if e.adapter == "imf_sdmx"
                            and (e.params["agency"], e.params["flow"]) == (agency, flow))
        else:
            endpoint = next(e for e in self._endpoints if e.adapter == "fed_board"
                            and e.params["rel"] == query["rel"][0] and e.params["series"] == query["series"][0])
        params = endpoint.params
        ranges = {entry["source"]["origin"]["origin_id"]: entry["range"]
                  for entry in load_catalog().values()
                  if (entry.get("source", {}).get("channel") or {}).get("endpoint") == endpoint.id
                  and "range" in entry}
        if endpoint.adapter == "imf_sdmx":
            return "application/json", imf_body(params, ranges)
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
    # The invented clock ticks once a request. The sources that came with M15 are asked last,
    # and the Census files of M16 after them, so the times recorded for the others are the
    # ones they have always had.
    order = {"bea": 1, "eia": 1, "census_eits": 2, "census_c30": 2}  # M15's, then M16's
    for endpoint in sorted(endpoints, key=lambda e: order.get(e.adapter, 0)):
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
