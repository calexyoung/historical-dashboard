"""Source fetchers (FRED CSV, Yahoo Finance chart JSON) with an on-disk cache and retries.

Each fetcher returns a list of (date_str 'YYYY-MM-DD', float) observations at source frequency.
Raw responses are cached in data/raw/<key>.<csv|json>; a sidecar <key>.meta.json records the fetch time.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

try:  # Yahoo rejects non-browser TLS handshakes with HTTP 429; curl_cffi mimics Chrome's.
    from curl_cffi import requests as browser_requests
except ImportError:  # pragma: no cover
    browser_requests = None

log = logging.getLogger("atlas.sources")

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SEED = ROOT / "data" / "seed"

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}"
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1={p1}&period2={p2}&interval=1mo"
YAHOO_PERIOD1 = int(datetime(1999, 1, 1, tzinfo=timezone.utc).timestamp())
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
DELAY = {"fred": 0.25, "yahoo": 0.4, "csv_url": 0.25}
_last_call: dict[str, float] = {}
_rate_limited: dict[str, int] = {}  # source -> consecutive series that ended in HTTP 429
BREAKER = 2  # after this many, skip the source for the rest of the run


class FetchError(RuntimeError):
    pass


def _throttle(source: str) -> None:
    wait = DELAY.get(source, 0.25) - (time.monotonic() - _last_call.get(source, 0.0))
    if wait > 0:
        time.sleep(wait)
    _last_call[source] = time.monotonic()


def _get(source: str, url: str, retries: int = 3, **kw) -> requests.Response:
    """GET with retries + exponential backoff on 5xx / 429 / timeouts."""
    # Yahoo needs a browser User-Agent; FRED's CDN resets connections for browser-like or custom UAs,
    # so it gets the stock requests UA.
    headers = {"User-Agent": UA if source == "yahoo" else requests.utils.default_user_agent(), "Accept": "*/*"}
    headers.update(kw.pop("headers", {}))
    if _rate_limited.get(source, 0) >= BREAKER:
        raise FetchError(f"{source} rate-limited (HTTP 429) earlier in this run; skipped")
    last: Exception | None = None
    for attempt in range(retries + 1):
        _throttle(source)
        try:
            if source == "yahoo" and browser_requests is not None:
                r = browser_requests.get(url, headers={"Accept": "application/json"}, impersonate="chrome", timeout=30)
            else:
                r = requests.get(url, headers=headers, timeout=30, **kw)
            if r.status_code == 429 or r.status_code >= 500:
                raise FetchError(f"HTTP {r.status_code}")
            if r.status_code != 200:
                raise FetchError(f"HTTP {r.status_code} (not retried)")
            _rate_limited[source] = 0
            return r
        except (requests.Timeout, requests.ConnectionError, FetchError) as e:
            last = e
            if isinstance(e, FetchError) and "not retried" in str(e):
                break
            if attempt < retries:
                time.sleep(1.5 * 2**attempt)
        except Exception as e:  # curl_cffi network errors aren't requests exceptions
            if browser_requests is None or source != "yahoo":
                raise
            last = e
            if attempt < retries:
                time.sleep(1.5 * 2**attempt)
    if "429" in str(last):
        _rate_limited[source] = _rate_limited.get(source, 0) + 1
    raise FetchError(f"{url}: {last}")


def cache_path(key: str, ext: str) -> Path:
    return RAW / f"{key}.{ext}"


def _write_cache(key: str, ext: str, text: str) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    cache_path(key, ext).write_text(text)
    (RAW / f"{key}.meta.json").write_text(json.dumps({"fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}))


def _read_cache(key: str, ext: str) -> str | None:
    p = cache_path(key, ext)
    return p.read_text() if p.exists() else None


# ---------------------------------------------------------------- FRED
def parse_fred_csv(text: str, fred_id: str) -> list[tuple[str, float]]:
    if not text.lstrip().lower().startswith(("observation_date", "date")):
        raise FetchError(f"FRED {fred_id}: not a CSV response (HTML error page?)")
    rows = csv.reader(io.StringIO(text))
    next(rows)
    out = []
    for row in rows:
        if len(row) < 2 or row[1] in (".", ""):
            continue
        out.append((row[0], float(row[1])))
    if not out:
        raise FetchError(f"FRED {fred_id}: no observations")
    return out


def fetch_fred(key: str, fred_id: str, force: bool = False) -> list[tuple[str, float]]:
    text = None if force else _read_cache(key, "csv")
    if text is None:
        text = _get("fred", FRED_URL.format(id=fred_id)).text
        parse_fred_csv(text, fred_id)  # validate before caching
        _write_cache(key, "csv", text)
    return parse_fred_csv(text, fred_id)


# ---------------------------------------------------------------- Yahoo
def parse_yahoo_json(payload: dict, symbol: str) -> list[tuple[str, float]]:
    """Month-start timestamps are in exchange TZ: shift by gmtoffset before taking the month."""
    try:
        res = payload["chart"]["result"][0]
        ts = res["timestamp"]
        close = res["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError) as e:
        err = (payload.get("chart") or {}).get("error") if isinstance(payload, dict) else None
        raise FetchError(f"Yahoo {symbol}: unexpected payload ({err or e})")
    off = int(res.get("meta", {}).get("gmtoffset") or 0)
    by_month: dict[str, float] = {}
    for t, c in zip(ts, close):
        if c is None:
            continue
        d = datetime.fromtimestamp(t + off, tz=timezone.utc)
        by_month[d.strftime("%Y-%m")] = float(c)  # dedupe months: keep last
    if not by_month:
        raise FetchError(f"Yahoo {symbol}: no observations")
    return [(m + "-01", v) for m, v in sorted(by_month.items())]


def fetch_yahoo(key: str, symbol: str, force: bool = False) -> list[tuple[str, float]]:
    text = None if force else _read_cache(key, "json")
    if text is None:
        p2 = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())
        url = YAHOO_URL.format(sym=requests.utils.quote(symbol, safe=""), p1=YAHOO_PERIOD1, p2=p2)
        text = _get("yahoo", url, headers={"Accept": "application/json"}).text
        parse_yahoo_json(json.loads(text), symbol)
        _write_cache(key, "json", text)
    return parse_yahoo_json(json.loads(text), symbol)


# ---------------------------------------------------------------- generic CSV (SPEC 10.2)
_MON = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}
_DATE_RES = [
    (re.compile(r"^(\d{4})-(\d{2})(?:-\d{2})?$"), lambda m: (m[1], int(m[2]))),          # 2020-01, 2020-01-31
    (re.compile(r"^(\d{4})M(\d{2})$"), lambda m: (m[1], int(m[2]))),                     # 2020M01
    (re.compile(r"^(\d{4}) ([A-Z]{3})$"), lambda m: (m[1], _MON.get(m[2], 0))),            # 2020 JAN (ONS)
]


def parse_month(raw: str, fmt: str | None = None) -> str | None:
    """Monthly date -> 'YYYY-MM-01'; None for anything else (annual/quarterly rows are skipped)."""
    raw = raw.strip()
    if fmt:
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-01")
        except ValueError:
            return None
    for rx, fn in _DATE_RES:
        m = rx.match(raw.upper())
        if m:
            y, mo = fn(m)
            return f"{y}-{mo:02d}-01" if 1 <= mo <= 12 else None
    return None


def parse_csv_url(text: str, spec: dict) -> list[tuple[str, float]]:
    """Column mapper for plain CSV sources.

    spec: url; date_col / value_col (header names, or 0-based ints when header: false);
    optional header (default true), filters {col: value}, date_format (strptime), delimiter.
    Rows whose date isn't monthly or whose value isn't numeric are skipped.
    """
    delim = spec.get("delimiter", ",")
    rows = csv.reader(io.StringIO(text.lstrip("\ufeff")), delimiter=delim)
    if spec.get("header", True):
        cols = [c.strip() for c in next(rows)]
        di, vi = cols.index(spec["date_col"]), cols.index(spec["value_col"])
        fi = {cols.index(c): str(v) for c, v in (spec.get("filters") or {}).items()}
    else:
        di, vi, fi = int(spec["date_col"]), int(spec["value_col"]), {int(c): str(v) for c, v in (spec.get("filters") or {}).items()}
    out = {}
    for row in rows:
        if len(row) <= max(di, vi) or any(row[i].strip() != v for i, v in fi.items()):
            continue
        d = parse_month(row[di], spec.get("date_format"))
        try:
            v = float(row[vi])
        except ValueError:
            continue
        if d:
            out[d] = v
    if not out:
        raise FetchError("csv_url: no monthly observations after mapping")
    return sorted(out.items())


def fetch_csv_url(key: str, spec: dict, force: bool = False) -> list[tuple[str, float]]:
    text = None if force else _read_cache(key, "csv")
    if text is None:
        text = _get("csv_url", spec["url"], headers=spec.get("headers") or {}).text
        parse_csv_url(text, spec)
        _write_cache(key, "csv", text)
    return parse_csv_url(text, spec)


def load_seed(key: str) -> tuple[list[tuple[str, float]], str] | None:
    """Last-resort fallback when a live fetch fails and nothing is cached: committed month-end
    values in data/seed/<key>.json (currently the prototype's Yahoo closes). Returns (obs, origin)."""
    p = SEED / f"{key}.json"
    if not p.exists():
        return None
    j = json.loads(p.read_text())
    return [(d + "-01", float(v)) for d, v in zip(j["d"], j["v"])], j.get("origin", "seed")


def fetch(entry: dict, force: bool = False) -> list[tuple[str, float]]:
    src = entry["source"]
    if src == "fred":
        return fetch_fred(entry["key"], entry["id"], force)
    if src == "yahoo":
        return fetch_yahoo(entry["key"], entry["id"], force)
    if src == "csv_url":
        return fetch_csv_url(entry["key"], entry["csv"], force)
    raise ValueError(f"unknown source {src!r}")
