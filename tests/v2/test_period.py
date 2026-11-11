"""Period arithmetic against the shared, calendar-derived table (schema/README.md)."""
import json
from pathlib import Path

import pytest

from atlas.period import next_period, period_bounds

TABLE = json.loads(
    (Path(__file__).resolve().parents[2] / "checks" / "period-cases.json").read_text()
)


@pytest.mark.parametrize("case", TABLE["valid"], ids=lambda c: f"{c['freq']} {c['label']}")
def test_bounds_and_next(case):
    assert period_bounds(case["freq"], case["label"]) == (case["start"], case["end"])
    assert next_period(case["freq"], case["label"]) == case["next"]


@pytest.mark.parametrize("case", TABLE["invalid"], ids=lambda c: f"{c['freq']} {c['label']}")
def test_a_label_that_does_not_fit_its_frequency_has_no_bounds(case):
    assert period_bounds(case["freq"], case["label"]) is None
    assert next_period(case["freq"], case["label"]) is None
