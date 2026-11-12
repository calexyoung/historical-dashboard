"""The BEA adapter (PLAN M15; ADR 0029): a whole table of the National Income and Product
Accounts, or one indicator of the International Transactions Accounts, asked for with a key
that is in nothing kept, and read by the Bureau's own series code on the line the endpoint
pins. Bodies are small and every value is invented."""
import json

import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint
from atlas.capture.run import RegisterError, endpoints_from_register

from .bea_eia_helpers import BEA_URL, bea_error, body, ita, nipa
from .capture_helpers import LiveScripted, Scripted, origin_row, register

BEA = ADAPTERS["bea"]
KEY = "AB12CD34-EF56-7890-ABCD-EF1234567890"
GDP = {"line": "1", "unit": "Level", "multiplier": "6", "metric": "Chained Dollars",
       "basis": "chained (2017) dollars"}
NIPA_URL = f"{BEA_URL}?method=GetData&DataSetName=NIPA&TableName=T10106&Frequency=Q&Year=ALL&ResultFormat=JSON"
ITA_URL = (f"{BEA_URL}?method=GetData&DataSetName=ITA&Indicator=BalGdsServ&AreaOrCountry=AllCountries"
           "&Frequency=QSA&Year=ALL&ResultFormat=JSON")
ITA_PARAMS = {"read": "ita", "indicator": "BalGdsServ", "area": "AllCountries", "frequency": "QSA",
              "series": ["TSI_ItaBalGdsServ_QSA"],
              "labels": {"TSI_ItaBalGdsServ_QSA": {"unit": "USD", "multiplier": "6"}}}


def endpoint(**params):
    base = {"read": "nipa", "dataset": "NIPA", "table": "T10106", "frequency": "Q",
            "series": ["A191RX"], "labels": {"A191RX": GDP}}
    return Endpoint("bea-x", "bea", "bea", "U.S. Bureau of Economic Analysis", ("A table",), "direct",
                    {**base, **params} if params.get("read") != "ita" else params)


def read(answer, spec=None, url=NIPA_URL, start="2026-11-11T15:50:00"):
    spec = spec or endpoint()
    transport = Scripted({url: [(200, body(answer))]}, start=start)
    raw = capture(spec, Fetch(Session(transport, sleep=lambda s: None)))
    return raw, BEA.parse(raw)


def gdp(obs, **more):
    return {"code": "A191RX", "line": "1", "name": "Gross domestic product", "obs": obs, **more}


def test_a_quarterly_line_is_read_by_its_code_with_the_commas_taken_out_and_nothing_else_changed():
    raw, state = read(nipa([gdp([("2026Q1", "21,000,100"), ("2026Q2", "21,050,200.50"), ("2025Q4", "999")]),
                            {"code": "DPCERX", "line": "2", "obs": [("2026Q1", "14,000,000")]}]))
    assert raw.evidence.complete, raw.evidence.problems
    assert state.complete and list(state.series) == ["A191RX"]
    assert state.series["A191RX"] == [
        {"period": "2025-Q4", "value": "999", "status": "observed", "footnotes": []},
        {"period": "2026-Q1", "value": "21000100", "status": "observed", "footnotes": []},
        {"period": "2026-Q2", "value": "21050200.50", "status": "observed", "footnotes": []}]
    assert raw.evidence.checks["series"]["A191RX"] == {"rows": 3, "first": "2025-Q4", "last": "2026-Q2"}
    assert raw.evidence.checks["produced"] == "2026-11-11T15:50:00.000"
    assert "LastRevised: October 29, 2026" in raw.evidence.checks["note"]
    assert raw.evidence.scope["asked_on"] == "2026-11-11"
    assert BEA.coverage(raw.evidence.scope) == (None, None)  # the whole history, every time


def test_the_key_is_asked_for_by_name_and_is_not_in_the_request_that_is_kept():
    spec = endpoint()
    assert BEA.key(spec.params) == ("UserID", "BEA_API_KEY")
    echo = body(nipa([gdp([("2026Q1", "1")])], user=KEY))
    transport = LiveScripted({NIPA_URL + "&UserID=" + KEY: [(200, echo)]})
    fetch = Fetch(Session(transport, sleep=lambda s: None, keys={"BEA_API_KEY": KEY}))
    raw = capture(spec, fetch)
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.parts[0].request.url == NIPA_URL
    assert KEY.encode() not in raw.bodies[0] and raw.parts[0].key_removed == 1
    assert json.loads(raw.bodies[0])["BEAAPI"]["Request"]["RequestParam"][0]["ParameterValue"] == "REDACTED"


def test_months_and_years_are_read_as_such_and_a_negative_figure_keeps_its_sign():
    spec = endpoint(table="T20600", frequency="M", series=["A072RC"],
                    labels={"A072RC": {"line": "35", "unit": "Level", "multiplier": "0", "metric": "Ratio"}})
    url = NIPA_URL.replace("T10106", "T20600").replace("Frequency=Q", "Frequency=M")
    line = {"code": "A072RC", "line": "35", "mult": "0", "metric": "Ratio", "obs": [("2026M09", "-3.8"), ("2026M08", "4.0")]}
    _, state = read(nipa([line], table="T20600", frequency="M"), spec, url)
    assert [(o["period"], o["value"]) for o in state.series["A072RC"]] == [("2026-08", "4.0"), ("2026-09", "-3.8")]
    annual = endpoint(frequency="A")
    _, state = read(nipa([gdp([("2025", "20,000,000")])], frequency="A"), annual, NIPA_URL.replace("Frequency=Q", "Frequency=A"))
    assert state.series["A191RX"][0]["period"] == "2025"


def test_a_code_that_sits_on_two_lines_is_read_from_the_line_the_endpoint_pins():
    spec = endpoint(series=["A051RC"], labels={"A051RC": {"line": "13", "unit": "Level", "multiplier": "6",
                                                           "metric": "Current Dollars"}})
    lines = [{"code": "A051RC", "line": "13", "metric": "Current Dollars", "obs": [("2026Q1", "100")]},
             {"code": "A051RC", "line": "41", "metric": "Current Dollars", "obs": [("2026Q1", "100")]}]
    raw, state = read(nipa(lines), spec)
    assert raw.evidence.complete, raw.evidence.problems
    assert [o["period"] for o in state.series["A051RC"]] == ["2026-Q1"]


@pytest.mark.parametrize(("answer", "said"), [
    (bea_error(), "BEA says: 201 Error retrieving NIPA data. Invalid TableName was requested."),
    (nipa([gdp([("2026Q1", "1")])], table="T10105"), "the answer says it was asked for TableName T10105, not T10106"),
    (nipa([gdp([("2026Q1", "1")])], year="2026"), "the answer says it was asked for Year 2026, not ALL"),
    (nipa([{"code": "DPCERX", "line": "2", "obs": [("2026Q1", "1")]}]), "A191RX is not on line 1 of the answer"),
    (nipa([gdp([("2026Q1", "1")], line="3")]), "A191RX is not on line 1 of the answer"),
    (nipa([gdp([("2026Q1", "1")], mult="9")]),
     "A191RX is labelled unit 'Level', multiplier '9', metric 'Chained Dollars'; unit 'Level', multiplier '6', "
     "metric 'Chained Dollars' was expected"),
    (nipa([gdp([("2026Q1", "1")])], note="Table 1.1.6. [Billions of chained (2030) dollars]"),
     "neither the line of A191RX nor the table's note says 'chained (2017) dollars' (a rebase: every figure "
     "means something else)"),
    (nipa([gdp([("2026Q1", "1"), ("2026Q1", "2")])]), "A191RX gives 2026-Q1 twice"),
    (nipa([gdp([("2026M01", "1")])]), "A191RX has a time that is not a quarter: '2026M01'"),
    (nipa([gdp([("2026Q1", "(D)")])]), "A191RX has a value that is not a number for 2026-Q1: '(D)'"),
    (nipa([gdp([("2026Q1", "1,00")])]), "A191RX has a value that is not a number for 2026-Q1: '1,00'"),
    (nipa([gdp([("2027Q1", "1")])]), "A191RX has a value for 2027-Q1, a Period that had not begun on 2026-11-11"),
    (nipa([]), "the answer has no rows"),
    ({"BEAAPI": {"Results": {}}}, "the answer does not say what it was asked for"),
])
def test_an_answer_that_is_not_the_whole_of_what_was_asked_is_incomplete_and_says_why(answer, said):
    raw, state = read(answer)
    assert raw.evidence.complete is False and state.complete is False
    assert said in raw.evidence.problems, raw.evidence.problems
    assert state.series.get("A191RX", []) == [] or said.startswith(("A191RX gives", "A191RX has a value for 2027"))


def test_a_value_that_is_not_a_number_on_a_line_that_is_not_read_does_not_stop_the_lines_that_are():
    raw, _ = read(nipa([gdp([("2026Q1", "1")]), {"code": "X", "line": "9", "obs": [("2026Q1", "(D)")]}]))
    assert raw.evidence.complete, raw.evidence.problems


def test_a_body_that_is_not_json_is_incomplete():
    transport = Scripted({NIPA_URL: [(200, "<html>Service unavailable</html>")]})
    raw = capture(endpoint(), Fetch(Session(transport, sleep=lambda s: None)))
    assert raw.evidence.problems == ["the answer is not JSON"]


def test_the_balance_on_goods_and_services_is_read_from_the_international_accounts():
    spec = endpoint(**ITA_PARAMS)
    raw, state = read(ita([("2026Q1", "-190000"), ("2026Q2", "-199817")]), spec, ITA_URL)
    assert raw.evidence.complete, raw.evidence.problems
    assert state.series["TSI_ItaBalGdsServ_QSA"] == [
        {"period": "2026-Q1", "value": "-190000", "status": "observed", "footnotes": []},
        {"period": "2026-Q2", "value": "-199817", "status": "observed", "footnotes": []}]
    assert raw.evidence.checks["produced"] == "2026-09-24 08:30:00.000"
    raw, _ = read(ita([("2026Q1", "1")], area="Canada"), spec, ITA_URL)
    assert "the answer says it was asked for AreaOrCountry CANADA, not AllCountries" in raw.evidence.problems
    raw, _ = read(ita([("2026Q1", "1")], mult="9"), spec, ITA_URL)
    assert ("TSI_ItaBalGdsServ_QSA is labelled unit 'USD', multiplier '9'; unit 'USD', multiplier '6' "
            "was expected") in raw.evidence.problems


def test_an_old_capture_is_read_under_the_pins_it_was_asked_with_not_todays():
    raw, _ = read(nipa([gdp([("2026Q1", "1")])]))
    assert raw.evidence.scope["labels"] == {"A191RX": GDP}
    raw.evidence.scope["labels"]["A191RX"]["multiplier"] = "9"
    assert BEA.parse(raw).complete is False


@pytest.mark.parametrize(("params", "said"), [
    ({"read": "csv"}, "its read is not nipa or ita"),
    ({"table": "T1 0106"}, "it names no table"),
    ({"frequency": "W"}, "its frequency is not M, Q or A"),
    ({"series": []}, "it does not name its series"),
    ({"labels": {}}, "it does not pin the labels of A191RX"),
    ({"labels": {"A191RX": {"line": "1", "unit": "Level"}}}, "the labels of A191RX are not line, unit, multiplier, metric"),
    ({**ITA_PARAMS, "frequency": "M"}, "its frequency is not QSA, QNSA or A"),
])
def test_the_register_cannot_list_an_endpoint_the_adapter_could_not_read(params, said):
    entry = {"id": "bea-x", "adapter": "bea", "datasets": ["A table"],
             "params": {**endpoint().params, **params} if params.get("read") != "ita" else params}
    table = register(origin_row("bea", "U.S. Bureau of Economic Analysis", [entry]))
    with pytest.raises(RegisterError, match=said):
        endpoints_from_register(table)
