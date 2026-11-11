"""`atlas legacy-release`: v1's committed output as a local-profile Release (PLAN M2, 6.1).

The converter reads v1's files in place (data/atlas.json, the v1 catalog, events.yaml,
politics.yaml, approval.yaml) and writes a Release under a temporary $ATLAS_LOCAL. These tests
read v1's real values, so they print none of them and nothing they write leaves the temp dir.
"""
import hashlib
import json
import socket
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml

from atlas import cli
from atlas.legacy import LegacyRefused, legacy_release
from atlas.release import validate_release
from atlas.staging import PromotionRefused

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 11, 16, 30, 0, tzinfo=UTC)
V1 = json.loads((ROOT / "data" / "atlas.json").read_text())


@pytest.fixture(scope="module")
def release(tmp_path_factory) -> Path:
    return legacy_release(out=tmp_path_factory.mktemp("local"), now=NOW)


def read(release: Path, path: str):
    return json.loads((release / path).read_text())


def entry(release: Path, key: str) -> dict:
    return next(e for e in read(release, "catalog.json")["series"] if e["key"] == key)


def series(release: Path, key: str) -> dict:
    folder = "derived" if "recipe" in entry(release, key) else "series"
    return read(release, f"{folder}/{key}.json")


def values(release: Path, key: str) -> dict:
    return {o["period"]: o["value"] for o in series(release, key)["observations"]}


def assert_same_values(got, expected, what: str) -> None:
    """Compare v1's real values without ever printing one (PLAN 6.1: CI logs hold no v1 data).

    A plain ``assert got == expected`` would have pytest print both sides. This names the
    Series and the Periods that differ and nothing else.
    """
    if isinstance(got, dict) and isinstance(expected, dict):
        differing = sorted(k for k in got.keys() | expected.keys() if got.get(k, ...) != expected.get(k, ...))
    else:
        got, expected = list(got), list(expected)
        differing = [i for i in range(max(len(got), len(expected))) if got[i : i + 1] != expected[i : i + 1]]
    if differing:
        pytest.fail(f"{what}: {len(differing)} values differ (first at {differing[0]}); values are not printed", pytrace=False)


# --- the acceptance criteria ---------------------------------------------------------------


def test_all_126_series_and_83_events_are_in_the_release_and_it_validates(release):
    assert validate_release(release) == []
    catalog = read(release, "catalog.json")["series"]
    assert len(catalog) == 126
    assert {e["key"] for e in catalog} == set(V1["series"]) | {"approval", "pres_margin", "house_margin"}
    assert len(list(release.glob("series/*.json"))) + len(list(release.glob("derived/*.json"))) == 126
    events = [a for a in read(release, "content/annotations.json")["annotations"] if a["kind"] == "event"]
    assert len(events) == 83
    assert read(release, "manifest.json")["withheld"] == []


def test_it_is_a_local_profile_release_of_legacy_series_with_rights_not_settled(release):
    manifest = read(release, "manifest.json")
    assert manifest["profile"] == "local"
    assert manifest["rights_register"] == {"version": "none", "sha256": None, "signed": False}
    for item in read(release, "catalog.json")["series"]:
        assert item["representation"] == "legacy_monthly_rounded", item["key"]
        assert item["rights"]["status"] == "unknown", item["key"]
        assert item["rights"]["reviewed"] is None, item["key"]
    assert {row["representation"] for row in manifest["series"].values()} == {"legacy_monthly_rounded"}
    assert (release.parent.parent / "CURRENT").read_text().strip() == release.name


def test_the_converter_cannot_write_a_public_profile(tmp_path, monkeypatch, capsys):
    """There is no switch for it, and no root it will write to that is public or the store."""
    with pytest.raises(SystemExit):
        cli.main(["legacy-release", "--profile", "public"])
    capsys.readouterr()

    public, store = tmp_path / "public", tmp_path / "store"
    monkeypatch.setenv("ATLAS_PUBLIC", str(public))
    monkeypatch.setenv("ATLAS_STORE", str(store))
    alias = tmp_path / "alias"
    public.mkdir()
    alias.symlink_to(public, target_is_directory=True)
    for out in (public, public / "nested", store, store / "x" / "y", alias, alias / "nested", tmp_path):
        with pytest.raises(LegacyRefused):
            legacy_release(out=out, now=NOW)
    assert list(public.iterdir()) == []
    assert not store.exists()


def test_nothing_is_written_to_the_store_and_no_network_call_is_made(tmp_path, monkeypatch):
    def no_network(*args, **kwargs):
        raise AssertionError("the legacy converter opened a socket")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket, "getaddrinfo", no_network)
    public, store, local = tmp_path / "public", tmp_path / "store", tmp_path / "local"
    monkeypatch.setenv("ATLAS_PUBLIC", str(public))
    monkeypatch.setenv("ATLAS_STORE", str(store))
    monkeypatch.setenv("ATLAS_LOCAL", str(local))
    promoted = legacy_release(now=NOW)  # the root comes from $ATLAS_LOCAL
    assert promoted.parent == local / "releases"
    assert not store.exists() and not public.exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["local"]
    assert sorted(p.name for p in local.iterdir()) == ["CURRENT", "releases"]


def test_the_converter_does_not_write_through_a_link_into_the_store_or_a_public_root(tmp_path, monkeypatch):
    """Resolving the root is not enough: a link *under* it could lead anywhere."""
    public, store = tmp_path / "public", tmp_path / "store"
    monkeypatch.setenv("ATLAS_PUBLIC", str(public))
    monkeypatch.setenv("ATLAS_STORE", str(store))
    (public / "releases").mkdir(parents=True)
    store.mkdir()
    for name, target in ((".staging", store), ("releases", public / "releases")):
        local = tmp_path / f"local-{name.strip('.')}"
        local.mkdir()
        (local / name).symlink_to(target, target_is_directory=True)
        with pytest.raises((LegacyRefused, PromotionRefused)):
            legacy_release(out=local, now=NOW)
        assert not (local / "CURRENT").exists()
    assert list(store.iterdir()) == []
    assert list((public / "releases").iterdir()) == []


def test_v1_files_are_read_in_place_and_left_as_they_were(tmp_path):
    inputs = ["data/atlas.json", "atlas/catalog.yaml", "atlas/events.yaml", "atlas/politics.yaml", "atlas/approval.yaml"]
    before = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in inputs}
    release = legacy_release(out=tmp_path / "local", now=NOW)
    assert {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in inputs} == before
    recorded = {row["path"]: row for row in read(release, "manifest.json")["inputs"]}
    assert set(recorded) == set(inputs)
    for path, row in recorded.items():
        assert row["sha256"] == before[path]
        assert row["commit"] is None or len(row["commit"]) == 40


def test_the_manifest_keeps_conversion_time_apart_from_v1s_generated_time(release):
    manifest = read(release, "manifest.json")
    assert manifest["created"] == "2026-11-11T16:30:00Z"
    assert release.name.startswith("20261111T163000Z-")
    atlas_json = next(row for row in manifest["inputs"] if row["path"] == "data/atlas.json")
    assert atlas_json["generated"] == V1["generated"]
    assert atlas_json["generated"] != manifest["created"]
    assert all(row["generated"] is None for row in manifest["inputs"] if row["path"] != "data/atlas.json")


# --- what each Series keeps --------------------------------------------------------------


def month_to_period(freq: str, month: str) -> str:
    year, m = month[:4], int(month[5:7])
    return {"monthly": month, "quarterly": f"{year}-Q{(m - 1) // 3 + 1}", "annual": year}[freq]


def test_every_v1_value_is_carried_over_unchanged_at_its_real_cadence(release):
    cadence = {"M": "monthly", "W": "monthly", "D": "monthly", "Q": "quarterly", "A": "annual"}
    for key, v1 in V1["series"].items():
        freq = cadence[V1["meta"][key]["freq"]]
        item = entry(release, key)
        assert item["freq"] == freq, key
        assert item["continuity"] == "discrete", key
        expected = {month_to_period(freq, m): v for m, v in zip(v1["d"], v1["v"], strict=True)}
        got = {p: v for p, v in values(release, key).items() if v is not None}
        assert_same_values(got, expected, key)
        assert item["name"] == V1["meta"][key]["name"]


def test_a_quarterly_series_has_one_observation_per_quarter_not_three_months(release):
    gdp = series(release, "gdp")
    assert gdp["freq"] == "quarterly"
    assert gdp["observations"][0]["period"] == "2000-Q1"
    assert gdp["observations"][0]["period_start"] == "2000-01-01"
    assert gdp["observations"][0]["period_end"] == "2000-03-31"
    assert len(gdp["observations"]) == len(V1["series"]["gdp"]["d"])


def test_an_annual_series_has_one_observation_per_year(release):
    income = series(release, "income")
    assert income["freq"] == "annual"
    assert [o["period"] for o in income["observations"][:2]] == ["2000", "2001"]


def test_months_v1_left_out_are_explicit_gaps(release):
    gold = series(release, "gold")["observations"]
    missing = [o for o in gold if o["status"] == "missing"]
    assert missing and all(o["value"] is None for o in missing)
    present = {o["period"] for o in gold if o["status"] != "missing"}
    assert present == set(V1["series"]["gold"]["d"])


def test_election_margins_are_held_and_dated_to_election_day(release):
    politics = yaml.safe_load((ROOT / "atlas" / "politics.yaml").read_text())
    for key, kind in (("pres_margin", "president"), ("house_margin", "house")):
        item = entry(release, key)
        assert (item["freq"], item["continuity"]) == ("irregular", "held")
        assert item["source"]["channel"]["via"] == "hand_entered"
        got = values(release, key)
        assert len(got) == len(politics["elections"][kind])
        expected = {}
        for year, (dem, rep) in politics["elections"][kind].items():
            day = next(p for p in got if p.startswith(f"{year}-11-"))
            expected[day] = round((dem - rep) / (dem + rep) * 100, 2)
        assert_same_values(got, expected, key)
    days = list(values(release, "pres_margin"))
    assert days[0] == "2000-11-07" and "2012-11-06" in days and days[-1] == "2024-11-05"


def test_election_margins_equal_what_v1_built(release):
    from atlas import build as v1_build

    data = v1_build.with_politics({"series": {}, "meta": {}}, v1_build.load_politics())
    for key in ("pres_margin", "house_margin"):
        assert_same_values(list(values(release, key).values()), data["series"][key]["v"], key)


def test_approval_is_quarterly_as_it_was_entered(release):
    approval = yaml.safe_load((ROOT / "atlas" / "approval.yaml").read_text())["approval"]
    item = entry(release, "approval")
    assert (item["freq"], item["continuity"]) == ("quarterly", "discrete")
    assert item["source"]["channel"]["via"] == "hand_entered"
    got = values(release, "approval")
    entered = {f"{y}-Q{q + 1}": float(v) for y, row in approval.items() for q, v in enumerate(row) if v is not None}
    assert "2001-Q4" in entered
    assert_same_values({p: v for p, v in got.items() if v is not None}, entered, "approval")


def test_each_series_keeps_its_v1_channel_and_the_origin_is_not_invented(release):
    spx, unrate, uk = entry(release, "spx"), entry(release, "unrate"), entry(release, "uk_cpi")
    assert spx["source"]["channel"]["via"] == "yahoo"
    assert spx["source"]["origin"]["origin_id"] == "^GSPC"
    assert unrate["source"]["channel"]["via"] == "fred"
    assert unrate["source"]["origin"]["origin_id"] == "UNRATE"
    # v1 never recorded which agency produces a FRED or Yahoo series; the converter does not guess.
    assert unrate["source"]["origin"]["producer"] == "Not recorded by v1"
    assert spx["source"]["origin"]["producer"] == "Not recorded by v1"
    assert uk["source"]["channel"]["via"] == "direct"
    assert uk["source"]["origin"]["producer"] == "ONS"
    manifest = read(release, "manifest.json")["series"]
    assert manifest["spx"]["channel"] == "yahoo" and manifest["unrate"]["channel"] == "fred"
    vias = {e["source"]["channel"]["via"] for e in read(release, "catalog.json")["series"]}
    assert vias == {"fred", "yahoo", "direct", "hand_entered", "computed"}


def test_v1s_derived_series_keep_their_lineage(release):
    assert entry(release, "cpi_yoy")["recipe"] == {
        "op": "pct_change", "inputs": ["cpi"], "order": "aggregate_then_compute", "params": {"lag": 12},
    }
    assert entry(release, "gdp_yoy")["recipe"]["params"] == {"lag": 4}
    assert entry(release, "cn_gdp_yoy")["recipe"]["params"] == {"lag": 1}
    assert entry(release, "gold_eur")["recipe"] == {
        "op": "ratio", "inputs": ["gold", "eurusd"], "order": "aggregate_then_compute",
    }
    derived = {p.stem for p in release.glob("derived/*.json")}
    parents = {k for k, m in V1["meta"].items() if "parent" in m}
    assert derived == parents | {"gold_eur"}
    assert len(parents) == 14
    manifest = read(release, "manifest.json")["series"]
    assert manifest["cpi_yoy"]["kind"] == "derived" and manifest["cpi"]["kind"] == "stored"
    # the source of a computed series is what v1 recorded for it; its inputs are its lineage
    assert entry(release, "cpi_yoy")["source"]["channel"]["via"] == "fred"
    assert entry(release, "gold_eur")["source"]["channel"]["via"] == "computed"
    assert entry(release, "gold_eur")["source"]["origin"]["origin_id"] == "gold / eurusd"


def test_catalog_details_v1_recorded_are_kept(release):
    spx = entry(release, "spx")
    assert spx["unit"] == "index" and spx["agg"] == "last" and spx["max_lag"] == "P1M"
    assert spx["range"] == [500, 15000]
    assert spx["segment"] == "markets_money"
    assert "Month-end close" in spx["description"]
    assert entry(release, "unrate")["segment"] == "economy_jobs"
    assert entry(release, "approval")["segment"] == "governance_politics"
    assert entry(release, "dax")["segment"] == "us_in_the_world"
    assert entry(release, "unrate")["measure_kind"] == "rate"
    assert entry(release, "gdp")["measure_kind"] == "annualized"
    assert entry(release, "payems")["measure_kind"] == "stock"
    assert entry(release, "claims")["measure_kind"] == "flow"
    assert entry(release, "cpi")["measure_kind"] == "index"
    assert entry(release, "spx")["topics"] == ["us-markets"]  # v1's own category, kept for its picker
    assert all(e["status"] == "active" for e in read(release, "catalog.json")["series"])


# --- annotations -----------------------------------------------------------------------------


def annotations(release: Path, kind: str) -> list[dict]:
    return [a for a in read(release, "content/annotations.json")["annotations"] if a["kind"] == kind]


def test_events_keep_their_date_category_and_citation(release):
    v1_events = yaml.safe_load((ROOT / "atlas" / "events.yaml").read_text())
    events = annotations(release, "event")
    assert [e["label"] for e in events] == [e["title"] for e in v1_events]
    assert [e["category"] for e in events] == [e["cat"] for e in v1_events]
    assert [e["source"]["url"] for e in events] == [e["url"] for e in v1_events]
    by_label = {e["label"]: e for e in events}
    assert by_label["September 11 attacks"]["anchor"] == {"type": "date", "date": "2001-09-11"}
    # v1 gives this one a month only: it stays a month, no day is made up
    assert by_label["US recession begins (dot-com bust)"]["anchor"] == {"type": "period", "period": "2001-03"}


def test_governance_bands_become_spans_at_v1s_month_resolution(release):
    spans = annotations(release, "governance")
    by_set: dict[str, list[dict]] = {}
    for span in spans:
        by_set.setdefault(span["category"], []).append(span)
    assert set(by_set) == {"pres", "fed_chair", "treasury", "house", "senate", "shutdowns"}
    obama = next(s for s in by_set["pres"] if s["label"] == "Obama")
    # v1: ["2009-01", "2017-01" (exclusive)] -> first day of the first month to the last day before
    assert obama["anchor"] == {"type": "span", "start": "2009-01-01", "end": "2016-12-31"}
    assert obama["attributes"] == {"party": "D", "date_precision": "month"}
    politics = yaml.safe_load((ROOT / "atlas" / "politics.yaml").read_text())
    for name, band in politics["bands"].items():
        assert len(by_set[name]) == len(band["rows"])
        assert {s["source"]["url"] for s in by_set[name]} == {band["source"]}


def test_recessions_are_spans_read_from_v1s_recession_series(release):
    spans = [a["anchor"] for a in annotations(release, "recession")]
    assert {"type": "span", "start": "2008-01-01", "end": "2009-06-30"} in spans
    assert {"type": "span", "start": "2020-03-01", "end": "2020-04-30"} in spans
    months = sum(1 for v in V1["series"]["usrec"]["v"] if v == 1)
    covered = 0
    for span in spans:
        (y0, m0), (y1, m1) = (map(int, span[k].split("-")[:2]) for k in ("start", "end"))
        covered += (y1 - y0) * 12 + (m1 - m0) + 1
    assert covered == months


# --- runs ------------------------------------------------------------------------------------


def test_the_same_inputs_and_time_give_the_same_release(release, tmp_path):
    again = legacy_release(out=tmp_path / "again", now=NOW)
    assert again.name == release.name
    for path in sorted(p.relative_to(release) for p in release.rglob("*") if p.is_file()):
        same = hashlib.sha256((again / path).read_bytes()).digest() == hashlib.sha256((release / path).read_bytes()).digest()
        assert same, path  # compared by hash: a failure names the file and prints no bytes


def test_a_later_run_promotes_a_new_release_and_keeps_the_earlier_one(tmp_path):
    root = tmp_path / "local"
    first = legacy_release(out=root, now=NOW)
    second = legacy_release(out=root, now=datetime(2026, 11, 12, 9, 0, 0, tzinfo=UTC))
    assert first != second and first.is_dir() and second.is_dir()
    assert (root / "CURRENT").read_text().strip() == second.name


def test_the_command_line_writes_to_atlas_local(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_LOCAL", str(tmp_path / "local"))
    monkeypatch.setenv("ATLAS_PUBLIC", str(tmp_path / "public"))
    monkeypatch.setenv("ATLAS_STORE", str(tmp_path / "store"))
    assert cli.main(["legacy-release"]) == 0
    out = capsys.readouterr().out
    current = (tmp_path / "local" / "CURRENT").read_text().strip()
    assert current in out and "126 series" in out and "local profile" in out
