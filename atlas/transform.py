"""Monthly resampling, derived y/y, rounding, and dataset assembly (SPEC 3.2–3.5)."""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone

import pandas as pd

FIRST_MONTH = "2000-01"


def to_monthly(obs: list[tuple[str, float]], how: str) -> "OrderedDict[str, float]":
    """Aggregate source-frequency observations to calendar months.

    how='last' -> last observation in the month (month-end close); how='mean' -> mean within month.
    Quarterly/annual data (one obs per period) lands on its observation month unchanged.
    """
    if not obs:
        return OrderedDict()
    s = pd.Series([v for _, v in obs], index=pd.to_datetime([d for d, _ in obs]))
    s = s.sort_index()
    g = s.groupby(s.index.strftime("%Y-%m"))
    agg = g.last() if how == "last" else g.mean()
    return OrderedDict((m, float(v)) for m, v in agg.items())


def add_months(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) + n
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


def yoy(monthly: "OrderedDict[str, float]") -> "OrderedDict[str, float]":
    """(x[t]/x[t-12] - 1) * 100 on observed months only (no forward-fill), so quarterly/annual
    series produce values only on observation months."""
    out = OrderedDict()
    for m, v in monthly.items():
        prev = monthly.get(add_months(m, -12))
        if prev is not None and prev != 0:
            out[m] = (v / prev - 1) * 100
    return out


def is_pct_unit(unit: str) -> bool:
    return unit.startswith("%") or unit == "pp"


def rounded(monthly: "OrderedDict[str, float]", unit: str) -> dict:
    nd = 2 if is_pct_unit(unit) else 3
    d, v = [], []
    for m, x in monthly.items():
        if m < FIRST_MONTH or x != x:  # clip to grid, drop NaN
            continue
        d.append(m)
        v.append(round(x, nd))
    return {"d": d, "v": v}


def src_label(entry: dict) -> str:
    if entry["source"] == "derived":
        return "Computed: " + entry["id"]
    if entry["source"] == "csv_url":
        return f"{entry['csv'].get('src_name', 'CSV')} {entry['id']}"
    return {"fred": "FRED", "yahoo": "Yahoo"}[entry["source"]] + " " + entry["id"]


def assemble(catalog: list[dict], raw: dict[str, list[tuple[str, float]]], seeded: dict | None = None) -> dict:
    """Build the atlas.json structure from raw observations keyed by catalog key.
    `seeded` maps keys that came from data/seed/ (not a live fetch) to their origin note."""
    seeded = seeded or {}
    series: dict[str, dict] = {}
    meta: dict[str, dict] = {}
    monthly: dict[str, "OrderedDict[str, float]"] = {}
    for e in catalog:
        if e["source"] == "derived":
            a, b = e["derive"]["div"]
            if a not in monthly or b not in monthly:
                continue
            mon = OrderedDict((m, v / monthly[b][m]) for m, v in monthly[a].items() if monthly[b].get(m))
        else:
            obs = raw.get(e["key"])
            if not obs:
                continue
            mon = to_monthly(obs, e.get("agg", "mean"))
        monthly[e["key"]] = mon
        s = rounded(mon, e["unit"])
        if not s["d"]:
            continue
        series[e["key"]] = s
        meta[e["key"]] = {
            "name": e["name"], "cat": e["cat"], "unit": e["unit"], "src": src_label(e),
            "note": e.get("note", "") or "", "freq": e["freq"], "last_obs": s["d"][-1],
        }
        if e["key"] in seeded:
            meta[e["key"]]["seed"] = seeded[e["key"]]
            if seeded[e["key"]].startswith("fallback "):  # e.g. "fallback fred LRHUTTTTEZM156S (...)"
                _, src, sid = seeded[e["key"]].split(" (")[0].split(" ", 2)
                meta[e["key"]]["src"] = f"{src.upper()} {sid}"
        if e.get("derive_yoy"):
            ys = rounded(yoy(mon), "% y/y")
            if ys["d"]:
                k = e["yoy_key"]
                series[k] = ys
                meta[k] = {
                    "name": e["yoy_name"], "cat": e["cat"], "unit": "% y/y", "src": src_label(e),
                    "note": "Year-over-year % change, computed", "freq": e["freq"], "last_obs": ys["d"][-1],
                    "parent": e["key"],
                }
    last = max((s["d"][-1] for s in series.values()), default=FIRST_MONTH)
    return {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "first_month": FIRST_MONTH,
        "last_month": last,
        "series": series,
        "meta": meta,
    }


def expand_approval(table: dict, first: str = FIRST_MONTH) -> dict:
    """Quarterly averages {year: [q1..q4]} -> monthly {d, v}; null quarters are skipped."""
    d, v = [], []
    table = {int(y): vals for y, vals in table.items()}
    for year in sorted(table):
        for q, val in enumerate(table[year]):
            if val is None:
                continue
            for k in range(3):
                m = f"{year:04d}-{q * 3 + k + 1:02d}"
                if m >= first:
                    d.append(m)
                    v.append(float(val))
    return {"d": d, "v": v}


def forward_fill_plot(arr: list, last_idx: int, freq: str) -> list:
    """Reference implementation of the front-end sparse fill rule (SPEC 3.4): fill forward,
    but stop 2 months after the last observation for quarterly and 11 for annual."""
    stop = last_idx + (11 if freq == "A" else 2)
    out, last = list(arr), None
    for i, x in enumerate(out):
        if x is not None:
            last = x
        elif last is not None and i <= stop:
            out[i] = last
    return out
