"""Writes the committed fixture release, fixtures/public/ (PLAN section 9 and M0).

Every value here is invented. Nothing comes from FRED, Yahoo or any agency, so the fixture may
appear in CI logs, previews and screenshots (PLAN 6.1). Edit the literals below, then run

    python fixtures/make_fixture.py

and commit the result. tests/v2/test_fixture.py fails if the committed files differ from what
this script writes. The script is deliberately independent of atlas/release.py (the validator
under test): period arithmetic here is spelled out by hand, stdlib only.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import shutil
import sys
from pathlib import Path

RELEASE_ID = "20260101T000000Z-0000000"
CREATED = "2026-01-01T00:00:00Z"

SYNTHETIC_ORIGIN = "Macro Atlas fixture (synthetic)"


def source(origin_id: str, via: str = "fixture") -> dict:
    return {
        "origin": {
            "producer": SYNTHETIC_ORIGIN,
            "dataset": "fixture",
            "origin_id": origin_id,
            "url": None,
        },
        "channel": {"via": via, "adapter": "hand_written", "auth": "none"},
    }


def rights(status: str = "public_domain", owner: str = "Macro Atlas project") -> dict:
    return {
        "owner": owner,
        "terms_url": None,
        "status": status,
        "attribution": "Synthetic test data, Macro Atlas project",
        "reviewed": "2026-01-01",
    }


def month(year: int, m: int) -> tuple[str, str, str]:
    last = calendar.monthrange(year, m)[1]
    return f"{year}-{m:02d}", f"{year}-{m:02d}-01", f"{year}-{m:02d}-{last:02d}"


def months(first: tuple[int, int], count: int) -> list[tuple[str, str, str]]:
    y, m = first
    out = []
    for _ in range(count):
        out.append(month(y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


QUARTER_BOUNDS = {1: ("01-01", "03-31"), 2: ("04-01", "06-30"), 3: ("07-01", "09-30"), 4: ("10-01", "12-31")}


def quarters(first_year: int, count: int) -> list[tuple[str, str, str]]:
    out = []
    for i in range(count):
        y, q = first_year + i // 4, i % 4 + 1
        a, b = QUARTER_BOUNDS[q]
        out.append((f"{y}-Q{q}", f"{y}-{a}", f"{y}-{b}"))
    return out


def years(first: int, count: int) -> list[tuple[str, str, str]]:
    return [(str(y), f"{y}-01-01", f"{y}-12-31") for y in range(first, first + count)]


def days(labels: list[str]) -> list[tuple[str, str, str]]:
    return [(d, d, d) for d in labels]


def observations(periods, values, statuses=None) -> list[dict]:
    assert len(periods) == len(values), (len(periods), len(values))
    out = []
    for i, ((label, start, end), value) in enumerate(zip(periods, values)):
        status = (statuses or {}).get(label, "missing" if value is None else "final")
        out.append(
            {"period": label, "period_start": start, "period_end": end, "value": value, "status": status}
        )
    return out


def series_file(key: str, freq: str, obs: list[dict]) -> dict:
    return {
        "key": key,
        "freq": freq,
        "representation": "native",
        "period_start": obs[0]["period_start"],
        "period_end": obs[-1]["period_end"],
        "observations": obs,
    }


# --- the eight series -------------------------------------------------------------------------

# 1. Monthly index with one explicit gap (2025-03) and a preliminary last value.
PRICE = [
    100.0, 100.4, 100.9, 101.1, 101.6, 102.0, 102.3, 102.9, 103.2, 103.8, 104.1, 104.5,
    105.0, 105.2, None, 106.3, 106.9, 107.2, 107.8, 108.1, 108.4, 109.0, 109.3, 109.9,
]  # fmt: skip
price_periods = months((2024, 1), 24)
price = series_file(
    "fx_price_index", "monthly", observations(price_periods, PRICE, {"2025-12": "preliminary"})
)

# 2. A sparse quarterly flow: one observation per quarter, one quarter missing, last one revised.
OUTPUT = [
    510.2, 514.8, 517.3, 521.9, 524.4, 529.0, None, 536.7, 540.1, 543.6, 547.2, 551.5,
    553.9, 558.3, 561.0, 566.4,
]  # fmt: skip
output = series_file(
    "fx_output_quarterly",
    "quarterly",
    observations(quarters(2022, 16), OUTPUT, {"2025-Q3": "revised", "2025-Q4": "estimate"}),
)

# 3. An annual rate.
POVERTY = [15.0, 14.8, 14.8, 13.5, 12.7, 12.3, 11.8, 10.5, 11.5, 11.6, 11.5, 11.1, 10.6, 10.4]
poverty = series_file("fx_poverty_rate_annual", "annual", observations(years(2012, 14), POVERTY))

# 4. A held (step) series: one value per election, standing until the next.
MARGIN = [3.9, 2.1, 4.5, -1.5]
margin = series_file(
    "fx_vote_margin",
    "irregular",
    observations(days(["2012-11-06", "2016-11-08", "2020-11-03", "2024-11-05"]), MARGIN),
)

# 5. A derived series: percent change of the price index from twelve months earlier.
#    2025-03 is missing because its input is missing. Written out with the plain formula so that
#    the engine's own tests (M11) have something independent to agree with.
yoy_values = []
for i in range(12, 24):
    now, then = PRICE[i], PRICE[i - 12]
    yoy_values.append(None if now is None or then is None else (now / then - 1) * 100)
price_yoy = series_file(
    "fx_price_index_yoy",
    "monthly",
    observations(price_periods[12:], yoy_values, {"2025-12": "preliminary"}),
)

# 6. fx_exchange_index is withheld: in the catalog by name, with no values anywhere.

# 7. A monthly count with a break in 2025-01 (new population controls).
PAYROLLS = [
    1500, 1504, 1509, 1511, 1516, 1522, 1525, 1531, 1534, 1540, 1543, 1549,
    1602, 1606, 1611, 1615, 1618, 1624, 1629, 1633, 1636, 1642, 1645, 1651,
]  # fmt: skip
payrolls = series_file("fx_payrolls_break", "monthly", observations(months((2024, 1), 24), PAYROLLS))

# 8. A stale series: ends in 2024-06, eighteen months before the release was created.
PERMITS = [88, 90, 93, 91, 95, 97, 99, 96, 98, 101, 103, 100, 102, 105, 104, 107, 109, 108]
permits_stale = series_file(
    "fx_permits_stale", "monthly", observations(months((2023, 1), 18), PERMITS)
)

STORED = {
    "fx_price_index": price,
    "fx_output_quarterly": output,
    "fx_poverty_rate_annual": poverty,
    "fx_vote_margin": margin,
    "fx_payrolls_break": payrolls,
    "fx_permits_stale": permits_stale,
}
DERIVED = {"fx_price_index_yoy": price_yoy}

CATALOG = {
    "series": [
        {
            "key": "fx_price_index",
            "name": "Fixture price index",
            "description": "Synthetic monthly index with one missing month and a preliminary latest value.",
            "definition": {"population": "All synthetic households", "geography": "Fixtureland"},
            "unit": "index, 2024-01 = 100",
            "unit_kind": "index",
            "measure_kind": "index",
            "agg": "mean",
            "freq": "monthly",
            "continuity": "discrete",
            "representation": "native",
            "seasonal_adjustment": "sa",
            "price_basis": "not_applicable",
            "base_period": "2024-01",
            "country": "USA",
            "segment": "economy_jobs",
            "topics": ["inflation"],
            "source": source("FX-PRICE"),
            "rights": rights(),
            "status": "active",
            "max_lag": "P2M",
        },
        {
            "key": "fx_output_quarterly",
            "name": "Fixture output",
            "description": "Synthetic quarterly flow with one missing quarter.",
            "unit": "billions of fixture dollars",
            "unit_kind": "currency",
            "measure_kind": "flow",
            "agg": "sum",
            "freq": "quarterly",
            "continuity": "discrete",
            "representation": "native",
            "seasonal_adjustment": "sa",
            "price_basis": "real",
            "country": "USA",
            "segment": "economy_jobs",
            "topics": ["growth"],
            "source": source("FX-OUTPUT"),
            "rights": rights(),
            "status": "active",
            "max_lag": "P6M",
        },
        {
            "key": "fx_poverty_rate_annual",
            "name": "Fixture poverty rate",
            "description": "Synthetic annual rate. Its rights status asks for a citation.",
            "definition": {
                "population": "All synthetic residents",
                "geography": "Fixtureland",
                "denominator": "Resident population",
            },
            "unit": "percent of residents",
            "unit_kind": "percent",
            "measure_kind": "rate",
            "agg": "mean",
            "freq": "annual",
            "continuity": "discrete",
            "representation": "native",
            "seasonal_adjustment": "not_applicable",
            "country": "USA",
            "segment": "economy_jobs",
            "topics": ["poverty"],
            "source": source("FX-POVERTY"),
            "rights": rights("citation_required"),
            "status": "active",
            "max_lag": "P2Y",
        },
        {
            "key": "fx_vote_margin",
            "name": "Fixture election margin",
            "description": "Synthetic result per election. Each value stands until the next election.",
            "unit": "percentage points",
            "unit_kind": "percentage_points",
            "measure_kind": "rate",
            "agg": "last",
            "freq": "irregular",
            "continuity": "held",
            "representation": "native",
            "country": "USA",
            "segment": "governance_politics",
            "topics": ["elections"],
            "source": source("FX-VOTE"),
            "rights": rights(),
            "status": "active",
        },
        {
            "key": "fx_price_index_yoy",
            "name": "Fixture price index, change from a year earlier",
            "description": "Derived from the fixture price index by a recipe.",
            "unit": "percent change from a year earlier",
            "unit_kind": "percent",
            "measure_kind": "rate",
            "agg": "none",
            "freq": "monthly",
            "continuity": "discrete",
            "representation": "native",
            "country": "USA",
            "segment": "economy_jobs",
            "topics": ["inflation"],
            "source": source("FX-PRICE"),
            "rights": rights(),
            "status": "active",
            "recipe": {
                "op": "pct_change",
                "inputs": ["fx_price_index"],
                "params": {"lag": 12},
                "order": "compute_then_aggregate",
            },
        },
        {
            "key": "fx_exchange_index",
            "name": "Fixture exchange index",
            "description": "Stands for a licensed index: listed by name, values withheld.",
            "unit": "index",
            "unit_kind": "index",
            "measure_kind": "index",
            "agg": "last",
            "freq": "monthly",
            "continuity": "discrete",
            "representation": "native",
            "country": "USA",
            "segment": "markets_money",
            "topics": ["markets"],
            "source": source("FX-EXCH", via="fixture_vendor"),
            "rights": rights("no_redistribution", owner="Fixture Exchange Ltd (synthetic)"),
            "status": "active",
        },
        {
            "key": "fx_payrolls_break",
            "name": "Fixture payrolls",
            "description": "Synthetic monthly count with a break in January 2025.",
            "unit": "thousands of jobs",
            "unit_kind": "count",
            "measure_kind": "stock",
            "agg": "mean",
            "freq": "monthly",
            "continuity": "discrete",
            "representation": "native",
            "seasonal_adjustment": "sa",
            "country": "USA",
            "segment": "economy_jobs",
            "topics": ["jobs"],
            "source": source("FX-PAYROLLS"),
            "rights": rights(),
            "status": "active",
            "max_lag": "P2M",
            "breaks": [
                {
                    "period": "2025-01",
                    "note": "New population controls from January 2025; earlier months are not comparable.",
                }
            ],
        },
        {
            "key": "fx_permits_stale",
            "name": "Fixture building permits",
            "description": "Synthetic monthly series whose source stopped in June 2024.",
            "unit": "thousands of units, annual rate",
            "unit_kind": "count",
            "measure_kind": "annualized",
            "agg": "mean",
            "freq": "monthly",
            "continuity": "discrete",
            "representation": "native",
            "seasonal_adjustment": "saar",
            "country": "USA",
            "segment": "infrastructure",
            "topics": ["construction"],
            "source": source("FX-PERMITS"),
            "rights": rights(),
            "status": "active",
            "max_lag": "P3M",
        },
    ]
}

CITATION = {"name": "Fixture gazette (synthetic)", "url": "https://example.org/fixture-gazette"}
ANNOTATIONS = {
    "annotations": [
        {
            "id": "event-2024-09-18-fixture-rate-decision",
            "kind": "event",
            "anchor": {"type": "date", "date": "2024-09-18"},
            "label": "Fixture central bank changes its rate",
            "ref": None,
            "source": CITATION,
            "category": "policy",
        },
        {
            "id": "recession-2022-fixture",
            "kind": "recession",
            "anchor": {"type": "span", "start": "2022-07-01", "end": "2023-03-31"},
            "label": "Fixture recession",
            "ref": None,
            "source": CITATION,
        },
        {
            "id": "governance-2021-fixture-term",
            "kind": "governance",
            "anchor": {"type": "span", "start": "2021-01-20", "end": "2025-01-19"},
            "label": "Fixture head of government, first term",
            "ref": None,
            "source": CITATION,
            "attributes": {"office": "head of government", "party": "Fixture Party A"},
        },
        {
            "id": "governance-2025-fixture-term",
            "kind": "governance",
            "anchor": {"type": "span", "start": "2025-01-20", "end": None},
            "label": "Fixture head of government, second term",
            "ref": None,
            "source": CITATION,
            "attributes": {"office": "head of government", "party": "Fixture Party B"},
        },
        {
            "id": "policy-2024-fixture-tariff",
            "kind": "policy",
            "anchor": {"type": "span", "start": "2024-04-01", "end": "2024-12-31"},
            "label": "Fixture tariff schedule in force",
            "ref": None,
            "source": CITATION,
        },
        {
            "id": "data-note-fx-payrolls-break-2025-01",
            "kind": "data_note",
            "anchor": {"type": "period", "period": "2025-01"},
            "series": ["fx_payrolls_break"],
            "label": "New population controls; earlier months are not comparable",
            "ref": None,
            "source": None,
        },
    ]
}


def dump(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def build(root: Path) -> Path:
    """Write the fixture in PUBLIC layout under root: releases/{id}/ and CURRENT."""
    release = root / "releases" / RELEASE_ID
    if release.exists():
        shutil.rmtree(release)
    (release / "series").mkdir(parents=True)
    (release / "derived").mkdir()
    (release / "content").mkdir()

    by_key = {entry["key"]: entry for entry in CATALOG["series"]}
    rows = {}
    for kind, folder, files in (("stored", "series", STORED), ("derived", "derived", DERIVED)):
        for key, doc in files.items():
            data = dump(doc)
            (release / folder / f"{key}.json").write_bytes(data)
            rows[key] = {
                "kind": kind,
                "sha256": hashlib.sha256(data).hexdigest(),
                "channel": by_key[key]["source"]["channel"]["via"],
                "rights_status": by_key[key]["rights"]["status"],
                "representation": by_key[key]["representation"],
            }

    manifest = {
        "schema_version": "0.1.0",
        "semantics_version": "0",
        "release_id": RELEASE_ID,
        "profile": "public",
        "created": CREATED,
        "rights_register": {"version": "fixture", "sha256": None, "signed": True},
        "series": dict(sorted(rows.items())),
        "withheld": [
            {"key": "fx_exchange_index", "reason": "The licence does not allow redistribution."}
        ],
        "checks": {
            "passed": True,
            "report": [{"check": "hand-written fixture", "outcome": "pass"}],
        },
        "sources": [{"producer": SYNTHETIC_ORIGIN, "via": "fixture", "fetched": None, "outcome": "ok"}],
    }
    (release / "manifest.json").write_bytes(dump(manifest))
    (release / "catalog.json").write_bytes(dump(CATALOG))
    (release / "content" / "annotations.json").write_bytes(dump(ANNOTATIONS))
    (root / "CURRENT").write_text(RELEASE_ID + "\n")
    return release


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "public"
    print(build(target))
