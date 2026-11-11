"""Periods: the span of time an Observation describes (CONTEXT.md; schema/README.md).

A Period is named by a label whose shape depends on the Series' native frequency. This module
answers two questions about a label: which calendar days it covers (both ends inclusive) and
which Period comes next. It is the Python twin of ``packages/core/src/period.ts``; both run
``checks/period-cases.json``. A label that does not fit its frequency has no answer (None).
"""
from __future__ import annotations

import calendar
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

# Matched with fullmatch, and with [0-9] rather than \d, so that a trailing newline or a
# non-ASCII digit is refused exactly as the TypeScript twin refuses it.
_DAY = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
_WEEK = re.compile(r"([0-9]{4})-W([0-9]{2})")
_MONTH = re.compile(r"([0-9]{4})-([0-9]{2})")
_QUARTER = re.compile(r"([0-9]{4})-Q([1-4])")
_YEAR = re.compile(r"([0-9]{4})")
_ONE_DAY = timedelta(days=1)


def _day(label: str) -> date | None:
    m = _DAY.fullmatch(label)
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
        m = _WEEK.fullmatch(label)
        if not m:
            return None
        try:
            monday = date.fromisocalendar(int(m[1]), int(m[2]), 1)
        except ValueError:
            return None
        return monday, monday + timedelta(days=6)
    if freq == "monthly":
        m = _MONTH.fullmatch(label)
        if not m or not 1 <= int(m[2]) <= 12:
            return None
        year, month = int(m[1]), int(m[2])
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    if freq == "quarterly":
        m = _QUARTER.fullmatch(label)
        if not m:
            return None
        year, last = int(m[1]), int(m[2]) * 3
        return date(year, last - 2, 1), date(year, last, calendar.monthrange(year, last)[1])
    if freq == "annual":
        m = _YEAR.fullmatch(label)
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
    """The label of the Period that follows.

    None for an irregular Series, a bad label, or the last Period of the calendar (which ends on
    9999-12-31): a successor that would not lie wholly inside the calendar does not exist.
    """
    span = _span(freq, label)
    if span is None or freq == "irregular":
        return None
    try:
        after = span[1] + _ONE_DAY
        while freq == "business_daily" and after.isoweekday() > 5:
            after += _ONE_DAY
    except OverflowError:
        return None
    if freq in ("daily", "business_daily"):
        candidate = after.isoformat()
    elif freq == "weekly":
        iso = after.isocalendar()
        candidate = f"{iso[0]:04d}-W{iso[1]:02d}"
    elif freq == "monthly":
        candidate = f"{after.year:04d}-{after.month:02d}"
    elif freq == "quarterly":
        candidate = f"{after.year:04d}-Q{(after.month - 1) // 3 + 1}"
    else:
        candidate = f"{after.year:04d}"
    return candidate if _span(freq, candidate) is not None else None
