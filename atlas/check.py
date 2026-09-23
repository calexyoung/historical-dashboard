"""Data QA (SPEC section 8). Returns (errors, warnings); CLI exits non-zero on errors."""
from __future__ import annotations

import math
from datetime import datetime, timezone

from .transform import add_months

EVENT_CATS = {"political", "financial", "geopolitical", "health", "policy"}


def _val_at(s: dict, month: str):
    try:
        return s["v"][s["d"].index(month)]
    except ValueError:
        return None


def run_checks(data: dict, catalog: list[dict], events: list[dict], now: datetime | None = None):
    errors: list[str] = []
    warnings: list[str] = []
    series, meta = data["series"], data["meta"]
    now = now or datetime.now(timezone.utc)
    this_month = now.strftime("%Y-%m")

    # 1. every catalog entry produced a series (and its derived y/y)
    for e in catalog:
        keys = [e["key"]] + ([e["yoy_key"]] if e.get("derive_yoy") else [])
        for k in keys:
            if k not in series:
                errors.append(f"missing series: {k} ({e['source']} {e['id']})")

    for k, m in meta.items():
        if m.get("seed"):
            warnings.append(f"seeded: {k} not fetched live; using {m['seed']}")

    # 2. staleness
    for e in catalog:
        k = e["key"]
        if k not in series:
            continue
        last = series[k]["d"][-1]
        cutoff = add_months(this_month, -int(e.get("max_lag_months", 3)))
        if last < cutoff:
            msg = f"stale: {k} last obs {last} (expected ≥ {cutoff})"
            if e.get("known_truncated"):
                warnings.append(msg + f" — known truncated source (ends {e['known_truncated']})")
            elif e["source"] == "yahoo":
                errors.append(msg)
            else:
                warnings.append(msg)

    # 3. sanity ranges
    ranges = {}
    for e in catalog:
        if "range" in e:
            ranges[e["key"]] = e["range"]
        if "yoy_range" in e:
            ranges[e["yoy_key"]] = e["yoy_range"]
    ranges.setdefault("approval", [20, 95])
    ranges.setdefault("pres_margin", [-20, 20])
    ranges.setdefault("house_margin", [-20, 20])
    for k, (lo, hi) in ranges.items():
        if k not in series:
            continue
        bad = [(d, v) for d, v in zip(series[k]["d"], series[k]["v"]) if not lo <= v <= hi]
        if bad:
            errors.append(f"out of range [{lo}, {hi}]: {k} e.g. {bad[:3]}")

    # 4. structure: strictly increasing months, no NaN, lengths match
    for k, s in series.items():
        if len(s["d"]) != len(s["v"]):
            errors.append(f"{k}: d/v length mismatch")
        if any(b <= a for a, b in zip(s["d"], s["d"][1:])):
            errors.append(f"{k}: months not strictly increasing / duplicate months")
        if any(v is None or (isinstance(v, float) and math.isnan(v)) for v in s["v"]):
            errors.append(f"{k}: NaN/null values")
        if s["d"] and s["d"][0] < data["first_month"]:
            errors.append(f"{k}: starts before first_month")
        if k not in meta:
            errors.append(f"{k}: no meta record")
        if s["d"] and s["d"][-1] > this_month:
            errors.append(f"{k}: observation in the future ({s['d'][-1]} > {this_month})")

    # 5. derived / level spot checks
    v = _val_at(series.get("cpi_yoy", {"d": [], "v": []}), "2022-06")
    if v is None or abs(v - 9.0) > 0.3:
        errors.append(f"spot check: cpi_yoy 2022-06 = {v}, expected 9.0 ± 0.3")
    spx = series.get("spx", {"d": [], "v": []})
    for m in ("2009-02", "2009-03"):
        v = _val_at(spx, m)
        if v is None or not 700 <= v <= 850:
            errors.append(f"spot check: spx {m} = {v}, expected 700–850")

    # 6. events
    for ev in events:
        if not data["first_month"] <= ev["month"] <= data["last_month"]:
            errors.append(f"event out of range: {ev['month']} {ev['title']}")
        if ev["cat"] not in EVENT_CATS:
            errors.append(f"event bad category: {ev['cat']} ({ev['title']})")
        if "day" in ev and not (isinstance(ev["day"], int) and 1 <= ev["day"] <= 31):
            errors.append(f"event bad day: {ev['day']} ({ev['title']})")
        if ev.get("url") and not str(ev["url"]).startswith("https://"):
            errors.append(f"event url not https: {ev['url']} ({ev['title']})")
        if not ev.get("url"):
            warnings.append(f"event without citation: {ev['month']} {ev['title']}")

    return errors, warnings
