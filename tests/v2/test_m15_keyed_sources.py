"""M15's acceptance (PLAN): the suites pass with no keys present; each keyed source degrades to
"stale, last fetched …" when its key is missing; keys never appear in the repo, logs or fixtures.

The fixtures' values are invented (fixtures/capture/README.md). A decision in a register here
is test data and says nothing of what Alex has decided."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest

from atlas.capture.adapters import ADAPTERS, key_of
from atlas.capture.cli import main as capture_main
from atlas.capture.http import usable_key
from atlas.capture.replay import ReplayTransport, read_exchanges
from atlas.capture.run import endpoints_from_register, run_capture
from atlas.capture.store import read_fetch_log
from atlas.catalog import load_catalog
from atlas.publish.run import release
from atlas.release import validate_release
from atlas.rights import load_register
from atlas.vintage.cli import main as replay_main
from atlas.vintage.store import VintageStore

from .capture_helpers import LiveScripted, committed_with_file

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures" / "capture"
ROWS = ("bea", "eia")
KEYS = ("BEA_API_KEY", "EIA_API_KEY")
NOW = datetime(2026, 11, 12, 15, 0, 0, tzinfo=UTC)
LATER = datetime(2026, 11, 13, 15, 0, 0, tzinfo=UTC)
STORED = {
    "bea": ["gdp", "gdp_nominal", "gdp_qoq", "pce", "personal_income", "profits", "real_dpi", "saving", "trade_q"],
    "eia": ["brent", "elec_gen", "gas", "natgas", "wti"],
}
DERIVED = ["gdp_yoy"]
#: Invented keys of the two agencies' shapes, spelt out of plain words so that nothing here
#: looks like a secret to a scanner. They open nothing.
SEEDED = {"BEA_API_KEY": "INVENTED-0000-0000-0000-NOTAREALKEY0",
          "EIA_API_KEY": ("invented" * 5).title()}


class Agencies:
    """The fixtures served as if by the two agencies: a request is answered only when it
    carries the key its agency wants, and the BEA repeats that key in its answer."""

    kind, real = "live", False

    def __init__(self, start="2026-11-11T15:50:00"):
        self._recorded = ReplayTransport(FIXTURES)
        self._clock = datetime.fromisoformat(start).replace(tzinfo=UTC)
        self.sent: list[str] = []

    def now(self):
        return self._clock

    def send(self, request):
        from datetime import timedelta

        from atlas.capture.http import Request, Response

        self.sent.append(request.url)
        url, _, key = request.url.rpartition("&")
        bea = "apps.bea.gov" in url
        assert key == ("UserID=" + SEEDED["BEA_API_KEY"] if bea else "api_key=" + SEEDED["EIA_API_KEY"])
        recorded = self._recorded.send(Request(request.method, url))
        self._clock += timedelta(seconds=1)
        body = recorded.body.replace(b'"REDACTED"', b'"%s"' % SEEDED["BEA_API_KEY"].encode()) if bea else recorded.body
        return Response(200, recorded.headers, body, self._clock)


def everything_under(directory: Path) -> bytes:
    return b"".join(gzip.decompress(p.read_bytes()) if p.suffix == ".gz" else p.read_bytes()
                    for p in sorted(directory.rglob("*")) if p.is_file())


def signed(tmp_path: Path, rows=ROWS) -> Path:
    """The register with exactly ``rows`` signed, whatever Alex has signed in the committed file."""
    return committed_with_file(tmp_path, rows)


def no_spots(tmp: Path) -> Path:
    spot = tmp / "no-spots.json"
    spot.write_text(json.dumps({"format": 1, "about": "none", "spots": []}))
    return spot


@pytest.fixture(autouse=True)
def no_keys(monkeypatch):
    """Every test here runs as CI does: with neither key in the environment."""
    for name in KEYS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope="module")
def released(tmp_path_factory):
    """Capture the two agencies' fixtures by replay, record them, release: no key anywhere."""
    tmp = tmp_path_factory.mktemp("m15")
    register, store, root = signed(tmp), tmp / "store", tmp / "public"
    saved = {name: os.environ.pop(name, None) for name in KEYS}
    try:
        only = [argument for row in ROWS for argument in ("--only", row)]
        assert capture_main(["--store", str(store), "--register", str(register), "--replay", str(FIXTURES), *only]) == 0
        assert replay_main(["--store", str(store), "--register", str(register)]) == 0
        result = release(profile="public", root=root, store=store, register=register, now=NOW, spot=no_spots(tmp))
    finally:
        os.environ.update({name: value for name, value in saved.items() if value is not None})
    return result, root, store, register


def current(root: Path) -> Path:
    return root / "releases" / (root / "CURRENT").read_text().strip()


# --- the suites pass with no keys present --------------------------------------------------------


def test_every_series_the_two_adapters_read_passes_the_release_gate_with_no_key_present(released):
    result, root, _, _ = released
    assert result.exit_code == 0, result.lines
    manifest = json.loads((current(root) / "manifest.json").read_text())
    assert validate_release(current(root)) == []
    published = {entry["key"]: entry for entry in json.loads((current(root) / "catalog.json").read_text())["series"]}
    assert sorted(published) == sorted([*STORED["bea"], *STORED["eia"], *DERIVED])
    assert manifest["withheld"] == [] and manifest["checks"]["passed"] is True
    assert {check["outcome"] for check in manifest["checks"]["report"]} == {"pass"}
    assert {(source["producer"], source["outcome"]) for source in manifest["sources"]} == {
        ("U.S. Bureau of Economic Analysis", "ok"), ("U.S. Energy Information Administration", "ok")}
    catalog = load_catalog()
    for adapter, keys in STORED.items():
        for key in keys:
            assert published[key]["source"]["channel"] == {
                "via": "direct", "adapter": adapter, "endpoint": catalog[key]["source"]["channel"]["endpoint"]}, key
            assert published[key]["rights"]["status"] == "public_domain", key


def test_values_reach_the_release_as_the_agencies_printed_them(released):
    _, root, _, _ = released

    def series(key, kind="series"):
        return {o["period"]: o for o in json.loads((current(root) / kind / f"{key}.json").read_text())["observations"]}

    # The BEA: thousands commas are taken out and nothing else; profits end a quarter early.
    table = json.loads((FIXTURES / "bea/bea-nipa-t10106/part-1.json").read_text())["BEAAPI"]["Results"]["Data"]
    last = [row for row in table if row["SeriesCode"] == "A191RX" and row["LineNumber"] == "1"][-1]
    assert "," in last["DataValue"] and last["TimePeriod"] == "2026Q3"
    assert series("gdp")["2026-Q3"]["value"] == float(last["DataValue"].replace(",", ""))
    assert list(series("profits"))[-1] == "2026-Q2" and list(series("saving"))[-1] == "2026-09"
    assert series("trade_q")["2026-Q2"]["value"] < 0
    # The EIA: a week listed with no number, and a price printed without its zero.
    gas = series("gas")
    assert gas["2025-W05"] == {**gas["2025-W05"], "value": None, "status": "missing"}
    assert gas["2025-W07"]["value"] == 0.995
    assert list(series("elec_gen"))[-1] == "2026-08" and next(iter(series("wti"))) == "2019-07"
    # A change over four quarters, computed by the engine from the stored Series.
    assert "2019-Q1" in series("gdp_yoy", "derived")


def test_under_a_register_with_no_signed_row_nothing_of_theirs_is_captured_recorded_or_released(
        tmp_path, capsys, released):
    _, _, store, _ = released
    unsigned = signed(tmp_path, rows=())
    only = [argument for row in ROWS for argument in ("--only", row)]
    assert capture_main(["--store", str(tmp_path / "store"), "--register", str(unsigned),
                         "--replay", str(FIXTURES), *only]) == 1
    assert not (tmp_path / "store").exists()
    assert replay_main(["--store", str(tmp_path / "vintages"), "--register", str(unsigned),
                        "--captures", str(store)]) == 1
    out = capsys.readouterr().out
    for key in ("gdp", "saving", "wti", "elec_gen"):
        assert f"REFUSED {key}:" in out
    result = release(profile="public", root=tmp_path / "public", store=store, register=unsigned, now=NOW)
    assert result.exit_code == 1 and not (tmp_path / "public" / "CURRENT").exists()


def test_a_second_answer_that_differs_only_in_when_it_was_produced_is_a_confirmation_not_a_revision(tmp_path):
    """The BEA stamps every answer with the time it was made, so no two are the same bytes."""
    later = tmp_path / "later"
    for record in read_exchanges(FIXTURES / "bea" / "bea-nipa-t10106"):
        (later / "bea" / "bea-nipa-t10106").mkdir(parents=True)
        body = (record["directory"] / "part-1.json").read_bytes()
        changed = body.replace(b"2026-11-11T15:50:00.000", b"2026-11-12T15:50:00.000")
        assert changed != body
        (later / "bea/bea-nipa-t10106/part-1.json").write_bytes(changed)
        exchange = json.loads((record["directory"] / "exchange.json").read_text())
        text = json.dumps(exchange).replace("2026-11-11T", "2026-11-12T")
        exchange = json.loads(text)
        exchange["exchanges"][0]["sha256"] = hashlib.sha256(changed).hexdigest()
        (later / "bea/bea-nipa-t10106/exchange.json").write_text(json.dumps(exchange))
    register, store = signed(tmp_path), tmp_path / "store"
    for source in (FIXTURES, later):
        assert capture_main(["--store", str(store), "--register", str(register), "--replay", str(source),
                             "--only", "bea-nipa-t10106"]) == 0
    assert len({line["parts"][0]["sha256"] for line in read_fetch_log(store)}) == 2
    assert replay_main(["--store", str(store), "--register", str(register)]) == 0
    assert [c["change"] for c in VintageStore(store).captures("gdp")] == ["first", "none"]


# --- a keyed source degrades to "stale, last fetched …" when its key is missing -------------------


def keyed_endpoints():
    return [e for e in endpoints_from_register(load_register()) if key_of(e) is not None]


def test_the_two_agencies_endpoints_are_the_ones_that_want_a_key_and_each_names_its_own():
    assert {e.source: key_of(e) for e in keyed_endpoints()} == {
        "bea": ("UserID", "BEA_API_KEY"), "eia": ("api_key", "EIA_API_KEY")}
    assert len(keyed_endpoints()) == 10
    assert not hasattr(ADAPTERS["bls"], "key")


def test_a_live_run_without_the_keys_asks_neither_agency_and_calls_each_endpoint_stale(tmp_path):
    table = json.loads(signed(tmp_path).read_text())
    nothing = LiveScripted({})
    result = run_capture(tmp_path / "store", table, nothing, only=ROWS, sleep=lambda s: None, keys={})
    assert nothing.sent == [] and result.exit_code == 1
    assert set(result.outcomes.values()) == {"no_key"} and len(result.outcomes) == 10
    assert "STALE bea-nipa-t10106: stale, never fetched (BEA_API_KEY is not set; nothing was asked)" in result.lines
    assert "STALE eia-natgas-spot: stale, never fetched (EIA_API_KEY is not set; nothing was asked)" in result.lines


def test_with_one_key_missing_the_other_agency_is_still_fetched(tmp_path):
    table = json.loads(signed(tmp_path).read_text())
    live = Agencies()
    result = run_capture(tmp_path / "store", table, live, only=ROWS, sleep=lambda s: None,
                         keys={"EIA_API_KEY": SEEDED["EIA_API_KEY"]})
    assert {k: v for k, v in result.outcomes.items() if k.startswith("eia")} == dict.fromkeys(
        ["eia-petroleum-spot", "eia-natgas-spot", "eia-gasoline-retail", "eia-generation-us"], "captured")
    assert {v for k, v in result.outcomes.items() if k.startswith("bea")} == {"no_key"}
    assert len(live.sent) == 4 and all("apps.bea.gov" not in url for url in live.sent)
    assert SEEDED["EIA_API_KEY"].encode() not in everything_under(tmp_path / "store")


def test_a_run_with_both_keys_keeps_every_answer_and_neither_key(tmp_path):
    table = json.loads(signed(tmp_path).read_text())
    result = run_capture(tmp_path / "store", table, Agencies(), only=ROWS, sleep=lambda s: None, keys=dict(SEEDED))
    assert result.exit_code == 0, result.lines
    kept = everything_under(tmp_path / "store")
    for value in SEEDED.values():
        assert value.encode() not in kept and value not in "\n".join(result.lines)
    lines = read_fetch_log(tmp_path / "store")
    # The BEA repeated the key in each of its six answers; what is kept is the committed fixture.
    assert [line["parts"][0].get("key_removed") for line in lines if line["source"] == "bea"] == [1] * 6
    for line in lines:
        fixture = FIXTURES / line["source"] / line["endpoint"] / "part-1.json"
        assert gzip.decompress((tmp_path / "store" / line["parts"][0]["blob"]).read_bytes()) == fixture.read_bytes()
        assert not re.search(r"(?i)userid=|api_key=", line["parts"][0]["request"]["url"])


def test_a_release_after_a_run_without_a_key_calls_the_source_stale_and_says_when_it_was_last_fetched(tmp_path):
    register = signed(tmp_path)
    table, store = json.loads(register.read_text()), tmp_path / "store"
    assert run_capture(store, table, Agencies(), only=ROWS, sleep=lambda s: None, keys=dict(SEEDED)).exit_code == 0
    assert replay_main(["--store", str(store), "--register", str(register)]) == 0
    # The next day the BEA's key is gone. The EIA is fetched; the BEA is not asked.
    second = run_capture(store, table, Agencies("2026-11-12T15:50:00"), only=ROWS, sleep=lambda s: None,
                         keys={"EIA_API_KEY": SEEDED["EIA_API_KEY"]})
    assert second.exit_code == 1
    assert replay_main(["--store", str(store), "--register", str(register)]) == 0
    out = release(profile="public", root=tmp_path / "public", store=store, register=register, now=LATER,
                  spot=no_spots(tmp_path))
    assert out.exit_code == 0, out.lines
    manifest = json.loads((current(tmp_path / "public") / "manifest.json").read_text())
    sources = {source["producer"]: source for source in manifest["sources"]}
    bea = sources["U.S. Bureau of Economic Analysis"]
    assert bea["outcome"] == "stale" and bea["fetched"].startswith("2026-11-11T15:50:")
    assert ("bea-nipa-t10106: stale, last fetched 2026-11-11T15:50:03Z (not asked on 2026-11-12T15:50:00Z: "
            "BEA_API_KEY is not set)") in bea["detail"]
    assert sources["U.S. Energy Information Administration"]["outcome"] == "ok"
    # The Series themselves are the last good ones, whole.
    assert validate_release(current(tmp_path / "public")) == []
    assert (current(tmp_path / "public") / "series" / "gdp.json").exists()
    # A Release that reuses this one's data does not read the store, and still says so.
    again = release(profile="public", root=tmp_path / "public", store=store, register=register,
                    now=datetime(2026, 11, 13, 16, 0, 0, tzinfo=UTC), spot=no_spots(tmp_path), reuse_data=True)
    assert again.exit_code == 0, again.lines
    reused = json.loads((current(tmp_path / "public") / "manifest.json").read_text())
    [bea] = [s for s in reused["sources"] if s["producer"] == "U.S. Bureau of Economic Analysis"]
    assert bea["outcome"] == "stale" and "BEA_API_KEY is not set" in bea["detail"]


# --- keys never appear in the repo, logs or fixtures ----------------------------------------------

KEY_IN_A_URL = re.compile(r"(?i)\b(userid|api_key)=(?!REDACTED\b)[A-Za-z0-9-]{8,}")


def tracked() -> list[Path]:
    names = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [ROOT / name for name in names.decode().split("\0") if name]


def test_no_fixture_holds_a_key_or_a_request_that_carried_one():
    records = read_exchanges(FIXTURES)
    assert {record["source"] for record in records} >= set(ROWS)
    for record in records:
        for exchange in record["exchanges"]:
            url = exchange["request"]["url"]
            assert not re.search(r"(?i)[?&](userid|api_key)=", url), url
            body = (record["directory"] / exchange["body_file"]).read_bytes()
            assert not KEY_IN_A_URL.search(body.decode("utf-8", "replace")), record["endpoint"]
    for path in sorted((FIXTURES / "bea").rglob("part-1.json")):
        echoed = {p["ParameterName"]: p["ParameterValue"]
                  for p in json.loads(path.read_text())["BEAAPI"]["Request"]["RequestParam"]}
        assert echoed["USERID"] == "REDACTED", path


def test_no_tracked_file_holds_a_key_in_a_url():
    found = []
    for path in tracked():
        if path.suffix in (".png", ".jpg", ".ico", ".woff2", ".gz", ".parquet", ".lock") or not path.is_file():
            continue
        if KEY_IN_A_URL.search(path.read_text(encoding="utf-8", errors="replace")):
            found.append(str(path.relative_to(ROOT)))
    assert found == []


def test_the_keys_on_this_machine_are_in_no_tracked_file(no_keys, request):
    """Where the real keys are at hand (Alex's machine; never CI), look for them in every
    tracked file. Only file names are reported: a failure must not print what it found."""
    keys_file = Path.home() / ".config" / "macro-atlas" / "keys.env"
    if not keys_file.exists():
        pytest.skip("no keys on this machine")
    values = [line.split("=", 1)[1].strip().strip("'\"").encode() for line in keys_file.read_text().splitlines()
              if "=" in line and not line.lstrip().startswith("#")]
    values = [value for value in values if usable_key(value.decode("ascii", "replace"))]
    assert values, "the keys file holds no key of the expected shape"
    holding = [str(path.relative_to(ROOT)) for path in tracked()
               if path.is_file() and any(value in path.read_bytes() for value in values)]
    assert holding == []


def test_the_capture_command_never_prints_a_key_it_was_given(tmp_path, monkeypatch, capsys):
    for name, value in SEEDED.items():
        monkeypatch.setenv(name, value)
    register = signed(tmp_path)
    only = [argument for row in ROWS for argument in ("--only", row)]
    assert capture_main(["--register", str(register), "--dry-run", *only]) == 0
    # A replay with keys lying about: none is used, and the fixtures are kept byte for byte.
    assert capture_main(["--store", str(tmp_path / "store"), "--register", str(register),
                         "--replay", str(FIXTURES), *only]) == 0
    assert capture_main(["--store", str(tmp_path / "store"), "--register", str(register), "--status", *only]) == 0
    out = capsys.readouterr()
    kept = everything_under(tmp_path / "store")
    for value in SEEDED.values():
        assert value not in out.out and value not in out.err and value.encode() not in kept
    assert "needs BEA_API_KEY, which is set" in out.out
