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
#: The fixture's bulk files, as bulk/make_bulk.py wrote them with the real bulk writer.
BULK = Path(__file__).resolve().parent / "bulk" / "downloads"
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


def rights(status: str = "public_domain", owner: str = "Macro Atlas project", ml_use: bool = True) -> dict:
    """``ml_use`` False is an invented reservation (contract 0.8.0, ADR 0041): the fixture has
    one Series that may be handed out and is not for model training, and its Withheld one."""
    return {
        "owner": owner,
        "terms_url": None,
        "status": status,
        "attribution": "Synthetic test data, Macro Atlas project",
        "reviewed": "2026-01-01",
        "ml_use": ml_use,
        **({} if ml_use else {"ml_use_reserved_by": [owner]}),
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

# 9 to 11. Three more invented economies' inflation, for the range a Topic sets the price
#    index's own change against (M23). B is whole. C begins in April 2025. D has no value in
#    June and an estimate in December, which a range does not count. A fifth member of the
#    range, fx_infl_e, is named by the Topic and is not in this Release at all.
#
#    The range for November 2025, by hand: the price index's change is (109.3 / 104.1 - 1) x 100
#    = 4.9952 (to four places), B is 2.0, C is 7.5, D is 3.1. Four of five members. Lowest 2.0,
#    highest 7.5, and the median of 2.0, 3.1, 4.9952, 7.5 is (3.1 + 4.9952) / 2 = 4.0476.
#    March 2025 has two members (B and D: the price index has a gap and C has not begun), which
#    is not more than half of five, so it has no range.
INFL_B = [1.2, 1.3, 1.1, 1.4, 1.6, 1.5, 1.7, 1.8, 1.9, 2.1, 2.0, 2.2]
INFL_C = [9.4, 9.1, 8.8, 8.6, 8.2, 7.9, 7.7, 7.5, 7.2]
INFL_D = [2.6, 2.7, 2.9, 3.0, 3.3, None, 3.4, 3.2, 3.0, 3.2, 3.1, 3.3]
infl_b = series_file("fx_infl_b", "monthly", observations(months((2025, 1), 12), INFL_B))
infl_c = series_file("fx_infl_c", "monthly", observations(months((2025, 4), 9), INFL_C))
infl_d = series_file("fx_infl_d", "monthly", observations(months((2025, 1), 12), INFL_D, {"2025-12": "estimate"}))

STORED = {
    "fx_infl_b": infl_b,
    "fx_infl_c": infl_c,
    "fx_infl_d": infl_d,
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
            "rights": rights("citation_required", ml_use=False),
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
            # Declared by hand: a change of a change is not offered (docs/method/transforms.md).
            "allowed_transforms": ["lin", "z"],
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
            "rights": rights("no_redistribution", owner="Fixture Exchange Ltd (synthetic)", ml_use=False),
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
        *[
            {
                "key": f"fx_infl_{letter}",
                "name": f"Fixture economy {letter.upper()} inflation",
                "description": f"Synthetic monthly rate for the invented economy {letter.upper()}: a member of a Topic's range.",
                "unit": "percent change from a year earlier",
                "unit_kind": "percent",
                "measure_kind": "rate",
                "agg": "none",
                "freq": "monthly",
                "continuity": "discrete",
                "representation": "native",
                "country": f"FX{letter.upper()}",
                "segment": "us_in_the_world",
                "topics": ["inflation"],
                "source": source(f"FX-INFL-{letter.upper()}"),
                "rights": rights(),
                "status": "active",
                "max_lag": "P3M",
            }
            for letter in "bcd"
        ],
    ]
}

CITATION = {"name": "Fixture gazette (synthetic)", "url": "https://example.org/fixture-gazette"}
ARCHIVED = {**CITATION, "archive_url": "https://example.org/archive/2026/fixture-gazette"}
NOT_ARCHIVED = {"name": "Fixture harbour board (synthetic)", "url": "https://example.org/fixture-harbour",
                "no_archive": "The fixture harbour board's pages cannot be archived (synthetic reason)."}

# Events (0.3.0, M19): one, invented, with everything an Event may carry but an end. Written
# out by hand beside the Annotation it is drawn as, independently of atlas/content. (One only:
# the Explorer's tests from M4 count this Release's Events. The other ways an Event is dated
# are in the tests that need them.)
EVENTS = {
    "events": [
        {
            "id": "2024-09-18-fixture-rate-decision",
            "date": "2024-09-18",
            "date_precision": "day",
            "title": "Fixture central bank changes its rate",
            "category": "policy",
            "status": "public",
            "topics": ["inflation"],
            "related_series": ["fx_price_index", "fx_exchange_index", "fx_not_in_this_release"],
            "sources": [ARCHIVED, NOT_ARCHIVED],
            "description": "The fixture central bank announced a new policy rate on 18 September 2024.\n\n"
                           "The announcement was published in the fixture gazette the same day.",
        },
    ]
}


# A term of government, a recession and a policy period are typed in from somebody's record,
# so each says where from (0.3.0); the rights check of a Release asks the gate about it.
TYPED_IN = {"producer": SYNTHETIC_ORIGIN, "dataset": "fixture", "via": "fixture", "representation": "native"}


def _event_annotation(event_id: str, anchor: dict) -> dict:
    event = next(e for e in EVENTS["events"] if e["id"] == event_id)
    return {"id": f"event-{event_id}", "kind": "event", "anchor": anchor, "label": event["title"],
            "ref": f"content/events/{event_id}.md", "source": ARCHIVED, "category": event["category"]}


ANNOTATIONS = {
    "annotations": [
        _event_annotation("2024-09-18-fixture-rate-decision", {"type": "date", "date": "2024-09-18"}),
        {
            "id": "recession-2022-fixture",
            "kind": "recession",
            "anchor": {"type": "span", "start": "2022-07-01", "end": "2023-03-31"},
            "label": "Fixture recession",
            "ref": None,
            "source": CITATION,
            "provenance": TYPED_IN,
        },
        {
            "id": "governance-2021-fixture-term",
            "kind": "governance",
            "anchor": {"type": "span", "start": "2021-01-20", "end": "2025-01-19"},
            "label": "Fixture head of government, first term",
            "ref": None,
            "source": CITATION,
            "provenance": TYPED_IN,
            "attributes": {"office": "head of government", "party": "Fixture Party A"},
        },
        {
            "id": "governance-2025-fixture-term",
            "kind": "governance",
            "anchor": {"type": "span", "start": "2025-01-20", "end": None},
            "label": "Fixture head of government, second term",
            "ref": None,
            "source": CITATION,
            "provenance": TYPED_IN,
            "attributes": {"office": "head of government", "party": "Fixture Party B"},
        },
        {
            "id": "policy-2024-fixture-tariff",
            "kind": "policy",
            "anchor": {"type": "span", "start": "2024-04-01", "end": "2024-12-31"},
            "label": "Fixture tariff schedule in force",
            "ref": None,
            "source": CITATION,
            "provenance": TYPED_IN,
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


# --- vintages: what was held for three of the Series, and from when (invented) -------------------
#
# Written out by hand, version by version, independently of atlas/vintage (the store) and of
# packages/core (which resolves as-of questions from these files). Captures are daily at 10:45
# New York time (15:45Z in December) from 8 December 2025, with none on 12, 13 and 14 December:
# a Capture gap of three days.

def capture_time(day: int) -> str:
    return f"2025-12-{day:02d}T15:45:00Z"


CAPTURE_DAYS = [8, 9, 10, 11] + list(range(15, 32))
FIRST = capture_time(8)


def recorded_metadata(key: str, unit: str | None = None) -> dict:
    entry = next(e for e in CATALOG["series"] if e["key"] == key)
    metadata = {
        "name": entry["name"],
        "unit": unit or entry["unit"],
        "seasonal_adjustment": entry["seasonal_adjustment"],
        "source": entry["source"],
        "rights": {"licence_class": entry["rights"]["status"], "attribution": entry["rights"]["attribution"]},
    }
    text = json.dumps(metadata, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {"hash": hashlib.sha256(text.encode("utf-8")).hexdigest(), "metadata": metadata}


def version(period, value, status, held_from, held_to, metadata, **provider) -> dict:
    label, start, end = period
    return {
        "period": label, "period_start": start, "period_end": end,
        "value": value, "status": status, "deleted": False,
        "recorded_from": held_from, "recorded_to": held_to,
        "provider_from": provider.get("published"), "provider_to": provider.get("superseded"),
        "provider_precision": provider.get("precision"),
        "channel": "fixture", "metadata": metadata["hash"],
    }  # fmt: skip


def captures(changes: dict[int, str], scope, later_scope=None) -> list[dict]:
    """One line per capture day; a day not named in ``changes`` found nothing changed."""
    return [
        {
            "retrieved_at": capture_time(day),
            "scope": list(scope if day == CAPTURE_DAYS[0] or later_scope is None else later_scope),
            "change": changes.get(day, "none"),
        }
        for day in CAPTURE_DAYS
    ]


def vintage_file(key: str, freq: str, metadata: list[dict], caps: list[dict], rows: list[dict], coverage=None) -> dict:
    return {"key": key, "freq": freq, "representation": "native", "provider_coverage": coverage,
            "metadata": metadata, "captures": caps, "rows": rows}  # fmt: skip


# fx_price_index, Atlas-observed. 8 December: January 2024 to October 2025, October preliminary
# at 109.2. 10 December: October becomes 109.0 final and November arrives, 109.5 preliminary.
# 15 December (after the gap): November becomes 109.3 final and December arrives.
price_meta = recorded_metadata("fx_price_index")
price_rows = []
for period, value in zip(price_periods[:21], PRICE[:21]):
    price_rows.append(version(period, value, "missing" if value is None else "final", FIRST, None, price_meta))
price_rows += [
    version(price_periods[21], 109.2, "preliminary", FIRST, capture_time(10), price_meta),
    version(price_periods[21], 109.0, "final", capture_time(10), None, price_meta),
    version(price_periods[22], 109.5, "preliminary", capture_time(10), capture_time(15), price_meta),
    version(price_periods[22], 109.3, "final", capture_time(15), None, price_meta),
    version(price_periods[23], 109.9, "preliminary", capture_time(15), None, price_meta),
]
price_vintages = vintage_file(
    "fx_price_index", "monthly", [{**price_meta, "recorded_from": FIRST}],
    captures({8: "first", 10: "revision", 15: "revision"}, ("2024-01-01", "2025-12-31")), price_rows,
)  # fmt: skip

# fx_output_quarterly, provider vintages: an archive of the Origin's releases, imported whole on
# 8 December and complete from April 2022 to that day. Each quarter was published on the 28th
# of the month after it ended. 2025-Q2 and 2025-Q3 were each revised a month later; the Q3
# releases are dated only to the day. 2025-Q4 is an advance estimate of 5 December.
output_meta = recorded_metadata("fx_output_quarterly")
output_rows = []
for (label, start, end), value in zip(quarters(2022, 16), OUTPUT):
    year, quarter = int(label[:4]), int(label[-1])
    month_after = quarter * 3 + 1
    published = f"{year + month_after // 13}-{(month_after - 1) % 12 + 1:02d}-28T13:30:00Z"
    period = (label, start, end)
    if label == "2025-Q2":
        output_rows += [
            version(period, 557.9, "preliminary", FIRST, FIRST, output_meta, published=published, superseded="2025-08-28T13:30:00Z", precision="datetime"),
            version(period, value, "final", FIRST, None, output_meta, published="2025-08-28T13:30:00Z", precision="datetime"),
        ]  # fmt: skip
    elif label == "2025-Q3":
        output_rows += [
            version(period, 560.2, "preliminary", FIRST, FIRST, output_meta, published="2025-10-28T00:00:00Z", superseded="2025-11-28T00:00:00Z", precision="date"),
            version(period, value, "revised", FIRST, None, output_meta, published="2025-11-28T00:00:00Z", precision="date"),
        ]  # fmt: skip
    elif label == "2025-Q4":
        output_rows.append(version(period, value, "estimate", FIRST, None, output_meta, published="2025-12-05T13:30:00Z", precision="datetime"))  # fmt: skip
    else:
        output_rows.append(version(period, value, "missing" if value is None else "final", FIRST, None, output_meta, published=published, precision="datetime"))  # fmt: skip
output_vintages = vintage_file(
    "fx_output_quarterly", "quarterly", [{**output_meta, "recorded_from": FIRST}],
    captures({8: "first"}, (None, None)), output_rows,
    coverage={"from": "2022-04-01T00:00:00Z", "to": "2025-12-08T00:00:00Z"},
)  # fmt: skip

# fx_poverty_rate_annual, a metadata change. On 8 December the whole Series was asked about and
# recorded as "percent of persons". From 9 December the source is asked only about 2016 onwards
# and the unit is declared as "percent of residents": those years are recorded again under it,
# with the same numbers. 2012 to 2015 were not asked about and keep the earlier metadata.
poverty_then = recorded_metadata("fx_poverty_rate_annual", unit="percent of persons")
poverty_now = recorded_metadata("fx_poverty_rate_annual")
poverty_rows = []
for period, value in zip(years(2012, 14), POVERTY):
    if period[0] < "2016":
        poverty_rows.append(version(period, value, "final", FIRST, None, poverty_then))
    else:
        poverty_rows += [
            version(period, value, "final", FIRST, capture_time(9), poverty_then),
            version(period, value, "final", capture_time(9), None, poverty_now),
        ]
poverty_vintages = vintage_file(
    "fx_poverty_rate_annual", "annual",
    [{**poverty_then, "recorded_from": FIRST}, {**poverty_now, "recorded_from": capture_time(9)}],
    captures({8: "first", 9: "metadata"}, ("2012-01-01", "2025-12-31"), ("2016-01-01", "2025-12-31")),
    poverty_rows,
)

VINTAGES = {
    "fx_price_index": price_vintages,
    "fx_output_quarterly": output_vintages,
    "fx_poverty_rate_annual": poverty_vintages,
}


# --- one invented Claim, its lock and its latest rows (M20; ADR 0034) -----------------------------
#
# The claimant, the venue and the words are made up. The lock and the latest rows are the
# engine's answers on this fixture's own Series, kept as files beside this script
# (fixtures/claims/): `python fixtures/claims/make_claim.py` writes them, and
# tests/v2/test_fixture.py holds them to what the engine answers today.
CLAIM_ID = "2025-12-11-a-fixture-official-on-fixture-prices"
CLAIMS_DIR = Path(__file__).resolve().parent / "claims"
CLAIM = {
    "id": CLAIM_ID,
    "claimant": {"name": "A. Fixture", "role": "Fixture minister of prices (synthetic)", "party": "none"},
    "said_on": "2025-12-11",
    "venue": "A fixture press conference (synthetic)",
    "sources": [
        {"name": "Fixture broadcaster (synthetic)", "url": "https://video.example.org/fixture-briefing",
         "archive_url": "https://example.org/archive/2026/fixture-briefing", "locator": "at 12:40", "kind": "recording"},
        {"name": "Fixture gazette (synthetic)", "url": "https://example.org/fixture-gazette/briefing",
         "archive_url": "https://example.org/archive/2026/fixture-gazette-briefing", "locator": "paragraph 9",
         "kind": "transcript"},
    ],
    "quote": "The fixture price index stood at 109.5 in November, up about five percent since January.",
    "readings": [
        {"id": "index-in-november", "series": "fx_price_index", "transform": "lin", "measure": "value_at",
         "period": "2025-11"},
        {"id": "rise-since-january", "series": "fx_price_index", "transform": "lin", "measure": "change",
         "window": {"from": "2025-01-01", "to": "2025-11-30"},
         "alternative_windows": [{"from": "2024-11-01", "to": "2025-11-30"}, {"from": "2025-06-01", "to": "2025-11-30"}]},
        {"id": "from-a-year-earlier", "series": "fx_price_index_yoy", "transform": "lin", "measure": "value_at",
         "period": "2025-11"},
    ],
    "readings_not_measured": ["The index with fixture food and fuel left out."],
    "selection_note": "Kept in the fixture so that a Claim, its lock and its latest rows can be read in tests.",
    "checked_on": "2025-12-31",
    "corrections": [{"date": "2026-01-01", "reason": "The venue was first entered without its city (synthetic)."}],
    "topics": ["inflation"],
    "status": "public",
}
#: The fields a lock freezes, as atlas/content/claims.py lists them.
RECORD_FIELDS = ("claimant", "said_on", "said_at", "venue", "sources", "quote", "readings",
                 "readings_not_measured", "selection_note", "checked_on")
LOCK_NAME = f"{CLAIM_ID}.v1.lock.json"


def canonical(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def claims_file() -> tuple[dict, bytes | None, bytes | None]:
    """content/claims.json, and the bytes of the lock and of the latest rows when the files
    beside this script exist (they do not before make_claim.py has first written them)."""
    lock_path, latest_path = CLAIMS_DIR / "locks" / LOCK_NAME, CLAIMS_DIR / "latest.json"
    lock = lock_path.read_bytes() if lock_path.exists() else None
    latest = latest_path.read_bytes() if latest_path.exists() and lock is not None else None
    listed = []
    if lock is not None:
        held = json.loads(lock)
        listed = [{"version": 1, "locked_at": held["locked_at"], "reason": None,
                   "record_sha256": hashlib.sha256(canonical({k: CLAIM[k] for k in RECORD_FIELDS if k in CLAIM})).hexdigest(),
                   "state": "in_release", "sha256": hashlib.sha256(lock).hexdigest()}]
    return {"claims": [{**CLAIM, "locks": listed}] if lock is not None else []}, lock, latest


#: The headline Series (content/highlights.json): the first of a Segment is its row of the
#: Overview. Between them they show a Takeaway, a preliminary value, a Withheld Series, a stale
#: one, one with no cadence to compare over, and two Segments with nothing to show.
HIGHLIGHTS = {"segments": [
    {"segment": "economy_jobs", "series": ["fx_price_index", "fx_poverty_rate_annual", "fx_output_quarterly",
                                           "fx_price_index_yoy", "fx_payrolls_break"]},
    {"segment": "markets_money", "series": ["fx_exchange_index"]},
    {"segment": "infrastructure", "series": ["fx_permits_stale"]},
    {"segment": "governance_politics", "series": ["fx_vote_margin"]},
    {"segment": "disasters_health", "series": []},
    {"segment": "us_in_the_world", "series": []},
]}


#: Two invented Topics (content/topics.json, 0.6.0, M23). "inflation" shows everything a Topic
#: page may: a Companion that is an input, one from another cadence, one with a break and one
#: that is Withheld; a range with a member the Release does not hold; an Event and (by the
#: Claim's own `topics`) a Claim. "jobs" is the plain case. The quoted definitions are invented.
TOPICS = {"topics": [
    {
        "slug": "inflation", "title": "Inflation", "segment": "economy_jobs", "status": "public",
        "definition": {
            "quote": "The fixture price index measures the average change in the prices that synthetic households pay.",
            "source": {"name": "Fixture statistics office (synthetic), Handbook", "url": "https://example.org/fixture-handbook",
                       "archive_url": "https://example.org/archive/2026/fixture-handbook"},
        },
        "main": "fx_price_index_yoy",
        "series": ["fx_price_index_yoy", "fx_price_index", "fx_exchange_index", "fx_infl_b", "fx_not_in_this_release"],
        "companions": [
            {"series": "fx_price_index", "relation": "input"},
            {"series": "fx_payrolls_break", "relation": "same_survey"},
            {"series": "fx_poverty_rate_annual", "relation": "excludes_components"},
            {"series": "fx_exchange_index", "relation": "component"},
        ],
        "range": {
            "series": "fx_price_index_yoy", "label": "Fixture five",
            "indicator": {"id": "inflation", "name": "Inflation (y/y)"},
            "members": [{"key": "fx_price_index_yoy", "country": "USA"}, {"key": "fx_infl_b", "country": "FXB"},
                        {"key": "fx_infl_c", "country": "FXC"}, {"key": "fx_infl_d", "country": "FXD"},
                        {"key": "fx_infl_e", "country": "FXE"}],
        },
        "events": ["2024-09-18-fixture-rate-decision"],
    },
    {
        "slug": "jobs", "title": "Jobs", "segment": "economy_jobs", "status": "public",
        "definition": {
            "quote": "Fixture payrolls count the jobs on the books of synthetic employers in the middle of each month.",
            "source": {"name": "Fixture statistics office (synthetic), Payroll survey notes", "url": "https://example.org/fixture-payrolls",
                       "no_archive": "archiving_refused"},
        },
        "main": "fx_payrolls_break",
        "series": ["fx_payrolls_break", "fx_permits_stale"],
        "companions": [{"series": "fx_permits_stale", "relation": "same_release"}],
        "events": [],
    },
]}


def search_document(catalog: dict, withheld: list, events: dict, claims: dict, topics: dict) -> dict:
    """search.json, by the contract's own projection (atlas/release.py)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from atlas.release import search_document as project
    return project(catalog, withheld, events, claims, topics)


def dump(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def build(root: Path, claims: bool = True, bulk: bool = True) -> Path:
    """Write the fixture in PUBLIC layout under root: releases/{id}/ and CURRENT. ``claims``
    False leaves the Claim out: the data files alone, which is what make_claim.py computes
    the Claim's lock from. ``bulk`` False leaves the bulk files out, which is what
    bulk/make_bulk.py makes them from; otherwise they are copied in as that script wrote them
    (0.7.0, M25; from 0.8.0 with what each says of model training)."""
    release = root / "releases" / RELEASE_ID
    if release.exists():
        shutil.rmtree(release)
    (release / "series").mkdir(parents=True)
    (release / "derived").mkdir()
    (release / "vintages").mkdir()
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
    for key, doc in VINTAGES.items():
        data = dump(doc)
        (release / "vintages" / f"{key}.json").write_bytes(data)
        rows[key]["vintages_sha256"] = hashlib.sha256(data).hexdigest()

    manifest = {
        "schema_version": "0.8.0",
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
    (release / "content" / "events.json").write_bytes(dump(EVENTS))
    listed, lock, latest = claims_file() if claims else ({"claims": []}, None, None)
    (release / "content" / "claims.json").write_bytes(dump(listed))
    if lock is not None:
        (release / "locks").mkdir()
        (release / "locks" / LOCK_NAME).write_bytes(lock)
    if latest is not None:
        (release / "evidence").mkdir()
        (release / "evidence" / "latest.json").write_bytes(latest)
    (release / "content" / "highlights.json").write_bytes(dump(HIGHLIGHTS))
    (release / "content" / "topics.json").write_bytes(dump(TOPICS))
    (release / "search.json").write_bytes(dump(search_document(CATALOG, manifest["withheld"], EVENTS, listed, TOPICS)))
    if bulk and BULK.is_dir():
        (release / "downloads").mkdir()
        for path in sorted(BULK.iterdir()):
            (release / "downloads" / path.name).write_bytes(path.read_bytes())
    (root / "CURRENT").write_text(RELEASE_ID + "\n")
    return release


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "public"
    print(build(target))
