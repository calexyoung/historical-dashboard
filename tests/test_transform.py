from collections import OrderedDict

import pytest

from atlas.sources import parse_fred_csv, parse_yahoo_json, FetchError
from atlas.transform import (add_months, assemble, expand_approval, forward_fill_plot, rounded,
                             to_monthly, yoy)


def test_monthly_mean_vs_last():
    obs = [("2020-01-03", 1.0), ("2020-01-10", 2.0), ("2020-01-31", 6.0), ("2020-02-07", 4.0)]
    assert to_monthly(obs, "mean") == OrderedDict([("2020-01", 3.0), ("2020-02", 4.0)])
    assert to_monthly(obs, "last") == OrderedDict([("2020-01", 6.0), ("2020-02", 4.0)])


def test_monthly_unsorted_input_last_is_latest_date():
    obs = [("2020-01-31", 6.0), ("2020-01-03", 1.0)]
    assert to_monthly(obs, "last")["2020-01"] == 6.0


def test_quarterly_lands_on_observation_month():
    obs = [("2020-01-01", 100.0), ("2020-04-01", 101.0)]
    assert list(to_monthly(obs, "mean")) == ["2020-01", "2020-04"]


def test_add_months():
    assert add_months("2000-01", -1) == "1999-12"
    assert add_months("1999-12", 13) == "2001-01"
    assert add_months("2020-06", 0) == "2020-06"


def test_yoy_math():
    m = OrderedDict((f"2020-{i:02d}", 100.0) for i in range(1, 13))
    m["2021-01"] = 110.0
    assert yoy(m) == OrderedDict([("2021-01", pytest.approx(10.0))])


def test_yoy_quarterly_only_on_observation_months():
    m = OrderedDict([("2020-01", 100.0), ("2020-04", 100.0), ("2021-01", 105.0), ("2021-04", 98.0)])
    out = yoy(m)
    assert list(out) == ["2021-01", "2021-04"]
    assert out["2021-04"] == pytest.approx(-2.0)


def test_yoy_skips_zero_base():
    m = OrderedDict([("2020-01", 0.0), ("2021-01", 5.0)])
    assert yoy(m) == OrderedDict()


def test_rounding_levels_vs_percent_and_clip():
    m = OrderedDict([("1999-12", 1.0), ("2000-01", 1.23456), ("2000-02", 2.0)])
    assert rounded(m, "index") == {"d": ["2000-01", "2000-02"], "v": [1.235, 2.0]}
    assert rounded(m, "%")["v"] == [1.23, 2.0]
    assert rounded(m, "pp")["v"] == [1.23, 2.0]


def test_forward_fill_stop_rules():
    a = [1.0, None, None, None, None]
    assert forward_fill_plot(a, 0, "Q") == [1.0, 1.0, 1.0, None, None]
    a = [1.0] + [None] * 14
    out = forward_fill_plot(a, 0, "A")
    assert out[11] == 1.0 and out[12] is None


def test_forward_fill_between_observations():
    a = [1.0, None, None, 2.0, None, None, None]
    assert forward_fill_plot(a, 3, "Q") == [1.0, 1.0, 1.0, 2.0, 2.0, 2.0, None]


def test_approval_expansion_skips_null():
    s = expand_approval({2026: [38, 37, 37, None]})
    assert s["d"][0] == "2026-01" and s["d"][-1] == "2026-09" and len(s["v"]) == 9
    assert s["v"][3] == 37


def test_parse_fred_csv_missing_values_and_html_error():
    text = "observation_date,X\n2020-01-01,1.5\n2020-02-01,.\n2020-03-01,2\n"
    assert parse_fred_csv(text, "X") == [("2020-01-01", 1.5), ("2020-03-01", 2.0)]
    with pytest.raises(FetchError):
        parse_fred_csv("<!DOCTYPE html><html>error</html>", "BAD")


def test_parse_yahoo_uses_exchange_offset_and_dedupes():
    # Nikkei month start 2020-02-01 00:00 JST = 2020-01-31 15:00 UTC
    payload = {"chart": {"result": [{
        "meta": {"gmtoffset": 32400},
        "timestamp": [1580482800, 1580482800 + 86400 * 20, 1580482800 + 86400 * 35],
        "indicators": {"quote": [{"close": [100.0, 110.0, None]}]},
    }]}}
    out = parse_yahoo_json(payload, "^N225")
    assert out == [("2020-02-01", 110.0)]  # partial-month bar replaces the month-start bar; null dropped


def test_assemble_emits_derived_yoy_with_meta():
    cat = [{"key": "cpi", "source": "fred", "id": "CPIAUCSL", "name": "CPI", "cat": "US economy",
            "unit": "index", "agg": "mean", "freq": "M", "derive_yoy": True, "yoy_key": "cpi_yoy",
            "yoy_name": "US inflation (CPI, y/y)"}]
    raw = {"cpi": [(f"{y}-{m:02d}-01", 100.0 * (1.02 ** (y - 1999))) for y in (1999, 2000) for m in range(1, 13)]}
    d = assemble(cat, raw)
    assert d["series"]["cpi_yoy"]["v"][0] == 2.0
    assert d["series"]["cpi_yoy"]["d"][0] == "2000-01"  # 1999 runway gives y/y from Jan 2000
    assert d["meta"]["cpi_yoy"]["unit"] == "% y/y"
    assert d["meta"]["cpi_yoy"]["note"] == "Year-over-year % change, computed"
    assert d["meta"]["cpi"]["src"] == "FRED CPIAUCSL" and d["meta"]["cpi"]["last_obs"] == "2000-12"


def test_csv_url_ons_layout_skips_annual_and_quarterly_rows():
    from atlas.sources import parse_csv_url
    text = '"Title","CPI INDEX"\n"CDID","D7BT"\n"1988","49.6"\n"1988 Q1","49.1"\n"1988 JAN","48.9"\n"1988 FEB","49.0"\n'
    out = parse_csv_url(text, {"header": False, "date_col": 0, "value_col": 1})
    assert out == [("1988-01-01", 48.9), ("1988-02-01", 49.0)]


def test_csv_url_sdmx_header_and_filters():
    from atlas.sources import parse_csv_url
    text = ("DATAFLOW,geo,TIME_PERIOD,OBS_VALUE\n"
            "X,EA21,2020-02,7.1\nX,EA21,2020-01,7.0\nX,DE,2020-01,3.2\nX,EA21,2020-03,\n")
    out = parse_csv_url(text, {"date_col": "TIME_PERIOD", "value_col": "OBS_VALUE", "filters": {"geo": "EA21"}})
    assert out == [("2020-01-01", 7.0), ("2020-02-01", 7.1)]


def test_parse_month_formats():
    from atlas.sources import parse_month
    assert parse_month("2020M03") == "2020-03-01"
    assert parse_month("2020-03-31") == "2020-03-01"
    assert parse_month("2020 Q1") is None and parse_month("2020") is None


def test_fallback_source_used_when_primary_fails(monkeypatch):
    from atlas import build as B, sources
    def fake_fetch(entry, force=False):
        if entry["source"] == "csv_url":
            raise sources.FetchError("boom")
        return [("2020-01-01", 1.0)]
    monkeypatch.setattr(sources, "fetch", fake_fetch)
    cat = [{"key": "x", "source": "csv_url", "id": "X", "fallback": {"source": "fred", "id": "OLD"}}]
    raw, failures, seeded = B.fetch_all(cat)
    assert raw["x"] == [("2020-01-01", 1.0)] and not failures and seeded["x"].startswith("fallback fred OLD")
