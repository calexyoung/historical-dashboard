"""The Treasury Fiscal Data adapter reads what it kept (PLAN M13): Debt to the Penny by day,
and the Monthly Treasury Statement's summary table by month, each month taken from the latest
statement that lists it. Bodies here are small and invented."""
import json

import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint

from .capture_helpers import Scripted

TREASURY = ADAPTERS["treasury_fiscal_data"]
BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
RECEIPTS, OUTLAYS = "current_month_gross_rcpt_amt", "current_month_gross_outly_amt"


def endpoint(path, key, read, series):
    return Endpoint("tx", "treasury-fiscal-data", "treasury_fiscal_data",
                    "U.S. Department of the Treasury, Bureau of the Fiscal Service", ("x",), "direct",
                    {"path": path, "key": key, "read": read, "series": series})


DEBT = endpoint("v2/accounting/od/debt_to_penny", ["record_date", "src_line_nbr"], "daily_rows",
                ["tot_pub_debt_out_amt"])
MTS = endpoint("v1/accounting/mts/mts_table_1", ["record_date", "src_line_nbr"], "mts_summary",
               [RECEIPTS, OUTLAYS])


def url(spec):
    key = "%2C".join(spec.params["key"])
    return f"{BASE}{spec.params['path']}?format=json&sort={key}&page%5Bnumber%5D=1&page%5Bsize%5D=10000"


def page(rows):
    return json.dumps({"data": rows, "meta": {"count": len(rows), "total-count": len(rows), "total-pages": 1}})


def fetch(spec, rows):
    transport = Scripted({url(spec): [(200, page(rows))]})
    return capture(spec, Fetch(Session(transport, sleep=lambda s: None)))


def debt_row(day, value, line="1"):
    return {"record_date": day, "src_line_nbr": line, "tot_pub_debt_out_amt": value}


def test_debt_to_the_penny_is_one_observation_a_day_to_the_cent():
    raw = fetch(DEBT, [debt_row("2026-11-05", "38514009123456.78"), debt_row("2026-11-06", "null"),
                       debt_row("2026-11-09", "38520000000000.01")])
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.scope["read"] == "daily_rows"
    assert raw.evidence.checks["series"] == {
        "tot_pub_debt_out_amt": {"rows": 3, "first": "2026-11-05", "last": "2026-11-09"}}
    state = TREASURY.parse(raw)
    assert state.complete is True
    assert state.series == {"tot_pub_debt_out_amt": [
        {"period": "2026-11-05", "value": "38514009123456.78", "status": "observed", "footnotes": []},
        # The table lists the day and gives "null": listed, with no number.
        {"period": "2026-11-06", "value": None, "status": "unavailable", "footnotes": []},
        {"period": "2026-11-09", "value": "38520000000000.01", "status": "observed", "footnotes": []},
    ]}
    assert TREASURY.coverage(state.scope) == (None, None)


@pytest.mark.parametrize("rows, problem", [
    ([debt_row("2026-11-05", "1.00"), debt_row("2026-11-05", "2.00", line="2")],
     "tot_pub_debt_out_amt gives 2026-11-05 twice"),
    ([debt_row("2026-11-05", "$1.00")],
     "tot_pub_debt_out_amt has a value that is not a number or null for 2026-11-05: '$1.00'"),
    ([{"record_date": "2026-11-05", "src_line_nbr": "1"}],
     "tot_pub_debt_out_amt has a value that is not a number or null for 2026-11-05: None"),
    ([debt_row("11/05/2026", "1.00")], "a row's record_date is not a day: '11/05/2026'"),
])
def test_a_debt_table_that_cannot_be_read_is_not_whole(rows, problem):
    raw = fetch(DEBT, rows)
    assert problem in raw.evidence.problems
    assert TREASURY.parse(raw).complete is False


# --- the Monthly Treasury Statement, table 1 -------------------------------------------------

def statement(day, years, first_id):
    """One statement's rows as the table lists them: for each fiscal year a header, its month
    rows and a year-to-date total. ``years`` is {fiscal year: {month name: (receipts, outlays)}}."""
    rows, line, ident = [], 0, first_id

    def row(kind, parent, desc, receipts="null", outlays="null"):
        nonlocal line, ident
        line, ident = line + 1, ident + 1
        rows.append({"record_date": day, "src_line_nbr": str(line), "record_type_cd": kind,
                     "parent_id": parent, "classification_id": str(ident), "classification_desc": desc,
                     RECEIPTS: receipts, OUTLAYS: outlays, "current_month_dfct_sur_amt": "0"})
        return str(ident)

    for year, months in years.items():
        header = row("SL", "null", f"FY {year}")
        for name, (receipts, outlays) in months.items():
            row("MTH", header, name, receipts, outlays)
        row("SL", header, "Year-to-Date", "9", "9")
    return rows


def test_each_month_comes_from_the_latest_statement_that_lists_it():
    october = statement("2025-10-31", {2025: {"August": ("344.10", "689.10"), "September": ("543.60", "345.73")},
                                       2026: {"October": ("404.37", "688.72")}}, 100)
    november = statement("2025-11-30", {2025: {"August": ("344.10", "689.10"), "September": ("543.60", "345.70")},
                                        2026: {"October": ("404.37", "688.70"), "November": ("336.00", "509.27")}}, 200)
    raw = fetch(MTS, october + november)
    assert raw.evidence.complete, raw.evidence.problems
    state = TREASURY.parse(raw)
    assert state.complete is True
    # Fiscal 2026 begins in October 2025. September's and October's outlays were revised in the
    # November statement, and the later figure is the one read.
    assert [(o["period"], o["value"]) for o in state.series[OUTLAYS]] == [
        ("2025-08", "689.10"), ("2025-09", "345.70"), ("2025-10", "688.70"), ("2025-11", "509.27")]
    assert [(o["period"], o["value"]) for o in state.series[RECEIPTS]] == [
        ("2025-08", "344.10"), ("2025-09", "543.60"), ("2025-10", "404.37"), ("2025-11", "336.00")]
    assert {o["status"] for o in state.series[RECEIPTS]} == {"observed"}
    assert raw.evidence.checks["series"][RECEIPTS] == {"rows": 4, "first": "2025-08", "last": "2025-11"}
    assert raw.evidence.checks["statements"] == 2


def _broken(change):
    rows = statement("2025-10-31", {2026: {"October": ("404.37", "688.72")}}, 100)
    change(rows)
    return rows


@pytest.mark.parametrize("rows, problem", [
    (_broken(lambda rows: rows[1].update(parent_id="999")),
     "the statement of 2025-10-31 has a month row under no fiscal-year header: 'October'"),
    (_broken(lambda rows: rows[1].update(classification_desc="Octobre")),
     "the statement of 2025-10-31 has a month row that names no month: 'Octobre'"),
    (_broken(lambda rows: rows.insert(2, {**rows[1], "src_line_nbr": "9", "classification_id": "777"})),
     "the statement of 2025-10-31 lists 2025-10 twice"),
    (_broken(lambda rows: rows[1].update(classification_desc="November")),
     "the statement of 2025-10-31 lists 2025-11, a month after its own"),
    (_broken(lambda rows: rows[2].update(record_type_cd="XX")),
     ("the statement of 2025-10-31 has a row that is not a fiscal-year header, a month or a "
     "year-to-date total: 'Year-to-Date'")),
    (_broken(lambda rows: rows[0].update(classification_desc="Fiscal 2026")),
     ("the statement of 2025-10-31 has a row that is not a fiscal-year header, a month or a "
     "year-to-date total: 'Fiscal 2026'")),
    (_broken(lambda rows: rows[1].update({RECEIPTS: "about 400"})),
     f"{RECEIPTS} has a value that is not a number or null for 2025-10: 'about 400'"),
    (_broken(lambda rows: rows[0].update(record_date="2025-10-15") or rows[1].update(record_date="2025-10-15")
             or rows[2].update(record_date="2025-10-15")),
     "a statement is dated 2025-10-15, which is not the last day of a month"),
])
def test_a_statement_that_does_not_fit_the_contract_is_not_whole(rows, problem):
    raw = fetch(MTS, rows)
    assert problem in raw.evidence.problems
    assert TREASURY.parse(raw).complete is False


def test_a_month_the_statement_gives_null_for_is_listed_with_no_number():
    raw = fetch(MTS, statement("2025-10-31", {2026: {"October": ("404.37", "null")}}, 100))
    state = TREASURY.parse(raw)
    assert state.complete is True
    assert state.series[OUTLAYS] == [{"period": "2025-10", "value": None, "status": "unavailable", "footnotes": []}]


@pytest.mark.parametrize("params, problem", [
    ({"read": "tables"}, "its read is not daily_rows or mts_summary"),
    ({"read": "daily_rows"}, "it says how to read the table and not which series"),
    ({"series": ["a"]}, "it names series and not how to read the table"),
    ({"read": "daily_rows", "series": ["a", "a"]}, "it says how to read the table and not which series"),
    ({"read": "mts_summary", "series": ["a"], "key": ["src_line_nbr"]},
     "a table read by record_date is sorted by record_date first"),
])
def test_params_the_adapter_cannot_use_are_refused_when_the_register_is_read(params, problem):
    assert TREASURY.problem({"path": "v1/x", "key": ["record_date", "src_line_nbr"], **params}) == problem


def test_a_statement_with_no_month_rows_or_a_table_with_no_figure_is_not_whole():
    # A table cut down to its headers would otherwise read as every month withdrawn.
    rows = [row for row in statement("2025-10-31", {2026: {"October": ("404.37", "688.72")}}, 100)
            if row["record_type_cd"] != "MTH"]
    raw = fetch(MTS, rows)
    assert "the statement of 2025-10-31 lists no month" in raw.evidence.problems
    assert f"{RECEIPTS} is read and the table has no entry for it" in raw.evidence.problems
    assert TREASURY.parse(raw).complete is False


def test_a_statement_dated_on_the_last_day_of_the_calendar_is_read_not_crashed_on():
    raw = fetch(MTS, statement("9999-12-31", {9999: {"October": ("1.00", "2.00")}}, 100))
    assert isinstance(TREASURY.parse(raw).complete, bool)
