import json
import re

import pytest

from atlas import build as B
from atlas.check import run_checks

MINI = {
    "generated": "2026-09-20T00:00:00Z", "first_month": "2000-01", "last_month": "2000-12",
    "series": {"usrec": {"d": ["2000-01", "2000-02"], "v": [0, 1]}},
    "meta": {"usrec": {"name": "US recession", "cat": "Politics & sentiment", "unit": "0/1", "src": "FRED USREC",
                       "note": "", "freq": "M", "last_obs": "2000-02"}},
}


def test_template_renders_and_replaces_placeholders():
    html = B.render(MINI, [{"month": "2000-03", "title": "A </script> test", "cat": "financial"}],
                    [["2000-01", "2001-01", "Clinton", "D"]], built="2026-09-20")
    for ph in B.PLACEHOLDERS:
        assert ph not in html
    assert "{{" not in html and "{%" not in html
    assert "<\\/script>" in html  # JSON can't terminate the script tag
    B.js_syntax_check(B.extract_inline_script(html))


def test_syntax_check_catches_errors():
    with pytest.raises(RuntimeError):
        B.js_syntax_check("const x = ;")


@pytest.mark.skipif(not B.DATA_JSON.exists(), reason="run `make build` first")
def test_full_render_size_and_js():
    data = B.with_approval(json.loads(B.DATA_JSON.read_text()), B.load_approval())
    html = B.render(data, B.load_events(), B.load_approval()["terms"])
    assert len(html.encode()) < B.MAX_BYTES
    B.js_syntax_check(B.extract_inline_script(html))
    assert "cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" in html
    # only allowed external resources
    for url in re.findall(r'(?:src|href)="(https?://[^"]+)"', html):
        assert url.startswith(("https://cdnjs.cloudflare.com/", "https://fonts.googleapis.com", "https://fonts.gstatic.com")), url


@pytest.mark.skipif(not B.DATA_JSON.exists(), reason="run `make build` first")
def test_dataset_passes_checks():
    data = B.with_politics(B.with_approval(json.loads(B.DATA_JSON.read_text()), B.load_approval()), B.load_politics())
    errors, _ = run_checks(data, B.load_catalog(), B.load_events())
    assert errors == []
    assert len(data["series"]) >= 98
    assert data["series"]["pres_margin"]["v"][-1] < 0 < data["series"]["house_margin"]["v"][data["series"]["house_margin"]["d"].index("2018-11")]


def test_catalog_shape():
    cat = B.load_catalog()
    assert len(cat) >= 82
    keys = [e["key"] for e in cat] + [e["yoy_key"] for e in cat if e.get("derive_yoy")]
    assert len(keys) == len(set(keys))
    cats = {"US markets", "Global markets", "Commodities & energy", "Currencies", "Rates & money", "US economy",
            "Housing", "Europe", "Asia & other", "Politics & sentiment"}
    assert {e["cat"] for e in cat} <= cats
    assert all(e["agg"] == "last" for e in cat if e["source"] == "yahoo")
    derived = [e for e in cat if e["source"] == "derived"]
    assert all(set(e["derive"]["div"]) <= {x["key"] for x in cat} for e in derived)


def test_events_valid():
    ev = B.load_events()
    assert len(ev) >= 83
    assert all(re.fullmatch(r"\d{4}-\d{2}", e["month"]) for e in ev)
    assert [e["month"] for e in ev] == sorted(e["month"] for e in ev)
    assert all(e.get("url", "").startswith("https://") for e in ev)  # SPEC 10.1: every event cited


def test_check_flags_bad_data():
    data = json.loads(json.dumps(MINI))
    data["series"]["unrate"] = {"d": ["2000-02", "2000-01"], "v": [50.0, 4.0]}
    cat = [{"key": "unrate", "source": "fred", "id": "UNRATE", "range": [2, 16], "max_lag_months": 2}]
    errors, _ = run_checks(data, cat, [{"month": "1999-01", "title": "x", "cat": "nope"}])
    text = "\n".join(errors)
    assert "out of range" in text and "strictly increasing" in text and "event out of range" in text
    assert "bad category" in text


def test_check_flags_future_months():
    data = json.loads(json.dumps(MINI))
    data["series"]["usrec"] = {"d": ["2000-01", "2099-01"], "v": [0, 0]}
    errors, _ = run_checks(data, [], [])
    assert any("future" in e for e in errors)
