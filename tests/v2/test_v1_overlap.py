"""``scripts/v1-overlap.mjs`` (PLAN M13): does a Series fetched from its Origin say what v1
said, within a stated tolerance, or is the difference explained? Run as Alex runs it, on two
small release roots whose values are invented here, and once on the committed statement to
see that it covers every series of v1's that is live (M16)."""
from __future__ import annotations

import json
import subprocess
from datetime import date, timedelta
from pathlib import Path

from atlas.catalog import load_catalog
from atlas.catalog.load import leaves
from atlas.period import period_bounds

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "v1-overlap.mjs"


def root(path: Path, series: dict[str, dict], representation: str) -> Path:
    """A release root with only what the script reads."""
    release = path / "releases" / "r1"
    (release / "series").mkdir(parents=True)
    (path / "CURRENT").write_text("r1\n")
    entries = []
    for key, spec in series.items():
        observations = []
        for period, value in spec["values"].items():
            first, last = period_bounds(spec["freq"], period)
            observations.append({"period": period, "period_start": first, "period_end": last,
                                 "value": value, "status": "final" if value is not None else "missing"})
        (release / "series" / f"{key}.json").write_text(json.dumps(
            {"key": key, "freq": spec["freq"], "representation": representation, "observations": observations}))
        entries.append({"key": key, "measure_kind": spec.get("measure_kind", "rate"), "agg": spec.get("agg", "mean"),
                        "continuity": "discrete"})
    (release / "catalog.json").write_text(json.dumps({"series": entries}))
    return path


def months(start_year: int, count: int, value) -> dict[str, float]:
    return {f"{start_year + n // 12}-{n % 12 + 1:02d}": value(n) for n in range(count)}


def run(tmp_path: Path, native: dict, legacy: dict, statement: list[dict], min_overlap=12):
    root(tmp_path / "native", native, "native")
    root(tmp_path / "legacy", legacy, "legacy_monthly_rounded")
    path = tmp_path / "statement.json"
    path.write_text(json.dumps({"format": 1, "about": "test", "min_overlap": min_overlap, "series": statement}))
    done = subprocess.run(["node", str(SCRIPT), "--native", str(tmp_path / "native"), "--legacy",
                           str(tmp_path / "legacy"), "--statement", str(path)],
                          capture_output=True, text=True, timeout=120, check=False)
    return done.returncode, {line.split()[0]: line for line in done.stdout.splitlines()}, done.stderr


def test_a_series_within_half_a_unit_of_v1s_last_decimal_matches(tmp_path):
    native = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.1234 + n)}}
    legacy = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: round(4.1234 + n, 2))}}
    code, lines, err = run(tmp_path, native, legacy, [{"key": "a", "abs": 0.005}])
    assert code == 0, err
    assert lines["a"].split()[1] == "matches" and "n=24" in lines["a"] and "max=0.00340" in lines["a"]


def test_a_series_further_off_than_its_tolerance_fails_and_says_how_many_periods(tmp_path):
    native = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.0 + (0.02 if n == 5 else 0))}}
    legacy = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.0)}}
    code, lines, _ = run(tmp_path, native, legacy, [{"key": "a", "abs": 0.005}])
    assert code == 1
    assert "FAILED: 1 Periods are further from v1 than the tolerance" in lines["a"] and "at 2020-06" in lines["a"]


def test_a_period_explained_by_name_is_counted_and_does_not_fail(tmp_path):
    native = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.0 + (0.5 if n == 5 else 0))}}
    legacy = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.0)}}
    code, lines, _ = run(tmp_path, native, legacy,
                         [{"key": "a", "abs": 0.005, "exceptions": {"2020-06": "v1 held another day's figure"}}])
    assert code == 0 and "explained=1" in lines["a"] and "beyond=0" in lines["a"]
    # An explanation of a Period v1 never held explains nothing.
    code, lines, _ = run(tmp_path / "again", native, legacy,
                         [{"key": "a", "abs": 0.005, "exceptions": {"1999-01": "x"}}])
    assert code == 1 and "the statement explains 1999-01, which v1 does not hold" in lines["a"]


def test_a_daily_series_is_brought_to_v1s_months_by_the_engine(tmp_path):
    # January 2024: the engine's mean over the business days, and the unfinished month is partial.
    days, day = {}, date(2024, 1, 1)
    while day <= date(2024, 2, 14):
        if day.isoweekday() <= 5:
            days[day.isoformat()] = 2.0 if day.month == 1 and day.day <= 15 else 4.0 if day.month == 1 else 9.0
        day += timedelta(days=1)
    january = [v for d, v in days.items() if d.startswith("2024-01")]
    mean = sum(january) / len(january)
    native = {"a": {"freq": "business_daily", "values": days}}
    legacy = {"a": {"freq": "monthly", "values": {"2024-01": round(mean, 2), "2024-02": 1.0}}}
    code, lines, err = run(tmp_path, native, legacy, [{"key": "a", "abs": 0.005}], min_overlap=1)
    assert code == 0, (lines, err)
    assert "n=1 " in lines["a"] and "partial=1" in lines["a"]


def test_a_unit_factor_brings_the_origins_unit_to_v1s(tmp_path):
    native = {"a": {"freq": "monthly", "values": months(2020, 12, lambda n: 5_000_000_000_000.25), "measure_kind": "stock", "agg": "last"}}
    legacy = {"a": {"freq": "monthly", "values": months(2020, 12, lambda n: 5_000_000.0)}}
    code, lines, _ = run(tmp_path, native, legacy, [{"key": "a", "abs": 1, "factor": 1e-6}])
    assert code == 0 and lines["a"].split()[1] == "matches"


def test_weeks_can_be_filed_by_the_day_they_are_dated_as_v1_filed_them(tmp_path):
    # 2026-W05 runs 26 January to 1 February: its Wednesday is in January, its Sunday in February.
    native = {"a": {"freq": "weekly", "measure_kind": "stock",
                    "values": {"2026-W02": 10.0, "2026-W03": 10.0, "2026-W04": 10.0, "2026-W05": 50.0, "2026-W06": 10.0}}}
    legacy = {"a": {"freq": "monthly", "values": {"2026-01": 20.0, "2026-02": 10.0}}}
    code, lines, _ = run(tmp_path, native, legacy, [{"key": "a", "abs": 0.0005, "reference_day_offset": 2}], min_overlap=2)
    assert code == 0 and "n=2" in lines["a"]
    code, lines, _ = run(tmp_path / "engine", native, legacy, [{"key": "a", "abs": 0.0005}], min_overlap=1)
    assert code == 1  # the engine files W05 under February: a difference of representation


def test_too_little_overlap_or_a_value_on_one_side_only_is_not_a_pass(tmp_path):
    native = {"a": {"freq": "monthly", "values": months(2020, 6, lambda n: 4.0)},
              "b": {"freq": "monthly", "values": months(2020, 24, lambda n: None if n == 3 else 4.0)}}
    legacy = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.0)},
              "b": {"freq": "monthly", "values": months(2020, 24, lambda n: 4.0)}}
    code, lines, _ = run(tmp_path, native, legacy, [{"key": "a", "abs": 0.005}, {"key": "b", "abs": 0.005}])
    assert code == 1
    assert "FAILED: only 6 Periods overlap" in lines["a"]
    assert "FAILED: 1 Periods have a value on one side only" in lines["b"]


def test_a_series_v1_never_had_is_said_to_have_no_counterpart_and_checked(tmp_path):
    native = {"new": {"freq": "monthly", "values": months(2020, 24, lambda n: 1.0)}}
    code, lines, _ = run(tmp_path, native, {}, [{"key": "new", "v1": None}])
    assert code == 0 and "no v1 counterpart" in lines["new"]
    code, lines, _ = run(tmp_path / "again", native, native, [{"key": "new", "v1": None}])
    assert code == 1


def test_a_series_missing_from_a_release_or_not_v1s_own_values_fails(tmp_path):
    native = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 1.0)}}
    code, lines, _ = run(tmp_path, native, {}, [{"key": "a", "abs": 0.005}])
    assert code == 1 and "not in the legacy release" in lines["a"]


def test_the_committed_statement_covers_every_v1_series_that_is_live():
    """M13 stated the Series of BLS, the Treasury and the Board; M16 the rest (PLAN M16: "the
    comparison table is attached with every difference explained"). Every series of v1's that
    the coverage report calls live is stated, and nothing withheld is."""
    from atlas.catalog.v1coverage import CLASSES, account
    from atlas.rights import load_register

    statement = json.loads((ROOT / "checks" / "v1-overlap.json").read_text())
    stated = {item["key"]: item for item in statement["series"]}
    assert len(stated) == len(statement["series"])  # no Series is stated twice
    catalog = load_catalog()
    rows = account(catalog, load_register())
    live = {key for key, row in rows.items() if row.klass != CLASSES[2]}
    v1 = {*json.loads((ROOT / "data" / "atlas.json").read_text())["series"], "approval", "pres_margin", "house_margin"}
    assert len(live) == 51 and live <= v1
    assert {key for key, item in stated.items() if "v1" not in item} == live
    # Every Series of the three agencies M13 covered is still stated, in v1 or not.
    agencies = ("bls", "treasury_fiscal_data", "fed_board")
    stored = {key for key, entry in catalog.items() if entry["status"] == "active"
              and (entry.get("source", {}).get("channel") or {}).get("adapter") in agencies}
    assert stored <= set(stated)
    for key, item in stated.items():
        assert len(item.get("why", "")) > 15, key
        if "v1" in item:
            assert item["v1"] is None and key not in v1 and catalog[key]["status"] == "active", key
        else:
            assert item.get("abs", 0) > 0, key
        for period, found in item.get("exceptions", {}).items():
            assert period_bounds(catalog[key]["freq"], period) or period_bounds("quarterly", period), (key, period)
            assert len(found) > 40, (key, period)  # each exception says what was found
    # A Series that is another quantity than v1's says so in the Catalog too.
    assert {key for key, item in stated.items() if item.get("different")} == {
        key for key in live if catalog[key]["migration"].get("change") == "different"} == {"cpi_yoy"}
    assert statement["min_overlap"] >= 100


def test_the_written_comparison_has_a_row_for_every_stated_series_and_no_agency_figure():
    """docs/v2/v1-overlap.md is what the check found when it was run on real captures. It
    holds counts and differences. The table is the script's own (--markdown)."""
    import re

    text = (ROOT / "docs" / "v2" / "v1-overlap.md").read_text()
    statement = json.loads((ROOT / "checks" / "v1-overlap.json").read_text())
    table = re.findall(r"^\| `([a-z0-9_]+)` \| .* \| ([a-z0-9 ]+) \|$", text, re.MULTILINE)
    assert [key for key, _ in table] == [item["key"] for item in statement["series"]]
    verdicts = {key: verdict for key, verdict in table}
    assert set(verdicts.values()) == {"matches", "different by design", "no v1 counterpart"}
    assert [key for key, verdict in verdicts.items() if verdict == "different by design"] == ["cpi_yoy"]
    assert "No figure fetched from an agency is on this page or in the repository" in text


def test_a_period_v1_holds_and_the_origin_does_not_inside_the_common_span_is_a_gap(tmp_path):
    values = months(2020, 24, lambda n: 4.0)
    holed = {period: value for period, value in values.items() if period != "2020-09"}
    code, lines, _ = run(tmp_path, {"a": {"freq": "monthly", "values": holed}},
                         {"a": {"freq": "monthly", "values": values}}, [{"key": "a", "abs": 0.005}])
    assert code == 1 and "FAILED: 1 Periods have a value on one side only" in lines["a"]
    # Before the Origin's first Period and after its last, v1 is simply longer: not a gap.
    shorter = {period: value for period, value in values.items() if "2020-06" <= period <= "2021-09"}
    code, lines, _ = run(tmp_path / "shorter", {"a": {"freq": "monthly", "values": shorter}},
                         {"a": {"freq": "monthly", "values": values}}, [{"key": "a", "abs": 0.005}])
    assert code == 0 and "n=16" in lines["a"]


def test_the_tolerance_is_not_widened_for_a_large_figure(tmp_path):
    # 0.004 beyond v1 on a figure of five million is beyond a tolerance of 0.0005.
    native = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 5_000_000.004)}}
    legacy = {"a": {"freq": "monthly", "values": months(2020, 24, lambda n: 5_000_000.0)}}
    code, lines, _ = run(tmp_path, native, legacy, [{"key": "a", "abs": 0.0005}])
    assert code == 1 and "FAILED: 24 Periods are further from v1" in lines["a"]


def test_a_new_series_that_is_not_in_the_native_release_is_not_passed_over(tmp_path):
    other = {"b": {"freq": "monthly", "values": months(2020, 24, lambda n: 1.0)}}
    code, lines, _ = run(tmp_path, other, {}, [{"key": "new", "v1": None}])
    assert code == 1 and "not in the native release" in lines["new"]
