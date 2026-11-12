"""`atlas capture` and the committed capture fixtures (PLAN M7 acceptance; ADR 0021).

What a signature does, and what its absence does, is tested on a copy of the register written
into a temporary directory, in which exactly the rows a test names are signed and every other
row is not (capture_helpers.committed_with). That copy is test data and says nothing about what
Alex has decided. What the committed register itself does is one test, which reads its
expectation from the rows Alex has signed in the file, so his next signature changes no test.

No test here reaches the network: every run is a dry run, a replay of recorded exchanges, or is
refused before a transport exists (tests/v2/conftest.py also refuses any connection that is
not to this machine)."""
import filecmp
import gzip
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

from atlas.capture.adapters import ADAPTERS
from atlas.capture.cli import main
from atlas.capture.replay import (
    ExportRefused,
    ReplayTransport,
    export_exchanges,
    load_capture,
    read_exchanges,
    reexamine,
    write_exchange,
)
from atlas.capture.run import endpoints_from_register, refusals, run_capture
from atlas.capture.store import read_fetch_log, read_runs
from atlas.cli import main as atlas_main
from atlas.rights import RightsGate, load_register

from .capture_helpers import committed_with, committed_with_file, signed_in_committed

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures" / "capture"
FIRST_THREE = {"bls": "bls-headline", "treasury-fiscal-data": "treasury-debt-to-penny",
               "fed-board": "fed-h15-treasury-yields"}
#: Every endpoint the register lists, by its row, since M13.
ENDPOINTS = {
    "bls": ["bls-headline", "bls-coverage"],
    "treasury-fiscal-data": ["treasury-debt-to-penny", "treasury-mts-summary"],
    "fed-board": ["fed-h15-treasury-yields", "fed-h15-monthly", "fed-h10-daily-rates",
                  "fed-h10-daily-indexes", "fed-h41-table5", "fed-z1-households", "fed-g17-major",
                  "fed-g19-credit", "fed-h6-monthly", "fed-chgdel-delinquency"],
    "imf": ["imf-cpi-g20", "imf-er-g20"],  # M14
    # M15: the two sources that want a key. A replay of their fixtures asks for none.
    "bea": ["bea-nipa-t10101", "bea-nipa-t10105", "bea-nipa-t10106", "bea-nipa-t11200", "bea-nipa-t20600",
            "bea-ita-balance"],
    "eia": ["eia-petroleum-spot", "eia-natgas-spot", "eia-gasoline-retail", "eia-generation-us"],
    # M16: three flat files of the Census Bureau's Economic Indicators and its construction workbook.
    "census": ["census-marts", "census-resconst", "census-ftd", "census-c30-total"],
}
ALL = {(source, endpoint) for source, listed in ENDPOINTS.items() for endpoint in listed}


def signed_register(tmp_path, rows=tuple(ENDPOINTS), **grants) -> Path:
    """The register with exactly ``rows`` signed, by default every row that lists an endpoint."""
    return committed_with_file(tmp_path, rows, **grants)


def unsigned_register(tmp_path) -> Path:
    """The register with no row signed, as it was before Alex signed any."""
    return committed_with_file(tmp_path, (), name="unsigned.json")


def test_against_captured_fixtures_capture_writes_a_blob_and_a_fetch_log_line(tmp_path, capsys):
    store = tmp_path / "store"
    status = main(["--store", str(store), "--register", str(signed_register(tmp_path)),
                   "--replay", str(FIXTURES)])
    out = capsys.readouterr().out

    assert status == 0, out
    lines = {line["endpoint"]: line for line in read_fetch_log(store)}
    assert set(lines) == {endpoint for _, endpoint in ALL}
    for source, endpoint in sorted(ALL):
        line = lines[endpoint]
        assert line["outcome"] == "captured" and line["transport"] == "replay"
        assert line["source"] == source
        recorded = FIXTURES / source / endpoint
        for number, part in enumerate(line["parts"], start=1):
            [body] = [p for p in recorded.iterdir() if p.name.startswith(f"part-{number}.")]
            assert gzip.decompress((store / part["blob"]).read_bytes()) == body.read_bytes()
            assert part["received_at"].startswith("2026-11-11T15:50:")  # the recording's time
        assert len(line["parts"]) == len([p for p in recorded.iterdir() if p.name.startswith("part-")])
        assert f"CAPTURED {endpoint}" in out
    assert line["register"]["sha256"] is not None
    assert read_runs(store)[-1]["exit_code"] == 0


def test_a_register_with_no_signed_row_clears_nothing_so_capture_refuses_and_fetches_nothing(tmp_path, capsys):
    store = tmp_path / "store"
    status = main(["--store", str(store), "--register", str(unsigned_register(tmp_path)),
                   "--replay", str(FIXTURES)])
    out = capsys.readouterr().out
    assert status == 1
    assert not store.exists()
    for source, endpoint in sorted(ALL):
        assert f"REFUSED {endpoint} (row {source}" in out
    assert "is not signed" in out


def test_the_committed_register_clears_exactly_the_rows_alex_has_signed(tmp_path, capsys):
    """The one test here of the committed register. It is a dry run: nothing is fetched."""
    table, signed = load_register(), signed_in_committed()
    gate = RightsGate(table)
    endpoints = endpoints_from_register(table)
    storable = {e.id for e in endpoints if all(
        gate.may_store(e.origin, dataset, e.channel).allowed for dataset in e.datasets)}
    # Only a signed row clears anything. (A signed row that refuses storage clears nothing.)
    assert {e.source for e in endpoints if e.id in storable} <= signed

    status = main(["--store", str(tmp_path / "s"), "--dry-run"])
    lines = capsys.readouterr().out.splitlines()
    assert not (tmp_path / "s").exists()
    for e in endpoints:
        [line] = [line for line in lines if f"{e.id} (row {e.source}," in line]
        assert line.startswith("REFUSED ") is (e.id not in storable), line
        assert ("cleared for storage" in line) is (e.id in storable), line
        assert ("is not signed" in line) is (e.source not in signed), line
    refused = len(endpoints) - len(storable)
    assert status == (1 if refused else 0)
    # One row left unsigned, and a run of everything fetches nothing at all.
    assert (f"{refused} of {len(endpoints)} endpoints are not cleared. A run would fetch nothing."
            in lines) is bool(refused)


def test_the_endpoint_list_is_the_registers_and_covers_the_first_three_sources():
    endpoints = endpoints_from_register(load_register())
    assert {(e.source, e.id) for e in endpoints} == ALL
    assert [e.id for e in endpoints if e.source == "fed-board"] == ENDPOINTS["fed-board"]
    assert {e.origin for e in endpoints} == {
        "U.S. Bureau of Labor Statistics",
        "U.S. Department of the Treasury, Bureau of the Fiscal Service",
        "Board of Governors of the Federal Reserve System", "International Monetary Fund",
        "U.S. Bureau of Economic Analysis", "U.S. Energy Information Administration",
        "U.S. Census Bureau"}
    assert all(e.channel == "direct" for e in endpoints)


def test_one_signed_row_is_not_enough_while_another_selected_row_is_unsigned(tmp_path, capsys):
    register = signed_register(tmp_path, rows=("bls",))
    assert main(["--store", str(tmp_path / "s"), "--register", str(register), "--replay", str(FIXTURES)]) == 1
    assert not (tmp_path / "s").exists()
    assert main(["--store", str(tmp_path / "s"), "--register", str(register), "--replay", str(FIXTURES),
                 "--only", "bls"]) == 0
    assert [line["endpoint"] for line in read_fetch_log(tmp_path / "s")] == ENDPOINTS["bls"]


def test_dry_run_lists_every_endpoint_and_the_gates_answer_and_fetches_nothing(tmp_path, capsys):
    status = main(["--store", str(tmp_path / "s"), "--register", str(unsigned_register(tmp_path)), "--dry-run"])
    out = capsys.readouterr().out
    assert status == 1 and not (tmp_path / "s").exists()
    assert "bls-headline" in out and "treasury-debt-to-penny" in out and "fed-h15-treasury-yields" in out
    assert out.count("REFUSED") == len(ALL)
    assert f"{len(ALL)} of {len(ALL)} endpoints are not cleared. A run would fetch nothing." in out

    # One row signed: its endpoints are cleared, and a run of everything would still fetch nothing.
    status = main(["--register", str(signed_register(tmp_path, rows=("bls",))), "--dry-run"])
    out = capsys.readouterr().out
    assert status == 1
    assert out.count("cleared for storage") == len(ENDPOINTS["bls"])
    assert out.count("REFUSED") == len(ALL) - len(ENDPOINTS["bls"])

    assert main(["--register", str(signed_register(tmp_path)), "--dry-run"]) == 0
    assert capsys.readouterr().out.count("cleared for storage") == len(ALL)


def test_status_reports_missed_days_from_a_store_without_fetching(tmp_path, capsys):
    store, register = tmp_path / "store", signed_register(tmp_path)
    main(["--store", str(store), "--register", str(register), "--replay", str(FIXTURES)])
    capsys.readouterr()
    status = main(["--store", str(store), "--register", str(register), "--status",
                   "--as-of", "2026-11-14T12:00:00Z"])
    out = capsys.readouterr().out
    assert status == 0
    assert "bls-headline: last complete capture 2026-11-11T15:50:03Z" in out  # its third request
    assert "MISSED bls-headline: 2026-11-12, 2026-11-13" in out
    assert len(read_runs(store)) == 2  # looking is not a run: one started line, one finished


def test_on_github_actions_a_missed_day_is_a_warning_and_a_failure_an_error(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    main(["--store", str(tmp_path / "s"), "--register", str(unsigned_register(tmp_path)), "--dry-run"])
    assert "::error::REFUSED bls-headline" in capsys.readouterr().out


def test_atlas_capture_is_the_same_command(tmp_path, capsys):
    assert atlas_main(["capture", "--store", str(tmp_path / "s"), "--register", str(unsigned_register(tmp_path)),
                       "--dry-run"]) == 1
    assert "REFUSED bls-headline" in capsys.readouterr().out


def test_the_capture_host_needs_nothing_but_the_standard_library_to_start(tmp_path):
    # `python -m atlas.capture` must not pull in v1's pipeline (pandas, yaml, jinja2) or the
    # release tooling (jsonschema): the capture host installs `requests` and nothing else.
    # It starts three ways here, none of which may open a connection (the child process is not
    # under conftest.py's guard, so it carries its own): a dry run under a register with no
    # signed row, a dry run under the committed register, whatever Alex has signed in it, and a
    # run that is refused because a row is unsigned.
    unsigned = unsigned_register(tmp_path)
    # What the committed register refuses, by the rule itself: a row unsigned, or signed without store.
    refused = refusals(load_register(), endpoints_from_register(load_register()))
    program = (
        "import socket, sys\n"
        "def no_network(*args, **kwargs):\n"
        "    raise AssertionError('the capture command opened a connection')\n"
        "socket.socket.connect = socket.socket.connect_ex = no_network\n"
        "socket.create_connection = socket.getaddrinfo = no_network\n"
        "class Block:\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        "        if name.split('.')[0] in {'pandas','yaml','jinja2','jsonschema','curl_cffi','numpy'}:\n"
        "            raise ImportError('blocked: ' + name)\n"
        "sys.meta_path.insert(0, Block())\n"
        "from atlas.capture.__main__ import main\n"
        f"store = {str(tmp_path / 's')!r}\n"
        f"status = main(['--store', store, '--register', {str(unsigned)!r}, '--dry-run'])\n"
        "print('COMMITTED')\n"
        "committed = main(['--store', store, '--dry-run'])\n"
        "print('RUN')\n"
        f"run = main(['--store', store, '--register', {str(unsigned)!r}])\n"
        "assert 'requests' not in sys.modules, 'a dry run or a refused run must not need the network library'\n"
        "print('STATUSES', status, committed, run)\n"
    )
    done = subprocess.run([sys.executable, "-c", program], cwd=ROOT, capture_output=True, text=True,
                          check=False)
    assert done.returncode == 0, done.stderr
    first, rest = done.stdout.split("COMMITTED\n")
    committed, run = rest.split("RUN\n")
    assert "REFUSED bls-headline" in first and "cleared for storage" not in first
    assert ("REFUSED" in committed) is bool(refused)
    assert "Nothing was fetched." in run
    assert f"STATUSES 1 {1 if refused else 0} 1" in run
    assert not (tmp_path / "s").exists()


# --- the committed fixtures ---------------------------------------------------------------

def test_a_fixture_exists_for_every_endpoint_the_register_lists():
    found = {(record["source"], record["endpoint"]) for record in read_exchanges(FIXTURES)}
    assert found == ALL
    assert set(FIRST_THREE.items()) <= found


def test_a_fixture_holds_real_agency_bytes_only_if_alex_has_cleared_them_for_redistribution():
    # The repository is public. Until a row is signed every fixture is invented and says so.
    gate = RightsGate(load_register())
    for record in read_exchanges(FIXTURES):
        provenance = record["provenance"]
        if provenance["synthetic"]:
            continue
        lineage = [{"origin": provenance["origin"], "dataset": dataset, "channel": "direct",
                    "representation": "native", "permission": "redistribute"}
                   for dataset in provenance["datasets"]]
        assert gate.permits(lineage, "production").allowed, record["endpoint"]


def test_the_committed_fixtures_are_what_their_script_writes(tmp_path):
    spec = importlib.util.spec_from_file_location("make_capture_fixtures", FIXTURES / "make_fixtures.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not all(record["provenance"]["synthetic"] for record in read_exchanges(FIXTURES)):
        pytest.skip("a real capture has replaced an invented fixture")
    module.build(tmp_path)
    for record in read_exchanges(FIXTURES):
        relative = record["directory"].relative_to(FIXTURES)
        _same, mismatch, errors = filecmp.cmpfiles(
            record["directory"], tmp_path / relative,
            [p.name for p in record["directory"].iterdir()], shallow=False)
        assert (mismatch, errors) == ([], []), relative


def test_a_replay_with_no_recorded_answer_fails_and_never_asks_the_network(tmp_path):
    table = json.loads(signed_register(tmp_path).read_text())
    table["rows"][0]["capture"][0]["params"]["series"] = ["LNS14000000"]  # not what was recorded
    result = run_capture(tmp_path / "s", table, ReplayTransport(FIXTURES), only=["bls"],
                         sleep=lambda seconds: None)
    assert result.exit_code == 1
    line, other = read_fetch_log(tmp_path / "s")
    assert line["endpoint"] == "bls-headline"
    assert line["outcome"] == "failed" and "no recorded exchange" in line["error"]
    assert other["outcome"] == "captured"  # the row's other endpoint is still what was recorded


def captured_store(tmp_path):
    store = tmp_path / "store"
    main(["--store", str(store), "--register", str(signed_register(tmp_path)), "--replay", str(FIXTURES)])
    return store


def test_a_capture_read_back_from_the_store_is_the_same_bytes_times_and_evidence(tmp_path, capsys):
    store = captured_store(tmp_path)
    line = next(line for line in read_fetch_log(store) if line["endpoint"] == "bls-headline")
    capture = load_capture(store, line)

    assert capture.retrieved_at.isoformat() == "2026-11-11T15:50:03+00:00"  # not the time of reading
    assert capture.bodies == [(FIXTURES / "bls" / "bls-headline" / f"part-{n}.json").read_bytes()
                              for n in (1, 2, 3)]
    assert reexamine(capture).as_dict() == line["evidence"]

    state = ADAPTERS["bls"].parse(capture)
    assert state.complete
    assert {name: len(rows) for name, rows in state.series.items()} == {
        "CUUR0000SA0": 358, "CUSR0000SA0": 358, "LNS14000000": 358, "CES0000000001": 358}
    october = next(o for o in state.series["CUUR0000SA0"] if o["period"] == "2025-10")
    assert october["value"] is None and october["status"] == "unavailable"
    assert state.series["CES0000000001"][-1]["status"] == "preliminary"


def test_a_blob_that_was_altered_is_not_read_back(tmp_path, capsys):
    store = captured_store(tmp_path)
    line = read_fetch_log(store)[0]
    (store / line["parts"][0]["blob"]).write_bytes(gzip.compress(b"tampered"))
    with pytest.raises(ValueError, match="does not hold the bytes its name promises"):
        load_capture(store, line)


def test_verify_checks_every_blob_the_fetch_log_names(tmp_path, capsys):
    store = captured_store(tmp_path)
    capsys.readouterr()
    assert main(["--store", str(store), "--verify"]) == 0
    assert "30 captures, 36 blobs, all present and unaltered" in capsys.readouterr().out

    lines = read_fetch_log(store)
    (store / lines[0]["parts"][0]["blob"]).unlink()
    (store / lines[1]["parts"][0]["blob"]).write_bytes(gzip.compress(b"tampered"))
    assert main(["--store", str(store), "--verify"]) == 1
    out = capsys.readouterr().out
    assert f"MISSING {lines[0]['parts'][0]['blob']}" in out
    assert f"ALTERED {lines[1]['parts'][0]['blob']}" in out


def test_exporting_a_store_gives_back_the_exchanges_it_was_replayed_from(tmp_path, capsys):
    store = captured_store(tmp_path)
    written = export_exchanges(store, tmp_path / "out", load_register(), note="round trip")
    assert written == sorted(endpoint for _, endpoint in ALL)
    for record in read_exchanges(tmp_path / "out"):
        assert record["provenance"]["synthetic"] is True  # it never came from the network
        original = FIXTURES / record["source"] / record["endpoint"]
        for exchange in record["exchanges"]:
            assert (record["directory"] / exchange["body_file"]).read_bytes() == \
                (original / exchange["body_file"]).read_bytes()
    assert ReplayTransport(tmp_path / "out").now() == ReplayTransport(FIXTURES).now()


def live_store(tmp_path):
    """A store whose lines say they came from the network (they did not: the bytes are the
    invented fixtures), to test what export does with real captures."""
    store = captured_store(tmp_path)
    for name in ("fetchlog.ndjson", "runs.ndjson"):
        text = (store / name).read_text().replace('"transport":"replay"', '"transport":"live"')
        text = text.replace('"real_bytes":false', '"real_bytes":true')
        (store / name).write_text(text)
    return store


def test_a_real_capture_is_not_exported_as_a_fixture_until_its_row_allows_redistribution(tmp_path, capsys):
    store = live_store(tmp_path)
    with pytest.raises(ExportRefused, match="is not signed"):
        export_exchanges(store, tmp_path / "out", committed_with(), note="x")
    assert not (tmp_path / "out").exists()

    stored_only = json.loads(signed_register(tmp_path, redistribute=False).read_text())
    with pytest.raises(ExportRefused, match="does not allow redistribute"):
        export_exchanges(store, tmp_path / "out", stored_only, note="x")

    cleared = json.loads(signed_register(tmp_path).read_text())
    export_exchanges(store, tmp_path / "out", cleared, note="x")
    assert all(record["provenance"]["synthetic"] is False for record in read_exchanges(tmp_path / "out"))


def real_exchanges(tmp_path) -> Path:
    """The invented fixtures again, but recorded as if they were real captures."""
    out = tmp_path / "real-exchanges"
    for record in read_exchanges(FIXTURES):
        parts = [{**exchange, "body": (record["directory"] / exchange["body_file"]).read_bytes()}
                 for exchange in record["exchanges"]]
        write_exchange(out, record["source"], record["endpoint"], parts,
                       recorded_at=ReplayTransport(FIXTURES).now(),
                       provenance={**record["provenance"], "synthetic": False})
    return out


def test_real_bytes_stay_real_through_a_replay_and_are_not_exported_without_permission(tmp_path, capsys):
    stored_only = signed_register(tmp_path, redistribute=False)
    store = tmp_path / "replayed"
    assert main(["--store", str(store), "--register", str(stored_only),
                 "--replay", str(real_exchanges(tmp_path))]) == 0
    assert all(line["real_bytes"] is True for line in read_fetch_log(store))

    with pytest.raises(ExportRefused, match="does not allow redistribute"):
        export_exchanges(store, tmp_path / "out", json.loads(stored_only.read_text()), note="x")
    with pytest.raises(ExportRefused, match="is not signed"):
        export_exchanges(store, tmp_path / "out", committed_with(), note="x")
    assert not (tmp_path / "out").exists()

    cleared = json.loads(signed_register(tmp_path).read_text())
    export_exchanges(store, tmp_path / "out", cleared, note="x")
    assert all(record["provenance"]["synthetic"] is False for record in read_exchanges(tmp_path / "out"))


def test_a_fetch_log_line_that_does_not_say_is_taken_to_be_real(tmp_path, capsys):
    store = captured_store(tmp_path)
    log = store / "fetchlog.ndjson"
    log.write_text(log.read_text().replace('"real_bytes":false,', ""))
    with pytest.raises(ExportRefused):
        export_exchanges(store, tmp_path / "out", committed_with(), note="x")


def test_export_fixtures_from_the_command_line_refuses_the_same_way(tmp_path, capsys):
    store = live_store(tmp_path)
    capsys.readouterr()
    assert main(["--store", str(store), "--register", str(unsigned_register(tmp_path)),
                 "--export-fixtures", str(tmp_path / "out")]) == 1
    assert "REFUSED" in capsys.readouterr().out and not (tmp_path / "out").exists()


def test_a_replay_does_not_write_into_a_store_of_real_captures(tmp_path, capsys):
    store = live_store(tmp_path)
    result = run_capture(store, json.loads(signed_register(tmp_path).read_text()),
                         ReplayTransport(FIXTURES), sleep=lambda seconds: None)
    assert result.exit_code == 1 and "holds a live run and this run is replay" in result.lines[0]
    assert len(read_runs(store)) == 2 and len(read_fetch_log(store)) == 30
