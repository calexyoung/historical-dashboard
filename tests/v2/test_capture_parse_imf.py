"""The IMF SDMX adapter reads what it kept (PLAN M14): one Observation per Period and series,
the value as the Fund printed it, and for each value whether the Fund calls it observed, an
estimate or a projection. Bodies here are small and every value in them is invented: the
shapes are the Fund's, the numbers are not."""
import json

import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint
from atlas.capture.run import RegisterError, endpoints_from_register

from .capture_helpers import Scripted, origin_row, register
from .imf_helpers import ER_DIMENSIONS, answer, body

IMF = ADAPTERS["imf_sdmx"]
BASE = "https://api.imf.org/external/sdmx/3.0/data/dataflow"
JPN, USA = "JPN.CPI._T.IX.M", "USA.CPI._T.IX.M"


def endpoint(series, flow="CPI", **params):
    return Endpoint("imf-x", "imf", "imf_sdmx", "International Monetary Fund", ("Consumer Price Index",),
                    "direct", {"agency": "IMF.STA", "flow": flow, "series": series, **params})


def url(key, flow="CPI"):
    return f"{BASE}/IMF.STA/{flow}/+/{key}?dimensionAtObservation=TIME_PERIOD"


def fetch(spec, answers, start="2026-11-11T15:50:00"):
    transport = Scripted(answers, start=start)
    return capture(spec, Fetch(Session(transport, sleep=lambda s: None))), transport


def read(series, spec=None, **how):
    spec = spec or endpoint(list(series))
    key = ".".join("+".join(dict.fromkeys(parts)) for parts in zip(*(k.split(".") for k in spec.params["series"]), strict=True))
    raw, _ = fetch(spec, {url(key, spec.params["flow"]): [(200, body(series, **how))]})
    return raw, IMF.parse(raw)


def test_a_monthly_series_gives_each_month_as_the_fund_printed_it():
    raw, state = read({JPN: {"obs": [("2026-M09", "101.5", "O"), ("2026-M07", "101.2", "O"),
                                     ("2026-M08", "101.30", "O")]}})
    assert raw.evidence.complete, raw.evidence.problems
    assert state.complete is True
    # The Fund lists times in no order; the value is its own text, never a rounded number.
    assert state.series[JPN] == [
        {"period": "2026-07", "value": "101.2", "status": "observed", "footnotes": []},
        {"period": "2026-08", "value": "101.30", "status": "observed", "footnotes": []},
        {"period": "2026-09", "value": "101.5", "status": "observed", "footnotes": []},
    ]
    assert raw.evidence.scope == {"agency": "IMF.STA", "flow": "CPI", "series": [JPN], "asked_on": "2026-11-11"}
    assert raw.evidence.checks == {"dataflow": "IMF.STA:CPI(5.0.0)",
                                   "series": {JPN: {"rows": 3, "first": "2026-07", "last": "2026-09"}}}
    # The whole history is asked for every time: a Period that has left the answer is gone.
    assert IMF.coverage(state.scope) == (None, None)


def test_several_countries_are_asked_for_in_one_request():
    series = {JPN: {"obs": [("2026-M09", "101.5", "O")]}, USA: {"obs": [("2026-M09", "120.52", "O")]}}
    raw, transport = fetch(endpoint([JPN, USA]), {url("JPN+USA.CPI._T.IX.M"): [(200, body(series))]})
    assert raw.evidence.complete, raw.evidence.problems
    assert [request.method for request in transport.sent] == ["GET"]
    assert sorted(IMF.parse(raw).series) == [JPN, USA]


def test_the_fund_says_what_is_observed_what_is_estimated_and_what_is_projected():
    # DERIVATION_TYPE, per Observation: O reported official data, R raw data, SE and its kin
    # IMF staff estimates, SP IMF staff projections (the Fund's CL_DERIVATION_TYPE, read 2026-11-11).
    key = "USA.NGDP_RPCH.A"
    spec = endpoint([key], flow="X")
    obs = [("2023", "2.9", "O"), ("2024", "2.8", "R"), ("2025", "2.0", "SE"), ("2026", "1.9", "SEHI"),
           ("2027", "2.1", "SP"), ("2031", "1.8", "SP")]
    _, state = read({key: {"obs": obs}}, spec, flow="X", dimensions=("COUNTRY", "INDICATOR", "FREQUENCY"))
    assert state.complete, state.problems
    assert [(o["period"], o["status"]) for o in state.series[key]] == [
        ("2023", "observed"), ("2024", "observed"), ("2025", "estimate"), ("2026", "estimate"),
        ("2027", "projected"), ("2031", "projected")]


@pytest.mark.parametrize("derivation, said", [
    (None, "no derivation type"), ("SC", "the derivation type 'SC'"), ("M", "the derivation type 'M'")])
def test_a_value_the_fund_does_not_call_observed_estimated_or_projected_is_not_guessed(derivation, said):
    raw, state = read({JPN: {"obs": [("2026-M08", "101.3", "O"), ("2026-M09", "101.5", derivation)]}})
    assert raw.evidence.complete is False and state.complete is False
    assert raw.evidence.problems == [
        (f"{JPN} has {said} for 2026-09: whether that value is observed, an estimate or a "
         "projection is not said, and it is not guessed")]


@pytest.mark.parametrize("derivation", ["O", "SE"])
def test_a_value_for_a_period_that_has_not_begun_is_whole_only_as_a_projection(derivation):
    # Fetched on 11 November 2026: December has not begun.
    raw, _ = read({JPN: {"obs": [("2026-M11", "101.6", "O"), ("2026-M12", "101.7", derivation)]}})
    assert raw.evidence.problems == [(f"{JPN} has a value for 2026-12, a Period that had not begun on "
                                      "2026-11-11, and does not call it a projection")]
    raw, state = read({JPN: {"obs": [("2026-M11", "101.6", "O"), ("2026-M12", "101.7", "SP")]}})
    assert raw.evidence.complete and state.series[JPN][-1]["status"] == "projected"


def test_quarters_and_years_are_named_the_atlas_way():
    q, a = "AUS.CPI._T.IX.Q", "AUS.CPI._T.IX.A"
    _, state = read({q: {"obs": [("2026-Q2", "101.5", "O"), ("2026-Q1", "101", "O")]}})
    assert [o["period"] for o in state.series[q]] == ["2026-Q1", "2026-Q2"]
    _, state = read({a: {"obs": [("2025", "100", "O")]}})
    assert [o["period"] for o in state.series[a]] == ["2025"]


@pytest.mark.parametrize("time", ["2026-09", "2026-M13", "2026-Q3", "2026", "September 2026", "2026-M9"])
def test_a_time_that_is_not_of_the_series_frequency_keeps_the_answer_from_being_whole(time):
    raw, _ = read({JPN: {"obs": [("2026-M08", "101.3", "O"), (time, "101.5", "O")]}})
    assert raw.evidence.problems == [f"{JPN} has a time that is not a month: {time!r}"]


def test_nulls_before_the_first_number_are_padding_and_later_ones_are_missing_months():
    # Japan's index is listed from 1900-M01 with no number until 1955 (seen 2026-11-11).
    obs = [("1900-M01", None, "O"), ("1900-M02", None, "O"), ("1955-M01", "16.12345678901234", "O"),
           ("1955-M02", None, "O"), ("1955-M03", "16.8", "O"), ("1955-M04", None, None)]
    raw, state = read({JPN: {"obs": obs}})
    assert state.complete, state.problems
    assert state.series[JPN] == [
        {"period": "1955-01", "value": "16.12345678901234", "status": "observed", "footnotes": []},
        {"period": "1955-02", "value": None, "status": "unavailable", "footnotes": []},
        {"period": "1955-03", "value": "16.8", "status": "observed", "footnotes": []},
        # After the last number too: the Fund lists the month and prints nothing for it.
        {"period": "1955-04", "value": None, "status": "unavailable", "footnotes": []},
    ]
    assert raw.evidence.checks["series"][JPN] == {"rows": 4, "first": "1955-01", "last": "1955-04"}


def test_a_month_the_fund_does_not_list_is_no_entry_at_all():
    # The United States has no October 2025 in the Fund's file (seen 2026-11-11).
    _, state = read({USA: {"obs": [("2025-M09", "150.1", "O"), ("2025-M11", "150.9", "O")]}})
    assert state.complete and [o["period"] for o in state.series[USA]] == ["2025-09", "2025-11"]


def test_very_small_and_very_long_figures_are_kept_as_text():
    # A rate from before a redenomination, in today's unit, with as many decimals as the Fund prints.
    key = "ARG.XDC_USD.PA_RT.M"
    spec = endpoint([key], flow="ER")
    _, state = read({key: {"obs": [("1962-M05", "0.0000000000100000000123", "R")]}}, spec,
                    flow="ER", dimensions=ER_DIMENSIONS)
    assert state.complete and state.series[key][0]["value"] == "0.0000000000100000000123"


@pytest.mark.parametrize("value", [101.5, "1.1e2", "", "n/a", True, ["101.5"]])
def test_a_value_that_is_not_plain_decimal_text_or_null_is_a_fault(value):
    raw, state = read({JPN: {"obs": [("2026-M08", "101.3", "O"), ("2026-M09", value, "O")]}})
    assert not state.complete
    assert raw.evidence.problems == [f"{JPN} has a value that is not a number in text or null for 2026-09: {value!r}"]


def test_a_mark_the_endpoint_accepts_rides_along_and_changes_nothing():
    key = "CHN.XDC_USD.PA_RT.M"
    spec = endpoint([key], flow="ER", marks=["T"])
    raw, state = read({key: {"obs": [("1993-M12", "5.5", "R"), ("1994-M01", "8.5", "R", "T")]}}, spec,
                      flow="ER", dimensions=ER_DIMENSIONS)
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.scope["marks"] == ["T"]
    assert state.series[key][1] == {"period": "1994-01", "value": "8.5", "status": "observed",
                                    "footnotes": [{"code": "T", "text": ""}]}


@pytest.mark.parametrize("mark", ["F", "E", "P", "T"])
def test_a_mark_nobody_has_looked_at_keeps_the_answer_from_being_whole(mark):
    # STATUS is free text with no list of codes behind it: a letter is never read for a meaning.
    raw, _ = read({JPN: {"obs": [("2026-M09", "101.5", "O", mark)]}})
    assert raw.evidence.problems == [(f"{JPN} carries the mark {mark!r} for 2026-09, which the endpoint "
                                      "does not list among the marks it has seen (its marks)")]


def test_a_pinned_reference_period_that_has_changed_is_a_rebase_and_not_a_whole_answer():
    spec = endpoint([JPN, USA], reference={JPN: "2020A", USA: "2010A"})
    series = {JPN: {"obs": [("2026-M09", "100.5", "O")], "reference": "2025A"},
              USA: {"obs": [("2026-M09", "120.52", "O")], "reference": "2010A"}}
    raw, state = read(series, spec)
    assert not state.complete
    assert raw.evidence.problems == [(f"{JPN} is on the reference period '2025A'; '2020A' was expected "
                                      "(a rebase: every figure means something else)")]
    series[JPN]["reference"] = "2020A"
    raw, _ = read(series, spec)
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.checks["series"][JPN]["reference"] == "2020A"


def test_an_observation_on_another_reference_period_than_its_series_is_a_fault():
    spec = endpoint([JPN], reference={JPN: "2020A"})
    whole = answer({JPN: {"obs": [("2026-M08", "101.3", "O"), ("2026-M09", "101.5", "O")], "reference": "2020A"}})
    row = whole["data"]["dataSets"][0]["series"]["0:0:0:0:0"]["observations"]["1"]
    row[3] = "2015A"
    raw, _ = fetch(spec, {url(JPN): [(200, json.dumps(whole))]})
    assert raw.evidence.problems == [f"{JPN} gives 2026-09 on the reference period '2015A'; '2020A' was expected"]


def test_a_scale_other_than_units_is_a_fault():
    raw, _ = read({JPN: {"obs": [("2026-M09", "101.5", "O")], "scale": "3"}})
    assert raw.evidence.problems == [f"{JPN} is scaled by 10^3; a scale of 0 (units) was expected"]


def test_what_was_asked_for_and_what_came_back_must_be_the_same_series():
    series = {JPN: {"obs": [("2026-M09", "101.5", "O")]}, "DEU.CPI._T.IX.M": {"obs": [("2026-M09", "110.6", "O")]}}
    raw, state = read(series, endpoint([JPN, USA]))
    assert raw.evidence.problems == ["DEU.CPI._T.IX.M was not asked for", f"{USA} is not in the answer"]
    assert sorted(state.series) == [JPN]
    raw, _ = read({JPN: {"obs": [("2026-M09", None, "O")]}})
    assert raw.evidence.problems == [f"{JPN} is in the answer without a single number"]


def test_an_answer_for_another_dataflow_is_not_this_one():
    raw, _ = read({JPN: {"obs": [("2026-M09", "101.5", "O")]}}, flow="CPI_WCA")
    assert raw.evidence.problems == ["the answer does not say it is the dataflow IMF.STA:CPI"]


def test_attributes_are_read_by_name_wherever_the_fund_puts_them():
    reordered = ("STATUS", "REFERENCE_PERIOD", "DERIVATION_TYPE")
    spec = endpoint([JPN], reference={JPN: "2020A"})
    _, state = read({JPN: {"obs": [("2026-M09", "101.5", "SP")], "reference": "2020A"}}, spec,
                    observation_attributes=reordered,
                    series_attributes=("COMMON_REFERENCE_PERIOD", "SCALE"))
    assert state.complete, state.problems
    assert state.series[JPN][0]["status"] == "projected"


def test_dimensions_are_read_by_their_key_position():
    # Two series that differ in two dimensions, so no position is all zeros. The answer then
    # lists its dimensions in another order, with each series' positions in that order.
    a, b = "JPN.XDC_USD.PA_RT.M", "USA.XDC_USD.EOP_RT.M"
    spec = endpoint([a, "JPN.XDC_USD.EOP_RT.M", "USA.XDC_USD.PA_RT.M", b], flow="ER")
    whole = answer({a: {"obs": [("2026-M09", "150.5", "R")]},
                    "JPN.XDC_USD.EOP_RT.M": {"obs": [("2026-M09", "151.5", "R")]},
                    "USA.XDC_USD.PA_RT.M": {"obs": [("2026-M09", "1.5", "R")]},
                    b: {"obs": [("2026-M09", "2.5", "R")]}}, flow="ER", dimensions=ER_DIMENSIONS)
    structure, data = whole["data"]["structures"][0], whole["data"]["dataSets"][0]
    assert sorted(data["series"]) == ["0:0:0:0", "0:0:1:0", "1:0:0:0", "1:0:1:0"]
    structure["dimensions"]["series"].reverse()
    data["series"] = {":".join(reversed(index.split(":"))): entry for index, entry in data["series"].items()}
    raw, _ = fetch(spec, {url("JPN+USA.XDC_USD.PA_RT+EOP_RT.M", "ER"): [(200, json.dumps(whole))]})
    assert raw.evidence.complete, raw.evidence.problems
    state = IMF.parse(raw)
    assert {key: rows[0]["value"] for key, rows in state.series.items()} == {
        a: "150.5", "JPN.XDC_USD.EOP_RT.M": "151.5", "USA.XDC_USD.PA_RT.M": "1.5", b: "2.5"}


def test_an_attribute_or_a_dimension_described_twice_is_not_read_at_all():
    # A second DERIVATION_TYPE saying "O" after the first said "SP" must not make a projection observed.
    whole = answer({JPN: {"obs": [("2026-M09", "101.5", "SP")]}})
    described = whole["data"]["structures"][0]["attributes"]["observation"]
    described.append({**described[1], "values": [{"id": "O"}]})
    whole["data"]["dataSets"][0]["series"]["0:0:0:0:0"]["observations"]["0"].append(0)
    raw, _ = fetch(endpoint([JPN]), {url(JPN): [(200, json.dumps(whole))]})
    assert raw.evidence.problems == ["the answer describes DERIVATION_TYPE twice"]
    assert IMF.parse(raw).series == {}
    whole = answer({JPN: {"obs": [("2026-M09", "101.5", "O")]}})
    dimensions = whole["data"]["structures"][0]["dimensions"]["series"]
    dimensions[1]["id"] = dimensions[0]["id"]
    raw, _ = fetch(endpoint([JPN]), {url(JPN): [(200, json.dumps(whole))]})
    assert raw.evidence.problems == ["the answer describes COUNTRY twice"]


def damaged(change):
    whole = answer({JPN: {"obs": [("2026-M08", "101.3", "O"), ("2026-M09", "101.5", "O")]}})
    change(whole["data"])
    return json.dumps(whole)


@pytest.mark.parametrize("change, said", [
    (lambda d: d["dataSets"].append(d["dataSets"][0]), "the answer does not hold exactly one data set and one structure"),
    (lambda d: d.pop("structures"), "the answer does not hold exactly one data set and one structure"),
    (lambda d: d["dataSets"][0].update(series={"0:0:0:0:9": d["dataSets"][0]["series"]["0:0:0:0:0"]}),
     "the answer has a series whose key is not in its own lists: '0:0:0:0:9'"),
    (lambda d: d["dataSets"][0].update(series={"0:0:0:0": d["dataSets"][0]["series"]["0:0:0:0:0"]}),
     "the answer has a series whose key is not in its own lists: '0:0:0:0'"),
    (lambda d: d["dataSets"][0]["series"]["0:0:0:0:0"]["observations"].update({"7": ["1", None, 0, None, None]}),
     f"{JPN} has an observation whose time is not in the answer's own list: '7'"),
    (lambda d: d["dataSets"][0]["series"]["0:0:0:0:0"]["observations"].update({"1": ["101.5", None, 4, None, None]}),
     f"{JPN} has an attribute DERIVATION_TYPE that is not in the answer's own list of codes for 2026-09"),
    (lambda d: d["dataSets"][0]["series"]["0:0:0:0:0"]["observations"].update({"1": "101.5"}),
     f"{JPN} has an observation that is not a list for 2026-09"),
    (lambda d: d["structures"][0]["dimensions"]["observation"][0]["values"].append({"value": "2026-M09"}) or
     d["dataSets"][0]["series"]["0:0:0:0:0"]["observations"].update({"2": ["101.6", None, 0, None, None]}),
     f"{JPN} gives 2026-09 twice"),
    (lambda d: d["structures"][0]["measures"].update(observation=[]), "the answer does not describe its observations as OBS_VALUE and attributes"),
    (lambda d: d["dataSets"][0].update(series={}), f"{JPN} is not in the answer"),
])
def test_an_answer_out_of_shape_is_never_whole(change, said):
    raw, _ = fetch(endpoint([JPN]), {url(JPN): [(200, damaged(change))]})
    assert raw.evidence.complete is False
    # The first thing said; a series that could not be read is then also not in the answer.
    assert raw.evidence.problems[0] == said and len(raw.evidence.problems) <= 2
    assert IMF.parse(raw).complete is False


@pytest.mark.parametrize("text", ["<html>busy</html>", "[]", '{"data": 3}', '{"meta": {}}'])
def test_an_answer_that_is_not_the_message_is_never_whole(text):
    raw, _ = fetch(endpoint([JPN]), {url(JPN): [(200, text)]})
    assert raw.evidence.complete is False and IMF.parse(raw).series == {}


@pytest.mark.parametrize("params, said", [
    ({"flow": "CPI", "series": [JPN]}, "it names no agency and dataflow"),
    ({"agency": "IMF.STA", "flow": "C PI", "series": [JPN]}, "it names no agency and dataflow"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": []}, "it does not name its series as distinct SDMX keys"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": [JPN, JPN]}, "it does not name its series as distinct SDMX keys"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": ["JPN.CPI._T.IX.M", "USA.CPI.M"]}, "its series keys are not all of one length"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": ["JPN.CPI._T.IX.D"]}, "its series are not monthly (M), quarterly (Q) or annual (A)"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": ["JPN.CPI+X._T.IX.M"]}, "it does not name its series as distinct SDMX keys"),
    # One request asks for every combination of the parts named: the list must be exactly that.
    ({"agency": "IMF.STA", "flow": "CPI", "series": ["JPN.CPI._T.IX.M", "USA.CPI._T.PC.M"]},
     "its series are not every combination of their parts, so one request cannot ask for exactly them"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": [JPN], "reference": {USA: "2010A"}},
     f"its reference names {USA}, which it does not ask for"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": [JPN], "reference": {JPN: 2020}}, "its reference periods are not text"),
    ({"agency": "IMF.STA", "flow": "CPI", "series": [JPN], "marks": "T"}, "its marks are not a list of distinct marks"),
])
def test_an_endpoint_the_adapter_cannot_ask_for_is_refused_when_the_register_is_read(params, said):
    table = register(origin_row("imf", "International Monetary Fund",
                                [{"id": "imf-x", "adapter": "imf_sdmx", "datasets": ["Consumer Price Index"],
                                  "params": params}]))
    with pytest.raises(RegisterError, match="row imf, endpoint imf-x: ") as refused:
        endpoints_from_register(table)
    assert str(refused.value).endswith(said)
