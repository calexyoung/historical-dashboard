"""Periods: the span of time an Observation describes (CONTEXT.md; schema/README.md).

A Period is named by a label whose shape depends on the Series' native frequency. This module
answers two questions about a label: which calendar days it covers (both ends inclusive) and
which Period comes next. It is the Python twin of ``packages/core/src/period.ts``; both run
``checks/period-cases.json``. A label that does not fit its frequency has no answer (None).
"""
from __future__ import annotations

import re
from datetime import date, timedelta

FREQUENCIES = (
    "daily",
    "business_daily",
    "weekly",
    "monthly",
    "quarterly",
    "annual",
    "irregular",
)

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_WEEK = re.compile(r"^(\d{4})-W(\d{2})$")
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_QUARTER = re.compile(r"^(\d{4})-Q([1-4])$")
_YEAR = re.compile(r"^(\d{4})$")
_ONE_DAY = timedelta(days=1)


def _day(label: str) -> date | None:
    m = _DAY.match(label)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def _span(freq: str, label: str) -> tuple[date, date] | None:
    try:
        return _span_unchecked(freq, label)
    except (ValueError, OverflowError):  # a year at the edge of the calendar
        return None


def _span_unchecked(freq: str, label: str) -> tuple[date, date] | None:
    if not isinstance(label, str):
        return None
    if freq in ("daily", "business_daily", "irregular"):
        d = _day(label)
        if d is None or (freq == "business_daily" and d.isoweekday() > 5):
            return None
        return d, d
    if freq == "weekly":
        m = _WEEK.match(label)
        if not m:
            return None
        try:
            monday = date.fromisocalendar(int(m[1]), int(m[2]), 1)
        except ValueError:
            return None
        return monday, monday + timedelta(days=6)
    if freq == "monthly":
        m = _MONTH.match(label)
        if not m or not 1 <= int(m[2]) <= 12:
            return None
        year, month = int(m[1]), int(m[2])
        after = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        return date(year, month, 1), after - _ONE_DAY
    if freq == "quarterly":
        m = _QUARTER.match(label)
        if not m:
            return None
        year, quarter = int(m[1]), int(m[2])
        after = date(year + 1, 1, 1) if quarter == 4 else date(year, quarter * 3 + 1, 1)
        return date(year, quarter * 3 - 2, 1), after - _ONE_DAY
    if freq == "annual":
        m = _YEAR.match(label)
        if not m or int(m[1]) < 1:
            return None
        return date(int(m[1]), 1, 1), date(int(m[1]), 12, 31)
    return None


def period_bounds(freq: str, label: str) -> tuple[str, str] | None:
    """The first and last calendar day of the Period, both inclusive, as YYYY-MM-DD."""
    span = _span(freq, label)
    if span is None:
        return None
    return span[0].isoformat(), span[1].isoformat()


def next_period(freq: str, label: str) -> str | None:
    """The label of the Period that follows. None for an irregular Series or a bad label."""
    span = _span(freq, label)
    if span is None or freq == "irregular":
        return None
    after = span[1] + _ONE_DAY
    if freq == "daily":
        return after.isoformat()
    if freq == "business_daily":
        while after.isoweekday() > 5:
            after += _ONE_DAY
        return after.isoformat()
    if freq == "weekly":
        iso = after.isocalendar()
        return f"{iso[0]:04d}-W{iso[1]:02d}"
    if freq == "monthly":
        return f"{after.year:04d}-{after.month:02d}"
    if freq == "quarterly":
        return f"{after.year:04d}-Q{(after.month - 1) // 3 + 1}"
    return f"{after.year:04d}"
