"""BLS coverage (PLAN M13): quarterly series, the Bureau's "revised" mark, and a window longer
than the ten years one keyless request may span. Bodies here are small and invented."""
import json

import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint

from .capture_helpers import Scripted

BLS = ADAPTERS["bls"]
URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


def endpoint(series, years=10):
    return Endpoint("bls-x", "bls", "bls", "U.S. Bureau of Labor Statistics", ("x",), "direct",
                    {"series": series, "years": years})


def row(year, period, value, code=None):
    return {"year": str(year), "period": period, "periodName": "x", "value": value,
            "footnotes": [{"code": code, "text": code}] if code else [{}]}


def answer(series, message=()):
    return json.dumps({"status": "REQUEST_SUCCEEDED", "responseTime": 1, "message": list(message),
                       "Results": {"series": [{"seriesID": k, "data": v} for k, v in series.items()]}})


def fetch(spec, answers):
    transport = Scripted({URL: [(200, body) for body in answers]})
    return capture(spec, Fetch(Session(transport, sleep=lambda s: None))), transport


def test_a_quarterly_series_is_read_by_quarter_and_revised_means_revised():
    raw, _ = fetch(endpoint(["PRS85006173"]), [answer({"PRS85006173": [
        row(2026, "Q03", "93.729"), row(2026, "Q02", "94.362", "R"), row(2025, "Q04", "-", "10")]})])
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.checks["series"]["PRS85006173"] == {"rows": 3, "first": "2025-Q4", "last": "2026-Q3"}
    state = BLS.parse(raw)
    assert [(o["period"], o["value"], o["status"]) for o in state.series["PRS85006173"]] == [
        ("2025-Q4", None, "unavailable"), ("2026-Q2", "94.362", "revised"), ("2026-Q3", "93.729", "observed")]


def test_preliminary_outranks_revised_and_a_dash_outranks_both():
    marks = [{"code": "R", "text": "revised"}, {"code": "P", "text": "preliminary"}]
    raw, _ = fetch(endpoint(["A"]), [answer({"A": [
        {**row(2026, "M02", "2.5"), "footnotes": marks}, {**row(2026, "M01", "-"), "footnotes": marks}]})])
    assert [o["status"] for o in BLS.parse(raw).series["A"]] == ["unavailable", "preliminary"]


def test_a_series_that_mixes_months_and_quarters_is_not_whole():
    raw, _ = fetch(endpoint(["A"]), [answer({"A": [row(2026, "Q01", "1"), row(2026, "M01", "1")]})])
    assert "series A gives both months and quarters" in raw.evidence.problems
    assert BLS.parse(raw).complete is False


@pytest.mark.parametrize("period", ["Q05", "Q00", "Q1", "S01", "A01"])
def test_a_period_the_adapter_does_not_know_is_not_guessed_at(period):
    raw, _ = fetch(endpoint(["A"]), [answer({"A": [row(2026, period, "1")]})])
    assert f"series A has a row that is not a month or a quarter: 2026 {period}" in raw.evidence.problems


def test_a_window_longer_than_ten_years_is_asked_for_ten_years_at_a_time():
    # v1 began in 2000; one keyless request spans ten years. Thirty years is three requests.
    bodies = [answer({"A": [row(2006, "M12", "3"), row(1997, "M01", "1")]}),
              answer({"A": [row(2016, "M12", "5"), row(2007, "M01", "4")]}),
              answer({"A": [row(2026, "M10", "7"), row(2017, "M01", "6")]})]
    raw, transport = fetch(endpoint(["A"], years=30), bodies)
    assert [json.loads(r.body) for r in transport.sent] == [
        {"seriesid": ["A"], "startyear": "1997", "endyear": "2006"},
        {"seriesid": ["A"], "startyear": "2007", "endyear": "2016"},
        {"seriesid": ["A"], "startyear": "2017", "endyear": "2026"}]
    assert raw.evidence.complete, raw.evidence.problems
    assert raw.evidence.scope == {"series": ["A"], "start_year": 1997, "end_year": 2026}
    state = BLS.parse(raw)
    assert [o["value"] for o in state.series["A"]] == ["1", "3", "4", "5", "6", "7"]
    assert BLS.coverage(state.scope) == ("1997-01-01", "2026-12-31")


def test_each_part_of_a_long_window_must_be_whole_and_stay_in_its_own_years():
    good = answer({"A": [row(1997, "M01", "1")]})
    bodies = [good, answer({"A": [row(2017, "M01", "4")]}),
              answer({"A": [row(2017, "M02", "6")]}, message=["No Data Available for Series A Year: 2020"])]
    raw, _ = fetch(endpoint(["A"], years=30), bodies)
    assert "part 2: series A has 2017-01, outside the years asked for" in raw.evidence.problems
    assert "part 3: BLS says: No Data Available for Series A Year: 2020" in raw.evidence.problems
    assert BLS.parse(raw).complete is False


def test_a_window_is_at_most_a_hundred_years():
    assert BLS.problem({"series": ["A"], "years": 101}) == "years is not between 1 and 100"
