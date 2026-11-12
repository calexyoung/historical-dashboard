"""The agency adapters (PLAN M7, 4.2, 9): what each one asks for, what a whole answer looks like
and how an answer that is not whole is flagged. Fetch only for Treasury Fiscal Data and the
Federal Reserve Board; BLS also parses. Bodies here are small and invented."""
import json
from dataclasses import replace

import pytest

from atlas.capture import CaptureError, Fetch, Session, capture, endpoints_from_register
from atlas.capture.adapters import ADAPTERS
from atlas.rights import load_register

from .capture_helpers import Scripted

ENDPOINTS = {e.id: e for e in endpoints_from_register(load_register())}
# One keyless request spans ten years; the committed endpoint asks for thirty in three requests
# (tests/v2/test_capture_parse_bls.py). These tests are about one answer.
BLS = replace(ENDPOINTS["bls-headline"], params={**ENDPOINTS["bls-headline"].params, "years": 10})
TREASURY = ENDPOINTS["treasury-debt-to-penny"]
FED = ENDPOINTS["fed-h15-treasury-yields"]
BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


def fetch(endpoint, answers, start="2026-11-11T15:50:00"):
    transport = Scripted(answers, start=start)
    raw = capture(endpoint, Fetch(Session(transport, sleep=lambda s: None)))
    return raw, transport


# --- BLS ---------------------------------------------------------------------------------

def bls_row(year, month, value, footnotes=None):
    return {"year": str(year), "period": f"M{month:02d}", "periodName": "x", "value": value,
            "footnotes": footnotes or [{}]}


def bls_answer(series=None, status="REQUEST_SUCCEEDED", message=()):
    if series is None:
        series = {name: [bls_row(2026, 2, "2.5"), bls_row(2026, 1, "2.0")] for name in BLS.params["series"]}
    listed = [{"seriesID": name, "data": rows} for name, rows in series.items()]
    return json.dumps({"status": status, "responseTime": 1, "message": list(message),
                       "Results": {"series": listed}})


def test_bls_asks_once_for_its_series_over_the_ten_years_ending_this_year():
    raw, transport = fetch(BLS, {BLS_URL: [(200, bls_answer())]})
    [request] = transport.sent
    assert request.method == "POST"
    assert dict(request.headers)["Content-Type"] == "application/json"
    assert json.loads(request.body) == {
        "seriesid": ["CUUR0000SA0", "CUSR0000SA0", "LNS14000000", "CES0000000001"],
        "startyear": "2017", "endyear": "2026"}
    assert raw.evidence.complete
    assert raw.evidence.scope == {"series": BLS.params["series"], "start_year": 2017, "end_year": 2026}
    assert raw.evidence.checks["series"]["LNS14000000"] == {"rows": 2, "first": "2026-01", "last": "2026-02"}


def test_the_bls_year_is_new_yorks_not_utcs():
    # 03:00 UTC on 1 January 2027 is still 2026 in New York.
    raw, _ = fetch(BLS, {BLS_URL: [(200, bls_answer())]}, start="2027-01-01T03:00:00")
    assert raw.evidence.scope["end_year"] == 2026


@pytest.mark.parametrize("answer, problem", [
    (bls_answer(status="REQUEST_NOT_PROCESSED", message=["daily threshold reached"]),
     "the status is 'REQUEST_NOT_PROCESSED', not 'REQUEST_SUCCEEDED'"),
    (bls_answer(message=["Year range has been reduced to the system-allowed limit of 10 years."]),
     "BLS says: Year range has been reduced to the system-allowed limit of 10 years."),
    (bls_answer({name: [bls_row(2026, 1, "2.0")] for name in BLS.params["series"][:3]},
                message=["Invalid Series for Series CES0000000001"]),
     "series CES0000000001 is not in the answer"),
    (bls_answer({name: [] if name == "LNS14000000" else [bls_row(2026, 1, "2.0")]
                 for name in BLS.params["series"]}),
     "series LNS14000000 has no rows"),
    (bls_answer({name: [bls_row(2014, 1, "2.0")] for name in BLS.params["series"]}),
     "series CUUR0000SA0 has 2014-01, outside the years asked for"),
    (bls_answer({name: [bls_row(2026, 1, "2.0"), bls_row(2026, 1, "2.1")] for name in BLS.params["series"]}),
     "series CUUR0000SA0 gives 2026-01 twice"),
    ("<html><body>Access Denied</body></html>", "the answer is not JSON"),
])
def test_a_bls_answer_that_is_not_whole_is_flagged(answer, problem):
    raw, _ = fetch(BLS, {BLS_URL: [(200, answer)]})
    assert raw.evidence.complete is False
    assert problem in raw.evidence.problems


@pytest.mark.parametrize("value", ["garbage", "", "1,234", "N/A", "--"])
def test_only_a_dash_means_bls_did_not_publish_the_month(value):
    series = {name: [bls_row(2026, 1, "2.0")] for name in BLS.params["series"]}
    series["LNS14000000"] = [bls_row(2026, 2, value), bls_row(2026, 1, "4.3")]
    raw, _ = fetch(BLS, {BLS_URL: [(200, bls_answer(series))]})
    assert raw.evidence.complete is False
    assert f"series LNS14000000 has a value that is not a number or '-' for 2026-02: {value!r}" \
        in raw.evidence.problems
    state = ADAPTERS["bls"].parse(raw)
    assert state.complete is False
    assert [o["period"] for o in state.series["LNS14000000"]] == ["2026-01"]  # nothing invented


@pytest.mark.parametrize("answer", [
    '{"status":"REQUEST_SUCCEEDED","message":[],"Results":{"series":[{"seriesID":"CUUR0000SA0","data":[null]}]}}',
    '{"status":"REQUEST_SUCCEEDED","message":"oops","Results":[]}',
    '{"status":"REQUEST_SUCCEEDED","message":[],"Results":{"series":[null, 5]}}',
    '{"status":"REQUEST_SUCCEEDED","message":[],"Results":{"series":[{"seriesID":"CUUR0000SA0","data":[{"year":2026,"period":"M01","value":"1","footnotes":"x"}]}]}}',
])
def test_a_bls_answer_in_a_shape_nobody_expected_is_incomplete_not_a_crash(answer):
    raw, _ = fetch(BLS, {BLS_URL: [(200, answer)]})
    assert raw.evidence.complete is False
    assert ADAPTERS["bls"].parse(raw).complete is False


def test_a_bls_series_listed_twice_is_not_whole_whichever_copy_reads_well():
    listed = [{"seriesID": name, "data": [bls_row(2026, 1, "2.0")]} for name in BLS.params["series"]]
    listed.insert(0, {"seriesID": "CUUR0000SA0", "data": [bls_row(2026, 1, "bad")]})
    answer = json.dumps({"status": "REQUEST_SUCCEEDED", "message": [], "Results": {"series": listed}})
    raw, _ = fetch(BLS, {BLS_URL: [(200, answer)]})
    assert raw.evidence.complete is False
    assert "series CUUR0000SA0 is in the answer twice" in raw.evidence.problems
    assert ADAPTERS["bls"].parse(raw).complete is False


def test_a_bls_failure_raises():
    with pytest.raises(CaptureError, match="HTTP 403"):
        fetch(BLS, {BLS_URL: [(403, "Access Denied")]})


def test_bls_parse_gives_each_month_as_the_bureau_printed_it():
    gap = [{"code": "X", "text": "Data unavailable due to the 2025 lapse in appropriations"}]
    series = {name: [bls_row(2026, 1, "2.0")] for name in BLS.params["series"]}
    series["CUUR0000SA0"] = [bls_row(2025, 11, "324.100"), bls_row(2025, 10, "-", gap),
                             bls_row(2025, 9, "324.800")]
    series["CES0000000001"] = [bls_row(2026, 10, "159293", [{"code": "P", "text": "preliminary"}]),
                               bls_row(2026, 9, "159128")]
    raw, _ = fetch(BLS, {BLS_URL: [(200, bls_answer(series))]})
    state = ADAPTERS["bls"].parse(raw)

    assert state.complete is True
    assert state.scope == raw.evidence.scope
    assert state.series["CUUR0000SA0"] == [
        {"period": "2025-09", "value": "324.800", "status": "observed", "footnotes": []},
        {"period": "2025-10", "value": None, "status": "unavailable", "footnotes": gap},
        {"period": "2025-11", "value": "324.100", "status": "observed", "footnotes": []},
    ]
    assert state.series["CES0000000001"] == [
        {"period": "2026-09", "value": "159128", "status": "observed", "footnotes": []},
        {"period": "2026-10", "value": "159293", "status": "preliminary",
         "footnotes": [{"code": "P", "text": "preliminary"}]},
    ]


def test_bls_parse_never_calls_a_partial_answer_complete():
    answer = bls_answer({name: [bls_row(2026, 1, "2.0")] for name in BLS.params["series"][:3]},
                        message=["Invalid Series for Series CES0000000001"])
    raw, _ = fetch(BLS, {BLS_URL: [(200, answer)]})
    state = ADAPTERS["bls"].parse(raw)
    assert state.complete is False
    assert "series CES0000000001 is not in the answer" in state.problems


def test_bls_parse_does_not_guess_at_a_period_it_does_not_know():
    series = {name: [bls_row(2026, 1, "2.0")] for name in BLS.params["series"]}
    series["LNS14000000"].append({"year": "2025", "period": "M13", "periodName": "Annual",
                                  "value": "4.2", "footnotes": [{}]})
    raw, _ = fetch(BLS, {BLS_URL: [(200, bls_answer(series))]})
    state = ADAPTERS["bls"].parse(raw)
    assert state.complete is False
    assert [o["period"] for o in state.series["LNS14000000"]] == ["2026-01"]


# --- Treasury Fiscal Data ----------------------------------------------------------------

def treasury_url(page, size=10000):
    return ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/"
            f"debt_to_penny?format=json&sort=record_date%2Csrc_line_nbr&page%5Bnumber%5D={page}"
            f"&page%5Bsize%5D={size}")


def treasury_page(days, total_count, total_pages, count=None):
    rows = [{"record_date": day, "src_line_nbr": "1", "tot_pub_debt_out_amt": "1.00"} for day in days]
    return json.dumps({"data": rows, "meta": {"count": len(rows) if count is None else count,
                                               "total-count": total_count, "total-pages": total_pages},
                       "links": {}})


def test_treasury_reads_the_whole_table_in_order_one_page_when_it_fits():
    raw, transport = fetch(TREASURY, {treasury_url(1): [(200, treasury_page(["2026-11-05", "2026-11-06"], 2, 1))]})
    assert [request.method for request in transport.sent] == ["GET"]
    assert raw.evidence.complete
    assert raw.evidence.scope == {"path": "v2/accounting/od/debt_to_penny",
                                  "key": ["record_date", "src_line_nbr"], "page_size": 10000,
                                  "read": "daily_rows", "series": ["tot_pub_debt_out_amt"]}
    assert raw.evidence.checks == {"pages": 1, "rows": 2, "total_count": 2, "total_pages": 1,
                                   "first": ["2026-11-05", "1"], "last": ["2026-11-06", "1"],
                                   "series": {"tot_pub_debt_out_amt": {
                                       "rows": 2, "first": "2026-11-05", "last": "2026-11-06"}}}


def test_treasury_follows_every_page_and_the_capture_is_as_late_as_its_last_page():
    raw, transport = fetch(TREASURY, {
        treasury_url(1): [(200, treasury_page(["2026-11-04", "2026-11-05"], 3, 2))],
        treasury_url(2): [(200, treasury_page(["2026-11-06"], 3, 2))],
    })
    assert len(transport.sent) == 2 and len(raw.parts) == 2
    assert raw.evidence.complete
    assert raw.evidence.checks["rows"] == 3
    assert raw.retrieved_at == raw.parts[1].response.received_at


@pytest.mark.parametrize("pages, problem", [
    ([treasury_page(["2026-11-04", "2026-11-05"], 3, 2), treasury_page(["2026-11-06"], 4, 2)],
     "the pages do not agree on the totals; the table changed while it was read"),
    ([treasury_page(["2026-11-04", "2026-11-05"], 4, 2), treasury_page(["2026-11-06"], 4, 2)],
     "the table has 4 rows and 3 were read"),
    ([treasury_page(["2026-11-04", "2026-11-05"], 3, 2), treasury_page(["2026-11-05"], 3, 2)],
     "a row's key appears twice"),
    ([treasury_page(["2026-11-05", "2026-11-04"], 2, 1)], "the rows are not in the order asked for"),
    ([treasury_page(["2026-11-04"], 1, 1, count=5)], "page 1 says it has 5 rows and has 1"),
    ([treasury_page([], 0, 1)], "the table has no rows"),
    (['{"error":"Invalid Query Param","message":"bad"}'], "page 1 has no data and meta"),
    (["<html>maintenance</html>"], "page 1 is not JSON"),
])
def test_a_treasury_answer_that_is_not_whole_is_flagged(pages, problem):
    answers = {treasury_url(n): [(200, body)] for n, body in enumerate(pages, start=1)}
    raw, _ = fetch(TREASURY, answers)
    assert raw.evidence.complete is False
    assert problem in raw.evidence.problems


@pytest.mark.parametrize("page", [
    '{"data":[null],"meta":{"count":1,"total-count":1,"total-pages":1}}',
    '{"data":[{"record_date":"2026-11-05","src_line_nbr":"1"}],"meta":{"count":1,"total-count":[1],"total-pages":{"a":1}}}',
    '{"data":[{"record_date":["x"],"src_line_nbr":"1"}],"meta":{"count":1,"total-count":1,"total-pages":1}}',
])
def test_a_treasury_page_in_a_shape_nobody_expected_is_incomplete_not_a_crash(page):
    raw, _ = fetch(TREASURY, {treasury_url(1): [(200, page)]})
    assert raw.evidence.complete is False


def test_treasury_line_numbers_are_ordered_as_numbers():
    rows = [{"record_date": "2026-11-05", "src_line_nbr": n} for n in ("2", "10")]
    page = json.dumps({"data": rows, "meta": {"count": 2, "total-count": 2, "total-pages": 1}})
    unread = {k: v for k, v in TREASURY.params.items() if k not in ("read", "series")}  # paging only
    raw, _ = fetch(replace(TREASURY, params=unread), {treasury_url(1): [(200, page)]})
    assert raw.evidence.complete, raw.evidence.problems


def test_treasury_stops_at_its_page_limit_and_says_the_table_was_not_all_read():
    answers = {treasury_url(n): [(200, treasury_page([f"2026-01-{n:02d}"], 60, 60))] for n in range(1, 51)}
    raw, transport = fetch(TREASURY, answers)
    assert len(transport.sent) == 50
    assert "the table has 60 pages and 50 were read" in raw.evidence.problems


def test_a_treasury_page_that_fails_raises_and_the_pages_before_it_are_kept():
    transport = Scripted({treasury_url(1): [(200, treasury_page(["2026-11-04"], 2, 2))],
                          treasury_url(2): [(400, "bad page")]})
    http = Fetch(Session(transport, sleep=lambda s: None))
    with pytest.raises(CaptureError, match="HTTP 400"):
        capture(TREASURY, http)
    assert [part.response.status for part in http.parts] == [200, 400]


# --- Federal Reserve Board ---------------------------------------------------------------

FED_URL = ("https://www.federalreserve.gov/datadownload/Output.aspx?rel=H15"
           "&series=bf17364827e38702b42a58cf8eaa3f78&lastobs=&from=&to=&filetype=csv"
           "&label=include&layout=seriescolumn")
NAMES = FED.params["expect"]


def fed_csv(data_rows, names=NAMES, labels=True):
    def quoted(label, cells):
        return ",".join(f'"{cell}"' for cell in [label, *cells])

    head = [quoted("Series Description", ["d"] * len(names)), quoted("Unit:", ["Percent:_Per_Year"] * len(names)),
            quoted("Multiplier:", ["1"] * len(names)), quoted("Currency:", ["NA"] * len(names)),
            quoted("Unique Identifier: ", [f"H15/H15/{name}" for name in names]),
            quoted("Time Period", names)]
    return "\n".join((head if labels else []) + data_rows) + "\n"


def fed_row(day, value="4.00"):
    return ",".join([day, *([value] * len(NAMES))])


def test_the_fed_board_package_is_one_csv_of_the_series_expected():
    body = fed_csv([fed_row("2026-11-05"), fed_row("2026-11-06", "ND"), fed_row("2026-11-09", "")])
    raw, transport = fetch(FED, {FED_URL: [(200, body, [["Content-Type", "text/csv"]])]})
    assert [request.method for request in transport.sent] == ["GET"]
    assert raw.evidence.complete
    assert raw.evidence.checks == {"rows": 3, "first": "2026-11-05", "last": "2026-11-09"}
    assert raw.evidence.scope["expect"] == NAMES


@pytest.mark.parametrize("body, problem", [
    ("<!DOCTYPE html><html><body>Just a moment...</body></html>",
     "the file does not begin with the six label rows"),
    (fed_csv([fed_row("2026-11-05")], names=NAMES[:-1]), "the columns are not the series expected"),
    (fed_csv([fed_row("2026-11-05")], names=list(reversed(NAMES))), "the columns are not the series expected"),
    (fed_csv([]), "the file has no data rows"),
    (fed_csv([fed_row("2026-11-05"), "2026-11-06,4.00,4.0"]),
     "a data row is not a day and 11 cells: '2026-11-06'"),
    (fed_csv([fed_row("2026-11-06"), fed_row("2026-11-05")]),
     "the dates are not in order, or one appears twice"),
    (fed_csv([fed_row("2026-11-05"), fed_row("2026-11-05")]),
     "the dates are not in order, or one appears twice"),
])
def test_a_fed_board_file_that_is_not_whole_is_flagged(body, problem):
    raw, _ = fetch(FED, {FED_URL: [(200, body)]})
    assert raw.evidence.complete is False
    assert problem in raw.evidence.problems


def test_a_fed_board_failure_raises():
    with pytest.raises(CaptureError, match="HTTP 503"):
        fetch(FED, {FED_URL: [(503, "busy")] * 4})
