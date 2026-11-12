"""`python -m atlas crosscheck japan-cpi` (PLAN M14): does the IMF's all-items consumer price
index for Japan say what the Statistics Bureau of Japan's own file says?

Japan's index reaches Macro Atlas through the IMF (``jp_cpi``). The Bureau's 2020-base file on
e-Stat is the source of record, and in v2.0 it is a cross-check only: nothing is stored from it
and no Series is read from it. The statement of what is compared is ``checks/japan-cpi.json``.

Three ways to give the command the two sides:

    --imf FILE --estat FILE     two files someone fetched (the command prints the two addresses)
    --store DIR --estat FILE    the IMF side from the latest whole capture of imf-cpi-g20
    --live                      ask both sources once, compare in memory, keep nothing

``--live`` writes nothing anywhere: storing what a source served needs a signed register row
(ADR 0020), and a comparison needs no storage. Exit status 0 when every month agrees, 1
otherwise.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

from .capture import store as S
from .capture.adapters import ADAPTERS, Endpoint, RawCapture, _is_number
from .capture.adapters import capture as fetch_capture
from .capture.http import CaptureError, Fetch, Session
from .capture.replay import load_capture
from .capture.store import RELEASE_ZONE

ROOT = Path(__file__).resolve().parents[1]
STATEMENT = ROOT / "checks" / "japan-cpi.json"
ENDPOINT = "imf-cpi-g20"
IMF_ORIGIN = "International Monetary Fund"


def read_estat_cpi(body: bytes, item: str = "0001") -> dict[str, str]:
    """One item of the Statistics Bureau's monthly index file, by month (``2026-09``), each
    value as printed. The file is Shift-JIS CSV: rows of names, a row of item codes
    ("Group/Item code"), more header rows, then a row a month named ``YYYYMM``. Raises
    ``ValueError`` saying what is not that shape; an empty cell is a month with no value and is
    left out."""
    try:
        rows = list(csv.reader(io.StringIO(body.decode("shift_jis"), newline="")))
    except (UnicodeDecodeError, csv.Error):
        raise ValueError("it is not Shift-JIS text in rows and columns") from None
    codes = next((n for n, row in enumerate(rows) if row and "(Group/Item code)" in row[0]), None)
    if codes is None:
        raise ValueError("it has no row of item codes")
    if item not in rows[codes][1:]:
        raise ValueError(f"it has no column for item {item}")
    column = rows[codes].index(item, 1)
    values: dict[str, str] = {}
    begun = False
    for row in rows[codes + 1:]:
        name = row[0] if row else ""
        month = len(name) == 6 and name.isascii() and name.isdigit() and 1 <= int(name[4:]) <= 12
        if not month:
            if begun and name:
                raise ValueError(f"it has a row that is not a month: {name!r}")
            continue  # the header rows between the codes and the first month
        begun = True
        period = f"{name[:4]}-{name[4:]}"
        if period in values:
            raise ValueError(f"it gives {period} twice")
        cell = row[column] if column < len(row) else ""
        if cell == "":
            continue
        if not _is_number(cell):
            raise ValueError(f"its value for {period} is not a number: {cell!r}")
        values[period] = cell
    if not values:
        raise ValueError(f"it has no month for item {item}")
    return values


def _months(first: str, last: str) -> list[str]:
    out, (year, month) = [], (int(first[:4]), int(first[5:]))
    while f"{year:04d}-{month:02d}" <= last:
        out.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def compare(fund: dict[str, str | None], bureau: dict[str, str], statement: dict) -> tuple[bool, list[str]]:
    """Month by month over the statement's span. The Bureau's file is first held to its base."""
    lines: list[str] = []
    year = statement["estat"]["base_year"]
    base = [bureau.get(f"{year:04d}-{month:02d}") for month in range(1, 13)]
    if None in base:
        return False, [f"the Bureau's file does not hold all twelve months of {year}, so its base cannot be seen"]
    average = sum(Decimal(v) for v in base) / 12
    if abs(average - 100) > Decimal("0.05"):
        return False, [f"the Bureau's file averages {average:.1f} over {year}, not 100: it is not on the {year} base"]
    step = Decimal(1).scaleb(-statement["decimals"])
    months = _months(statement["first"], statement["last"])
    equal = 0
    for month in months:
        ours, theirs = fund.get(month), bureau.get(month)
        if ours is None or theirs is None:
            lines.append(f"MISSING {month}: {'the Fund' if ours is None else 'the Bureau'} has no value")
            continue
        try:
            same = Decimal(ours).quantize(step, rounding=ROUND_HALF_UP) == Decimal(theirs).quantize(step)
        except InvalidOperation:
            same = False
        if same:
            equal += 1
        else:
            lines.append(f"DIFFERENT {month}: the Fund {ours}, the Bureau {theirs}")
    decimals = statement["decimals"]
    lines.append(f"{months[0]} to {months[-1]}: {equal} of {len(months)} months equal at {decimals} "
                 f"decimal{'' if decimals == 1 else 's'}")
    return equal == len(months), lines


def _fund_from_state(state, key: str) -> dict[str, str | None]:
    if not state.complete:
        raise ValueError("; ".join(state.problems))
    return {o["period"]: o["value"] for o in state.series[key]}


def _one_series_scope(statement: dict, asked_on: str) -> dict:
    said = statement["imf"]
    return {"agency": said["agency"], "flow": said["flow"], "series": [said["series"]],
            "reference": {said["series"]: said["reference"]}, "asked_on": asked_on}


def _endpoint(statement: dict) -> Endpoint:
    said = statement["imf"]
    return Endpoint("japan-cpi-check", "imf", "imf_sdmx", IMF_ORIGIN, ("Consumer Price Index",), "direct",
                    {"agency": said["agency"], "flow": said["flow"], "series": [said["series"]],
                     "reference": {said["series"]: said["reference"]}})


def _from_store(store: Path, statement: dict) -> tuple[dict[str, str | None], str]:
    problems: list[str] = []
    whole = [line for line in S.read_fetch_log(store, problems)
             if line.get("endpoint") == ENDPOINT and line.get("outcome") == "captured"]
    if not whole:
        raise ValueError(f"{store} holds no whole capture of {ENDPOINT}")
    line = max(whole, key=lambda entry: (entry["retrieved_at"], entry["capture_id"]))
    kept: RawCapture = load_capture(store, line)
    pinned = kept.evidence.scope.get("reference", {}).get(statement["imf"]["series"])
    if pinned != statement["imf"]["reference"]:
        raise ValueError(f"the capture pins the reference period {pinned!r}, and the statement "
                         f"compares on {statement['imf']['reference']!r}")
    fund = _fund_from_state(ADAPTERS["imf_sdmx"].parse(kept), statement["imf"]["series"])
    return fund, f"capture {line['capture_id']} in {store}, retrieved {line['retrieved_at']}"


def japan_cpi(args, *, transport=None, sleep=None) -> int:
    statement = json.loads(Path(args.statement).read_text(encoding="utf-8"))
    key, adapter = statement["imf"]["series"], ADAPTERS["imf_sdmx"]
    today = datetime.now(UTC).astimezone(RELEASE_ZONE).date().isoformat()
    print(f"Japan CPI, all items: the IMF's {key} against e-Stat item {statement['estat']['item']}")
    try:
        if args.live:
            if transport is None:
                from .capture.http import LiveTransport

                transport = LiveTransport()
            session = Session(transport, **({"sleep": sleep} if sleep else {}))
            endpoint = _endpoint(statement)
            raw = fetch_capture(endpoint, Fetch(session))
            fund = _fund_from_state(adapter.parse(raw), key)
            fund_from = f"{raw.parts[0].request.url}, retrieved {S.stamp(raw.retrieved_at)}"
            answer = Fetch(session).get(statement["estat"]["url"])
            bureau_body = answer.body
            bureau_from = f"{statement['estat']['url']}, retrieved {S.stamp(answer.received_at)}"
        else:
            if not args.estat or bool(args.imf) == bool(args.store):
                print("give --live, or --estat FILE with one of --imf FILE and --store DIR. The two addresses:")
                print(f"  {adapter._url(_one_series_scope(statement, today))}")
                print(f"  {statement['estat']['url']}")
                return 2
            if args.store:
                fund, fund_from = _from_store(Path(args.store), statement)
            else:
                state = adapter.read(_one_series_scope(statement, today), [Path(args.imf).read_bytes()])
                fund, fund_from = _fund_from_state(state, key), str(args.imf)
            bureau_body, bureau_from = Path(args.estat).read_bytes(), str(args.estat)
        bureau = read_estat_cpi(bureau_body, statement["estat"]["item"])
    except CaptureError as error:
        print(f"check: FAILED ({error})")
        return 1
    except (OSError, ValueError) as error:
        print(f"check: FAILED ({error})")
        return 1
    held = [period for period, value in fund.items() if value is not None]
    print(f"the Fund: {fund_from}; reference period {statement['imf']['reference']}; "
          f"{len(held)} months, {held[0]} to {held[-1]}")
    print(f"the Bureau: {bureau_from}; {statement['estat']['base_year']} = 100; "
          f"{len(bureau)} months, {next(iter(bureau))} to {list(bureau)[-1]}")
    ok, lines = compare(fund, bureau, statement)
    print("\n".join(lines))
    if args.live:
        print("Nothing was kept.")
    print("check: matches" if ok else "check: FAILED")
    return 0 if ok else 1


def main(argv: list[str] | None = None, *, transport=None, sleep=None) -> int:
    parser = argparse.ArgumentParser(prog="atlas crosscheck", description=__doc__.split("\n")[0])
    kinds = parser.add_subparsers(dest="kind", required=True)
    p = kinds.add_parser("japan-cpi", help="the IMF's index for Japan against the Statistics Bureau's file")
    p.add_argument("--imf", help="the IMF's answer for the one series, as a file")
    p.add_argument("--store", help="a capture store holding a whole capture of imf-cpi-g20")
    p.add_argument("--estat", help="the Statistics Bureau's file (Shift-JIS CSV)")
    p.add_argument("--live", action="store_true", help="ask both sources once and keep nothing")
    p.add_argument("--statement", default=str(STATEMENT), help="what is compared (default checks/japan-cpi.json)")
    args = parser.parse_args(argv)
    return japan_cpi(args, transport=transport, sleep=sleep)
