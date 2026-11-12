"""M16's acceptance on the committed fixtures (PLAN): the Census Series go from recorded bytes
through capture, replay and the release writer; a hand-entered Series goes the same way; and
"the public release holds only allowlisted series", whatever rows are signed.

The fixtures' values are invented (fixtures/capture/README.md, fixtures/manual/README.md). A
decision in a register here is test data and says nothing of what Alex has decided."""
from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from atlas.capture.cli import main as capture_main
from atlas.capture.http import LiveTransport
from atlas.capture.run import endpoints_from_register, run_capture
from atlas.catalog import load_catalog
from atlas.catalog.load import leaves
from atlas.catalog.v1coverage import CLASSES, account
from atlas.publish.run import release
from atlas.release import validate_release
from atlas.rights import RightsGate, load_register
from atlas.vintage.cli import main as replay_main
from atlas.vintage.store import VintageStore

from .capture_helpers import ALLOW
from .catalog_helpers import stored, write
from .release_helpers import all_bytes

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures" / "capture"
MANUAL = ROOT / "fixtures" / "manual"
NOW = datetime(2026, 11, 12, 15, 0, 0, tzinfo=UTC)
CENSUS = {"census_eits": ["houst", "retail", "trade"],
          "census_c30": ["construction_private", "construction_public", "construction_total"]}
#: Every row of the register that lists something to capture.
ROWS = sorted({e.source for e in endpoints_from_register(load_register())})


def signed(tmp_path: Path, rows) -> Path:
    table = load_register()
    for row in table["rows"]:
        if row["id"] in rows:
            row["decision"] = dict(ALLOW)
    path = tmp_path / f"register-{'-'.join(rows) or 'none'}.json"
    path.write_text(json.dumps(table))
    return path


def no_spots(tmp: Path) -> Path:
    spot = tmp / "no-spots.json"
    spot.write_text(json.dumps({"format": 1, "about": "none", "spots": []}))
    return spot


def current(root: Path) -> Path:
    return root / "releases" / (root / "CURRENT").read_text().strip()


def published(root: Path) -> dict[str, dict]:
    return {entry["key"]: entry for entry in json.loads((current(root) / "catalog.json").read_text())["series"]}


def shown(root: Path) -> set[str]:
    """The Series a Release holds values for. A withheld Series is in its catalog by name only."""
    return {path.stem for name in ("series", "derived") for path in (current(root) / name).glob("*.json")}


def observations(root: Path, key: str) -> dict[str, dict]:
    return {o["period"]: o for o in json.loads((current(root) / "series" / f"{key}.json").read_text())["observations"]}


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    """Every fixture captured and recorded, under a register in which every capturing row is
    signed. The releases below are made from this one store under other registers."""
    tmp = tmp_path_factory.mktemp("m16")
    register, store = signed(tmp, ROWS), tmp / "store"
    assert capture_main(["--store", str(store), "--register", str(register), "--replay", str(FIXTURES)]) == 0
    assert replay_main(["--store", str(store), "--register", str(register)]) == 0
    return store


@pytest.fixture(scope="module")
def census(tmp_path_factory, store):
    tmp = tmp_path_factory.mktemp("m16-census")
    result = release(profile="public", root=tmp / "public", store=store, register=signed(tmp, ["census"]),
                     now=NOW, spot=no_spots(tmp))
    return result, tmp / "public"


# --- the Census Series -------------------------------------------------------------------------


def test_the_census_series_pass_the_release_gate_once_their_row_is_signed(census):
    result, root = census
    assert result.exit_code == 0, result.lines
    assert validate_release(current(root)) == []
    manifest = json.loads((current(root) / "manifest.json").read_text())
    assert shown(root) == {*CENSUS["census_eits"], *CENSUS["census_c30"]}
    assert shown(root) == set(published(root)) - {w["key"] for w in manifest["withheld"]}
    assert manifest["checks"]["passed"] is True
    assert {check["outcome"] for check in manifest["checks"]["report"]} == {"pass"}
    catalog = load_catalog()
    for adapter, keys in CENSUS.items():
        for key in keys:
            entry = published(root)[key]
            assert entry["source"]["channel"] == {
                "via": "direct", "adapter": adapter, "endpoint": catalog[key]["source"]["channel"]["endpoint"]}, key
            assert entry["source"]["origin"]["producer"] == "U.S. Census Bureau"
            assert entry["rights"]["status"] == "public_domain", key


def test_census_values_reach_the_release_as_the_files_printed_them(census):
    _, root = census
    # The flat files: the fixture's September 2026 is the last month with a figure, and the
    # balance begins a year after its file does.
    assert next(iter(observations(root, "retail"))) == "2012-01" and list(observations(root, "retail"))[-1] == "2026-09"
    assert next(iter(observations(root, "trade"))) == "2013-01"
    assert observations(root, "trade")["2013-01"]["value"] == -9000
    assert observations(root, "houst")["2012-02"]["value"] == 1500  # 1499.6, printed with no decimals
    # The workbook: the Bureau's marks on its newest three months.
    total = observations(root, "construction_total")
    assert [(period, total[period]["status"]) for period in list(total)[-4:]] == [
        ("2026-06", "final"), ("2026-07", "revised"), ("2026-08", "revised"), ("2026-09", "preliminary")]
    assert total["2012-01"]["value"] == 460000


# --- only allowlisted Series -------------------------------------------------------------------


def allowlist(register: Path) -> set[str]:
    """Worked out apart from the release writer: the Series of the pipeline whose every stored
    Series underneath rests on a row that register allows to be displayed on production."""
    table = json.loads(register.read_text())
    gate, catalog = RightsGate(table), load_catalog()
    allowed = set()
    for key, entry in catalog.items():
        below = [catalog[name] for name in leaves(key, catalog)]
        if entry["status"] == "draft" or not below or any(
                one["status"] == "draft" or not (one["source"]["channel"] or {}).get("endpoint") for one in below):
            continue
        lineage = [{"origin": one["source"]["origin"]["producer"], "dataset": one["source"]["origin"]["dataset"],
                    "channel": one["source"]["channel"]["via"], "representation": "native", "permission": "display"}
                   for one in below]
        if gate.permits(lineage, "production").allowed:
            allowed.add(key)
    return allowed


@pytest.mark.parametrize("rows", [["census"], ["bls", "census"], ["fed-board"], ["bea", "eia", "imf"], ROWS],
                         ids=lambda rows: "+".join(rows) if len(rows) < 6 else "every-row")
def test_a_public_release_holds_exactly_the_allowlisted_series(rows, store, tmp_path):
    register = signed(tmp_path, rows)
    result = release(profile="public", root=tmp_path / "public", store=store, register=register, now=NOW,
                     spot=no_spots(tmp_path))
    assert result.exit_code == 0, result.lines
    root = tmp_path / "public"
    manifest = json.loads((current(root) / "manifest.json").read_text())
    expected = allowlist(register)
    assert expected and shown(root) == expected
    assert not {path.stem for path in (current(root) / "vintages").glob("*.json")} - expected
    # Everything else of the pipeline is withheld by name, with the row that stands in its way.
    pipeline = {key for key, entry in load_catalog().items() if entry["status"] != "draft"
                and ("recipe" in entry or (entry["source"]["channel"] or {}).get("endpoint"))}
    withheld = {w["key"]: w["reason"] for w in manifest["withheld"]}
    assert set(withheld) == pipeline - expected and set(published(root)) == pipeline
    assert all("is not signed" in reason or "withheld" in reason for reason in withheld.values()), withheld
    # Nothing v1 showed that the coverage report calls withheld is in a public Release.
    account_ = account(load_catalog(), load_register())
    assert not {key for key, row in account_.items() if row.klass == CLASSES[2]} & set(published(root))
    assert not set(load_catalog()) - pipeline & set(published(root))  # a draft is not even named
    # And nothing in the root says it came through an intermediary or in v1's representation.
    everything = all_bytes(root)
    for word in (b'"fred"', b'"yahoo"', b"legacy_monthly_rounded", b"FRED ", b"Yahoo "):
        assert word not in everything, word


def test_under_the_committed_register_a_public_release_holds_nothing(store, tmp_path):
    assert allowlist(ROOT / "schema" / "rights-register.json") == set()
    result = release(profile="public", root=tmp_path / "public", store=store, now=NOW, spot=no_spots(tmp_path))
    assert result.exit_code == 1
    assert not (tmp_path / "public" / "CURRENT").exists()


def test_v1s_own_values_are_never_what_a_public_release_holds(store, tmp_path):
    """v1's data/atlas.json is never a public source (PLAN M16; 6.1, point 4): a public release
    refuses to take v1's Series in, whatever is signed."""
    result = release(profile="public", root=tmp_path / "public", store=store, register=signed(tmp_path, ROWS),
                     now=NOW, legacy=True, spot=no_spots(tmp_path))
    assert result.exit_code == 1 and not (tmp_path / "public" / "CURRENT").exists()
    assert any("legacy" in line for line in result.lines)


# --- a hand-entered Series, the whole way ------------------------------------------------------

OFFICE, DATASET = "An Invented Election Office", "Official results, invented"


class Entered(LiveTransport):
    """The live transport reading an invented repository, with a clock a test sets."""

    def __init__(self, root: Path, at: datetime):
        super().__init__(root=root)
        self.at = at

    def now(self) -> datetime:
        return self.at


def hand_entered(tmp_path: Path, *, sign=True) -> tuple[dict, Path, Path]:
    """A register with a row for the invented office and its file, a repository holding the
    file, and a Catalog of the one Series bound to it."""
    table = load_register()
    table["rows"].append({
        "id": "office", "kind": "origin", "name": "An invented office", "origins": [OFFICE], "datasets": "*",
        "used_for": "test", "terms": [], "terms_note": "invented", "licence_class": "public_domain",
        "attribution": "Source: an invented office.", "open_questions": [],
        "proposal": {**{k: v for k, v in ALLOW.items() if isinstance(v, bool)}, "note": "an invented row for a test"},
        "decision": dict(ALLOW) if sign else None,
        "capture": [{"id": "office-margins", "adapter": "manual", "channel": "hand_entered", "datasets": [DATASET],
                     "params": {"file": "catalog/manual/invented-margins.json", "frequency": "irregular",
                                "series": ["margin"], "units": {"margin": "percentage points"}}}]})
    repo = tmp_path / "repo"
    shutil.copytree(MANUAL / "catalog", repo / "catalog")
    source = {"origin": {"producer": OFFICE, "dataset": DATASET, "origin_id": "margin", "url": None},
              "channel": {"via": "hand_entered", "adapter": "manual", "endpoint": "office-margins"}}
    catalog = write(tmp_path / "series", stored("fx_margin", name="An invented margin", status="active", unit="percentage points", unit_kind="percentage_points", measure_kind="rate", agg="none", freq="irregular", continuity="held", seasonal_adjustment="not_applicable", refresh="irregular", source=source))
    return table, repo, catalog


def test_a_hand_entered_value_is_captured_recorded_and_released_and_a_correction_is_a_revision(tmp_path):
    table, repo, catalog = hand_entered(tmp_path)
    register = tmp_path / "register.json"
    register.write_text(json.dumps(table))
    store, root = tmp_path / "store", tmp_path / "public"
    first = NOW - timedelta(days=2)
    assert run_capture(store, table, Entered(repo, first), only=["office"], sleep=lambda s: None).exit_code == 0
    assert replay_main(["--store", str(store), "--register", str(register), "--series", str(catalog)]) == 0
    result = release(profile="public", root=root, store=store, register=register, series=catalog,
                     now=NOW - timedelta(days=1), spot=no_spots(tmp_path))
    assert result.exit_code == 0, result.lines
    entry = published(root)["fx_margin"]
    assert entry["source"]["channel"] == {"via": "hand_entered", "adapter": "manual", "endpoint": "office-margins"}
    assert entry["source"]["origin"]["producer"] == OFFICE
    assert {period: o["value"] for period, o in observations(root, "fx_margin").items()} == {
        "2020-11-03": 4.0, "2024-11-05": -1.5}

    # Someone corrects an entry in the file. The next capture keeps the file as it now is, and
    # the vintage store holds both: what was entered, when, and what replaced it.
    path = repo / "catalog" / "manual" / "invented-margins.json"
    document = json.loads(path.read_text())
    document["series"]["margin"]["entries"][0].update(
        value="6.00", working={"formula": "two_party_margin", "democratic": "5300", "republican": "4700"})
    path.write_text(json.dumps(document, indent=2))
    assert run_capture(store, table, Entered(repo, NOW), only=["office"], sleep=lambda s: None).exit_code == 0
    assert replay_main(["--store", str(store), "--register", str(register), "--series", str(catalog)]) == 0
    versions = [(row["value"], row["recorded_from"], row["recorded_to"])
                for row in VintageStore(store).rows("fx_margin") if row["period"] == "2020-11-03"]
    assert versions == [("4.00", "2026-11-10T15:00:00Z", "2026-11-12T15:00:00Z"), ("6.00", "2026-11-12T15:00:00Z", None)]


def test_an_unsigned_row_keeps_a_hand_entered_file_out_of_the_store(tmp_path):
    table, repo, _ = hand_entered(tmp_path, sign=False)
    result = run_capture(tmp_path / "store", table, Entered(repo, NOW), only=["office"], sleep=lambda s: None)
    assert result.exit_code == 1 and not (tmp_path / "store").exists()
    assert "is not signed" in result.lines[0]
