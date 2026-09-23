"""Runs the dashboard's own stats module (web/stats.js) under node, so tests cover the shipped code."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

STATS = Path(__file__).resolve().parent.parent / "web" / "stats.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def js(expr: str):
    code = f"const S = require({json.dumps(str(STATS))}); process.stdout.write(JSON.stringify({expr}));"
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def test_pearson_perfect_positive_and_negative():
    x = list(range(1, 11))
    assert js(f"S.pearson({x}, {[2 * v + 1 for v in x]}, 0, 9).r") == pytest.approx(1.0)
    assert js(f"S.pearson({x}, {[-v for v in x]}, 0, 9).r") == pytest.approx(-1.0)


def test_pearson_near_zero():
    x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    y = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1]
    r = js(f"S.pearson({x}, {y}, 0, 9).r")
    assert abs(r) < 0.2


def test_pearson_n_below_8_returns_null():
    out = js("S.pearson([1,2,3,4,5,6,7], [1,2,3,4,5,6,7], 0, 6)")
    assert out["r"] is None and out["n"] == 7


def test_pearson_skips_nulls():
    out = js("S.pearson([1,null,3,4,5,6,7,8,9,10], [2,4,null,8,10,12,14,16,18,20], 0, 9)")
    assert out["n"] == 8 and out["r"] == pytest.approx(1.0)


def test_lag_alignment_x_leads_y():
    # y is x shifted forward by 3 months: y[t+3] = x[t]. Positive lag pairs x[t] with y[t+lag].
    x = [((i * 7919) % 23) * 1.0 for i in range(40)]
    y = [None, None, None] + x[:-3]
    r3 = js(f"S.pearson({json.dumps(x)}, {json.dumps(y)}, 0, 39, 3).r")
    r0 = js(f"S.pearson({json.dumps(x)}, {json.dumps(y)}, 0, 39, 0).r")
    assert r3 == pytest.approx(1.0) and abs(r0) < 0.9


def test_zscore_population_sd():
    z = js("S.zscore([2,4,4,4,5,5,7,9], 0, 7)")
    assert z[0] == pytest.approx(-1.5) and z[-1] == pytest.approx(2.0)  # mean 5, sd 2


def test_zscore_respects_range():
    z = js("S.zscore([100, 1, 2, 3, 100], 1, 3)")
    assert z[0] is None and z[4] is None and z[2] == pytest.approx(0.0)


def test_rebase_with_leading_nulls():
    out = js("S.rebase([null, null, 50, 75, null, 100], 0, 5)")
    assert out == [None, None, 100, 150, None, 200]


def test_rebase_uses_first_value_in_range_not_series():
    assert js("S.rebase([10, 20, 40], 1, 2)") == [None, 100, 200]


def test_yoy_on_the_fly():
    a = [100.0] * 12 + [110.0]
    assert js(f"S.yoy({a}, 0, 12)")[12] == pytest.approx(10.0)


def test_changes_no_fill():
    assert js("S.changes([100, 110, null, 121, 121])") == [None, pytest.approx(10.0), None, None, 0]


def test_fill_sparse_stop_rules():
    q = js("S.fillSparse([1,null,null,null,null], 0, 'Q')")
    assert q == [1, 1, 1, None, None]
    a = js("S.fillSparse([1].concat(Array(14).fill(null)), 0, 'A')")
    assert a[11] == 1 and a[12] is None


def test_p_value_normal_approx():
    assert js("S.pValue(0.5, 30)") < 0.05
    assert js("S.pValue(0.1, 30)") > 0.05
    assert js("S.normCdf(1.959964)") == pytest.approx(0.975, abs=1e-4)


def test_add_months_and_fmt():
    assert js("S.addM('2000-01', -1)") == "1999-12"
    assert js("S.fmtM('2008-09')") == "Sep 2008"
    assert js("S.fmtN(1234567)") == "1.23M"
    assert js("S.fmtN(12345.6)") == "12,346"
    assert js("S.fmtN(123.456)") == "123.5"
    assert js("S.fmtN(1.234)") == "1.23"


def test_drawdown():
    assert js("S.drawdown([100, 120, 90, null, 130, 65], 0, 5)") == [0, 0, pytest.approx(-25.0), None, 0, pytest.approx(-50.0)]


def test_rolling_corr_window():
    x = list(range(30))
    out = js(f"S.rollingCorr({x}, {[2 * v for v in x]}, 0, 29, 24)")
    assert out[22] is None and out[23] == pytest.approx(1.0) and out[29] == pytest.approx(1.0)
