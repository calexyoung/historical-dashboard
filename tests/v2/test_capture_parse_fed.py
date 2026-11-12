"""The Federal Reserve Board adapter reads what it kept (PLAN M13): one Observation per Period
and series, the value as the Board printed it; files by day, week, month and quarter; a package
too large for one answer asked for in spans. Bodies here are small and invented."""
import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint

from .capture_helpers import Scripted

FED = ADAPTERS["fed_board"]
BASE = "https://www.federalreserve.gov/datadownload/Output.aspx"


def endpoint(expect, rel="H15", period=None, **params):
    params = {"rel": rel, "series": "abc", "expect": expect, **params}
    if period:
        params["period"] = period
    return Endpoint("fed-x", "fed-board", "fed_board", "Board of Governors of the Federal Reserve System",
                    ("H.15 Selected Interest Rates",), "direct", params)


def url(rel="H15", start="", end=""):
    return (f"{BASE}?rel={rel}&series=abc&lastobs=&from={start}&to={end}&filetype=csv"
            "&label=include&layout=seriescolumn")


def csv(names, rows, rel="H15", group=None, units=None, multipliers=None, currencies=None):
    def quoted(label, cells):
        return ",".join(f'"{cell}"' for cell in [label, *cells])

    head = [quoted("Series Description", ["d"] * len(names)),
            quoted("Unit:", units or ["Percent:_Per_Year"] * len(names)),
            quoted("Multiplier:", multipliers or ["1"] * len(names)),
            quoted("Currency:", currencies or ["NA"] * len(names)),
            quoted("Unique Identifier: ", [f"{rel}/{group or rel}/{name}" for name in names]),
            quoted("Time Period", names)]
    return "\n".join(head + rows) + "\n"


def fetch(spec, answers, start="2026-11-11T15:50:00"):
    transport = Scripted(answers, start=start)
    return capture(spec, Fetch(Session(transport, sleep=lambda s: None))), transport


def test_a_daily_file_gives_each_day_as_the_board_printed_it():
    body = csv(["A.B", "C.B"], ["2026-11-05,4.10,", "2026-11-06,ND,3.5", "2026-11-09,4.12,3.55"])
    raw, _ = fetch(endpoint(["A.B", "C.B"]), {url(): [(200, body)]})
    state = FED.parse(raw)
    assert state.complete is True
    assert state.series["A.B"] == [
        {"period": "2026-11-05", "value": "4.10", "status": "observed", "footnotes": []},
        # ND: the Board lists the day and prints no number for it.
        {"period": "2026-11-06", "value": None, "status": "unavailable",
         "footnotes": [{"code": "ND", "text": ""}]},
        {"period": "2026-11-09", "value": "4.12", "status": "observed", "footnotes": []},
    ]
    # An empty cell is no entry at all: the series had not begun.
    assert [o["period"] for o in state.series["C.B"]] == ["2026-11-06", "2026-11-09"]
    assert FED.coverage(state.scope) == (None, None)


@pytest.mark.parametrize("period, cells, labels", [
    ("month", ["2026-09", "2026-10"], ["2026-09", "2026-10"]),
    ("quarter", ["2026Q1", "2026Q2"], ["2026-Q1", "2026-Q2"]),
    # A Wednesday level is the Observation of the ISO week that Wednesday is in.
    ("week", ["2026-10-28", "2026-11-04"], ["2026-W44", "2026-W45"]),
])
def test_a_file_by_month_quarter_or_week_names_its_periods_the_atlas_way(period, cells, labels):
    body = csv(["A"], [f"{cell},1.5" for cell in cells])
    raw, _ = fetch(endpoint(["A"], period=period), {url(): [(200, body)]})
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.checks == {"rows": 2, "first": cells[0], "last": cells[1]}
    assert [o["period"] for o in FED.parse(raw).series["A"]] == labels


def test_the_identifier_row_may_name_a_group_other_than_the_release():
    # H.6 writes H6/H6_M2/M2.M; G.17 writes G17/IP_MARKET_GROUPS/IP.B50001.S.
    body = csv(["M2.M"], ["2026-09,23413.9"], rel="H6", group="H6_M2")
    raw, _ = fetch(endpoint(["M2.M"], rel="H6", period="month"), {url("H6"): [(200, body)]})
    assert raw.evidence.complete, raw.evidence.problems


@pytest.mark.parametrize("rows, problem", [
    (["2026-11,1.5"], "a data row is not a day and 1 cells: '2026-11'"),
    (["2026-11-05,1.5", "2026-11-05,1.6"], "the dates are not in order, or one appears twice"),
])
def test_a_time_cell_of_the_wrong_shape_is_not_whole(rows, problem):
    raw, _ = fetch(endpoint(["A"]), {url(): [(200, csv(["A"], rows))]})
    assert raw.evidence.complete is False
    assert problem in raw.evidence.problems


def test_an_empty_cell_between_two_values_is_a_fault_not_a_gap():
    # The Board leaves a cell empty only before a series begins and after it ends.
    body = csv(["A"], ["2026-11-05,4.10", "2026-11-06,", "2026-11-09,4.12", "2026-11-10,"])
    raw, _ = fetch(endpoint(["A"]), {url(): [(200, body)]})
    assert raw.evidence.problems == ["A has an empty cell for 2026-11-06, between two Periods it has entries for"]
    assert FED.parse(raw).complete is False


def test_two_wednesdays_in_one_week_are_not_whole():
    body = csv(["A"], ["2026-11-03,1.5", "2026-11-04,1.6"])
    raw, _ = fetch(endpoint(["A"], period="week"), {url(): [(200, body)]})
    assert raw.evidence.complete is False
    assert "A gives 2026-W45 twice" in raw.evidence.problems


@pytest.mark.parametrize("cell", ["n/a", "1,234", "--", "1.5e3", "4.1 "])
def test_a_cell_that_is_neither_a_number_nor_a_known_code_is_a_fault(cell):
    body = csv(["A"], ["2026-11-05,4.10", f'2026-11-06,"{cell}"'])
    raw, _ = fetch(endpoint(["A"]), {url(): [(200, body)]})
    assert raw.evidence.complete is False
    assert f"A has a cell that is not a number, ND, NA, NC or empty for 2026-11-06: {cell!r}" \
        in raw.evidence.problems
    state = FED.parse(raw)
    assert state.complete is False
    assert [o["period"] for o in state.series["A"]] == ["2026-11-05"]  # nothing invented


def test_a_unit_or_multiplier_that_changed_is_not_whole():
    # Net worth is printed in millions. If the Board printed billions one day, every figure
    # would be wrong by a thousand and look fine.
    spec = endpoint(["FL.Q"], rel="Z1", period="quarter",
                    labels={"FL.Q": {"unit": "Currency", "multiplier": "1000000", "currency": "USD"}})
    good = csv(["FL.Q"], ["2026Q2,195870496"], rel="Z1", units=["Currency"], multipliers=["1000000"],
               currencies=["USD"])
    bad = csv(["FL.Q"], ["2026Q2,195870"], rel="Z1", units=["Currency"], multipliers=["1e+09"],
              currencies=["USD"])
    raw, _ = fetch(spec, {url("Z1"): [(200, good)]})
    assert raw.evidence.complete, raw.evidence.problems
    raw, _ = fetch(spec, {url("Z1"): [(200, bad)]})
    assert ("FL.Q is labelled unit 'Currency', multiplier '1e+09', currency 'USD'; "
            "unit 'Currency', multiplier '1000000', currency 'USD' was expected") in raw.evidence.problems
    assert FED.parse(raw).complete is False


def test_a_package_too_large_for_one_answer_is_asked_for_in_spans():
    spec = endpoint(["A.B"], rel="H10", from_years=[1971, 1990, 2010])
    answers = {
        url("H10", "01%2F01%2F1971", "12%2F31%2F1989"): [(200, csv(["A.B"], ["1971-01-04,1.1", "1989-12-29,1.2"], rel="H10"))],
        url("H10", "01%2F01%2F1990", "12%2F31%2F2009"): [(200, csv(["A.B"], ["1990-01-01,ND", "2009-12-31,1.3"], rel="H10"))],
        # The last span runs to the end of this year in New York; an open end is not answered.
        url("H10", "01%2F01%2F2010", "12%2F31%2F2026"): [(200, csv(["A.B"], ["2010-01-01,ND", "2026-11-06,1.4"], rel="H10"))],
    }
    raw, transport = fetch(spec, answers)
    assert len(transport.sent) == 3
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.scope["spans"] == [["1971-01-01", "1989-12-31"], ["1990-01-01", "2009-12-31"],
                                           ["2010-01-01", "2026-12-31"]]
    assert raw.evidence.checks == {"rows": 6, "first": "1971-01-04", "last": "2026-11-06"}
    state = FED.parse(raw)
    assert [o["value"] for o in state.series["A.B"]] == ["1.1", "1.2", None, "1.3", None, "1.4"]
    assert FED.coverage(state.scope) == ("1971-01-01", "2026-12-31")


def test_a_span_that_answers_outside_itself_or_with_other_columns_is_not_whole():
    spec = endpoint(["A.B"], rel="H10", from_years=[1990, 2010])
    answers = {
        url("H10", "01%2F01%2F1990", "12%2F31%2F2009"): [(200, csv(["A.B"], ["1990-01-01,1", "2010-01-04,1.3"], rel="H10"))],
        url("H10", "01%2F01%2F2010", "12%2F31%2F2026"): [(200, csv(["Z.B"], ["2010-01-04,1"], rel="H10"))],
    }
    raw, _ = fetch(spec, answers)
    assert "part 1 has 2010-01-04, outside the span asked for" in raw.evidence.problems
    assert "part 2: the columns are not the series expected" in raw.evidence.problems
    assert FED.parse(raw).complete is False


def test_an_empty_answer_is_asked_for_again_and_then_kept_as_not_whole():
    spec = endpoint(["A"])
    raw, transport = fetch(spec, {url(): [(200, ""), (200, csv(["A"], ["2026-11-05,1"]))]})
    assert len(transport.sent) == 2 and raw.evidence.complete
    assert raw.parts[0].tries == ["HTTP 200 with an empty body"]
    raw, _ = fetch(spec, {url(): [(200, "")] * 4})
    assert raw.evidence.problems == ["the file does not begin with the six label rows"]


@pytest.mark.parametrize("params, problem", [
    ({"period": "year"}, "its period is not day, week, month or quarter"),
    ({"from_years": [1990, 1971]}, "its from_years are not years in order"),
    ({"from_years": []}, "its from_years are not years in order"),
    ({"labels": {"B": {"unit": "x", "multiplier": "1", "currency": "NA"}}},
     "its labels name B, which it does not expect"),
    ({"labels": {"A": {"unit": "x"}}}, "its labels do not give a unit, a multiplier and a currency for A"),
])
def test_params_the_adapter_cannot_use_are_refused_when_the_register_is_read(params, problem):
    assert FED.problem({"rel": "H15", "series": "abc", "expect": ["A"], **params}) == problem
