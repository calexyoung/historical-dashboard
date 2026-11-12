"""Hand-entered files (PLAN M16; ADR 0030): figures typed in from a published record, each with
its citation, read through the capture kit like any source. Every value, name and address here
is invented (fixtures/manual/README.md), and a decision in a register here is test data."""
import copy
import json
import os
from pathlib import Path

import pytest

from atlas import manual
from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint
from atlas.capture.http import READ_PATH, CaptureError, LiveTransport
from atlas.capture.replay import ExportRefused, ReplayTransport, export_exchanges
from atlas.capture.run import RegisterError, endpoints_from_register, run_capture
from atlas.capture.store import read_fetch_log

from .capture_helpers import Scripted, origin_row, register

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT / "fixtures" / "manual"  # laid out like a repository: catalog/manual/...
FILE = "catalog/manual/invented-margins.json"
ORIGIN, DATASET = "An Invented Election Office", "Official results, invented"
PARAMS = {"file": FILE, "frequency": "irregular", "series": ["margin"], "units": {"margin": "percentage points"}}
MANUAL = ADAPTERS["manual"]
CITED = ("An Invented Election Office, Official Results 2020 (invented), page 5, table A, the row \"Total\". "
         "https://elections.invalid/results-2020.pdf (read 2026-11-10)")


def committed() -> dict:
    return json.loads((REPO / FILE).read_text())


def endpoint(**params) -> Endpoint:
    return Endpoint("office-margins", "office", "manual", ORIGIN, (DATASET,), "hand_entered", {**PARAMS, **params})


def entry_row(signed=True, **grants) -> dict:
    row = origin_row("office", ORIGIN, [{"id": "office-margins", "adapter": "manual", "channel": "hand_entered",
                                         "datasets": [DATASET], "params": PARAMS}], signed=signed)
    if signed:
        row["decision"].update(grants)
    return row


def read(document, spec=None, start="2026-11-12T15:50:00"):
    body = document if isinstance(document, bytes) else json.dumps(document).encode()
    transport = Scripted({"repo:" + FILE: [(200, body, [["Content-Type", "application/json"]])]}, start=start)
    raw = capture(spec or endpoint(), Fetch(Session(transport, sleep=lambda s: None)))
    return raw, MANUAL.parse(raw)


def problems_of(document, spec=None, **more) -> str:
    raw, state = read(document, spec, **more)
    assert not raw.evidence.complete and not state.complete and state.series == {}
    return "; ".join(raw.evidence.problems)


def changed(change) -> dict:
    document = copy.deepcopy(committed())
    change(document, document["series"]["margin"]["entries"])
    return document


# --- reading a file ---------------------------------------------------------------------------------


def test_each_entry_is_an_observation_that_carries_its_citation():
    raw, state = read(committed())
    assert raw.evidence.complete, raw.evidence.problems
    assert state.series == {"margin": [
        {"period": "2020-11-03", "value": "4.00", "status": "observed", "footnotes": [{"code": "citation", "text": CITED}]},
        {"period": "2024-11-05", "value": "-1.50", "status": "observed",
         "footnotes": [{"code": "citation", "text": CITED.replace("2020", "2024").replace("page 5", "page 6")}]}]}
    assert raw.evidence.checks == {"series": {"margin": {"rows": 2, "first": "2020-11-03", "last": "2024-11-05"}},
                                   "citations": 2}
    assert raw.evidence.scope == {**PARAMS, "origin": ORIGIN, "datasets": [DATASET], "asked_on": "2026-11-12"}
    # What was asked is a file of the repository, and nobody was asked for it.
    assert [(p.request.method, p.request.url, p.request.headers) for p in raw.parts] == [("READ", "repo:" + FILE, ())]
    assert MANUAL.coverage(raw.evidence.scope) == (None, None)


@pytest.mark.parametrize("change, said", [
    (lambda d, e: e[0].pop("citation"), "series margin, 2020-11-03 has no citation"),
    (lambda d, e: e[0]["citation"].pop("locator"), "series margin, 2020-11-03, has a citation with no locator"),
    (lambda d, e: e[0]["citation"].update(locator="  "), "has a citation with no locator"),
    (lambda d, e: e[0]["citation"].update(url="http://elections.invalid/x"), "has a citation whose url is not an https address"),
    (lambda d, e: e[0]["citation"].update(accessed="10 November 2026"), "does not say the day it was read"),
    (lambda d, e: e[0]["citation"].update(accessed="2026-11-13"), "read on 2026-11-13, after the file was captured (2026-11-12)"),
    (lambda d, e: e[0]["citation"].update(note="x"), "has a citation with a field this format does not know: note"),
    (lambda d, e: e[0].update(value=4.0), "has a value that is not a number written as text: 4.0"),
    (lambda d, e: e[0].update(value="about 4"), "has a value that is not a number written as text: 'about 4'"),
    (lambda d, e: e[0].update(period="2020-11"), "has an entry whose period, '2020-11', is not a irregular Period"),
    (lambda d, e: e[1].update(period="2020-11-03"), "series margin gives 2020-11-03 twice"),
    (lambda d, e: e[1].update(period="2028-11-07"), "is for a Period that had not begun on 2026-11-12"),
    (lambda d, e: e[0].update(source="memory"), "series margin, 2020-11-03 has a field this format does not know: source"),
    (lambda d, e: d["series"]["margin"].update(entries=[]), "series margin has no entries"),
    (lambda d, e: d["series"]["margin"].update(unit="percent"), "series margin is in 'percent', and the endpoint expects 'percentage points'"),
    (lambda d, e: d["series"].update(other=d["series"]["margin"]), "the file has a series the endpoint does not read: other"),
    (lambda d, e: d["series"].pop("margin"), "the file has no series margin"),
    (lambda d, e: d.update(frequency="annual"), "the file says its Periods are 'annual', and the endpoint expects 'irregular'"),
    (lambda d, e: d["origin"].update(producer="Someone Else"), "the file's Origin is 'Someone Else'"),
    (lambda d, e: d["origin"].update(dataset="Another set"), "the file's dataset is 'Another set', which the endpoint does not name"),
    (lambda d, e: d.update(format=2), "the file is not a hand-entered series file of format 1"),
    (lambda d, e: d.update(rights={"display": True}), "the file has a field this format does not know: rights"),
])
def test_what_makes_a_hand_entered_file_incomplete(change, said):
    assert said in problems_of(changed(change))


def test_a_file_that_is_not_strict_json_gives_nothing():
    assert "the file is not strict JSON" in problems_of(b'{"format": 1, "format": 1}')
    assert "the file is not strict JSON" in problems_of(b"format: 1")
    assert "the file is not a JSON object" in problems_of(b"[]")
    assert "the file is not UTF-8 text" in problems_of(b"\xff")


@pytest.mark.parametrize("value, working, said", [
    ("4.01", {"formula": "two_party_margin", "democratic": "5200", "republican": "4800"},
     "has the value 4.01, and its working gives 4.00 (the two-party margin of 5200 and 4800)"),
    ("4.00", {"formula": "two_party_margin", "democratic": "0", "republican": "0"}, "has working with no votes at all"),
    ("4.00", {"formula": "two_party_margin", "democratic": 5200, "republican": 4800},
     "has working whose votes are not whole numbers written as text"),
    ("4.00", {"formula": "share", "democratic": "1", "republican": "1"}, "has working whose formula is not one of: two_party_margin"),
    ("4.00", {"formula": "two_party_margin", "democratic": "5200"}, "does not give exactly the democratic and republican votes"),
])
def test_a_value_is_held_to_the_working_it_shows(value, working, said):
    assert said in problems_of(changed(lambda d, e: e[0].update(value=value, working=working)))


def test_the_working_checks_the_value_and_never_replaces_it():
    # 2 to 1 is a third of the two-party vote: 33.333... The value entered stands, at its own decimals.
    working = {"formula": "two_party_margin", "democratic": "2", "republican": "1"}
    for value in ("33", "33.3", "33.33"):
        raw, state = read(changed(lambda d, e, value=value: e[0].update(value=value, working=working)))
        assert raw.evidence.complete and state.series["margin"][0]["value"] == value
    # A half goes away from zero: 1 to 3 is -50, and 1005 to 995 is 0.5 and is entered as 1 or 0.5.
    assert manual.working_problem("1", {"formula": "two_party_margin", "democratic": "1005", "republican": "995"}) is None
    assert manual.working_problem("-1", {"formula": "two_party_margin", "democratic": "995", "republican": "1005"}) is None
    assert manual.working_problem("0", {"formula": "two_party_margin", "democratic": "1005", "republican": "995"}) is not None
    # A value too long to check is a problem with the file, never an error in the reader.
    third = {"formula": "two_party_margin", "democratic": "2", "republican": "1"}
    assert "more than 6 decimals" in manual.working_problem("33." + "3" * 28, third)
    assert manual.working_problem("33.333333", third) is None
    assert "its working gives 100" in manual.working_problem("1", {**third, "democratic": "9" * 40})


def test_arithmetic_that_cannot_be_done_is_a_problem_with_the_file(monkeypatch):
    # With the limit on decimals lifted, a value of thirty decimals is past what the arithmetic holds.
    monkeypatch.setattr(manual, "MAX_PLACES", 40)
    third = {"formula": "two_party_margin", "democratic": "2", "republican": "1"}
    assert "cannot be worked out" in manual.working_problem("33." + "3" * 28, third)


# --- where the bytes come from ----------------------------------------------------------------------


def test_a_live_run_reads_the_file_from_the_repository_and_asks_no_one():
    transport = LiveTransport(root=REPO)
    raw = capture(endpoint(), Fetch(Session(transport, sleep=lambda s: None)))
    assert transport._http is None  # the network library was never opened
    assert raw.bodies == [(REPO / FILE).read_bytes()]
    assert raw.evidence.scope["file"] == FILE and raw.parts[0].response.status == 200


def test_a_file_that_is_not_there_fails_the_capture_and_says_so(tmp_path):
    fetch = Fetch(Session(LiveTransport(root=tmp_path), sleep=lambda s: None))
    with pytest.raises(CaptureError, match="the hand-entered file catalog/manual/invented-margins.json is not in the repository"):
        capture(endpoint(), fetch)
    assert [part.response.status for part in fetch.parts] == [404]


@pytest.mark.parametrize("path", ["catalog/manual/../series/cpi.json", "/etc/passwd", "catalog/series/cpi.json",
                                  "catalog/manual/terms/invented-office.json", "catalog/manual/x.json/../../y.json",
                                  "catalog/manual/Upper.json", "catalog/manual/x.txt"])
def test_nothing_outside_the_one_directory_is_ever_read(path, tmp_path):
    assert MANUAL.problem({**PARAMS, "file": path}) == "its file is not a file directly under catalog/manual"
    # And if a path of another shape reached the transport anyway, it reads nothing.
    with pytest.raises(CaptureError, match="is not a file under catalog/manual"):
        Fetch(Session(LiveTransport(root=REPO), sleep=lambda s: None)).read(path)
    assert manual.FILE.pattern == READ_PATH.pattern


def test_a_link_that_leads_out_of_the_directory_is_not_followed(tmp_path):
    (tmp_path / "catalog" / "manual").mkdir(parents=True)
    (tmp_path / "secret.json").write_text('{"not": "for the store"}')
    os.symlink(tmp_path / "secret.json", tmp_path / "catalog" / "manual" / "link.json")
    with pytest.raises(CaptureError, match="is not a file under catalog/manual"):
        Fetch(Session(LiveTransport(root=tmp_path), sleep=lambda s: None)).read("catalog/manual/link.json")


# --- through the run: rights, the log, a replay -----------------------------------------------------


def test_the_origins_row_decides_whether_a_hand_entered_file_may_be_kept(tmp_path):
    refused = run_capture(tmp_path / "a", register(entry_row(signed=False)), LiveTransport(root=REPO))
    assert refused.exit_code == 1 and not (tmp_path / "a").exists()
    assert "the rights register row for An Invented Election Office (office) is not signed" in refused.lines[0]
    assert run_capture(tmp_path / "b", register(entry_row(store=False)), LiveTransport(root=REPO)).exit_code == 1

    done = run_capture(tmp_path / "c", register(entry_row()), LiveTransport(root=REPO), sleep=lambda s: None)
    assert done.exit_code == 0, done.lines
    (line,) = read_fetch_log(tmp_path / "c")
    assert (line["outcome"], line["channel"], line["adapter"]["name"]) == ("captured", "hand_entered", "manual")
    assert line["transport"] == "live" and line["real_bytes"] is True
    assert line["parts"][0]["request"] == {"method": "READ", "url": "repo:" + FILE, "headers": [], "body": None}
    assert "key" not in line


def test_what_was_entered_is_exported_only_when_its_row_allows_redistribution_and_replays_the_same(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    table = register(entry_row(redistribute=False))
    assert run_capture(store, table, LiveTransport(root=REPO), sleep=lambda s: None).exit_code == 0
    with pytest.raises(ExportRefused, match="does not allow redistribute"):
        export_exchanges(store, out, table, note="test")
    assert not out.exists()
    table = register(entry_row())
    assert export_exchanges(store, out, table, note="test") == ["office-margins"]
    assert (out / "office" / "office-margins" / "part-1.json").read_bytes() == (REPO / FILE).read_bytes()
    # A replay answers from the recording and never looks at a file of the repository.
    replayed = capture(endpoint(), Fetch(Session(ReplayTransport(out), sleep=lambda s: None)))
    assert replayed.evidence.complete and replayed.bodies == [(REPO / FILE).read_bytes()]


@pytest.mark.parametrize("entry, said", [
    ({"adapter": "manual", "channel": "direct"}, "the hand_entered channel and the manual adapter go together"),
    ({"adapter": "manual"}, "the hand_entered channel and the manual adapter go together"),
    ({"adapter": "fixture", "channel": "hand_entered", "params": {"url": "https://fixture.invalid/a"}},
     "the hand_entered channel and the manual adapter go together"),
    ({"adapter": "manual", "channel": "hand_entered", "params": {**PARAMS, "frequency": "sometimes"}},
     "it does not say the frequency of the file's Periods"),
    ({"adapter": "manual", "channel": "hand_entered", "params": {**PARAMS, "units": {}}}, "it does not pin the unit of each series"),
    ({"adapter": "manual", "channel": "hand_entered", "params": {**PARAMS, "series": []}}, "it names no series"),
])
def test_the_register_refuses_a_hand_entered_endpoint_it_cannot_read(entry, said):
    listed = {"id": "office-margins", "datasets": [DATASET], "params": PARAMS, **entry}
    with pytest.raises(RegisterError, match=said):
        endpoints_from_register(register(origin_row("office", ORIGIN, [listed])))


# --- terms of government ----------------------------------------------------------------------------

TERMS = REPO / "catalog" / "manual" / "terms" / "invented-office.json"


def terms_problems(change) -> str:
    document = json.loads(TERMS.read_text())
    change(document, document["terms"])
    problems: list[str] = []
    assert manual.read_terms_file(json.dumps(document).encode(), problems, today="2026-11-12") is None
    return "; ".join(problems)


def test_a_terms_file_says_who_held_an_office_and_when_each_with_a_citation():
    (document,) = manual.load_terms(REPO / "catalog" / "manual")
    assert (document["office"], document["label"]) == ("invented_office", "Keeper of the Invented Office")
    assert [(t["holder"], t["start"], t["end"], t["party"]) for t in document["terms"]] == [
        ("A. Example", "2017-02-01", "2021-01-31", "R"), ("B. Sample", "2021-02-01", None, "D")]
    assert all(manual.citation_problem(t["citation"]) is None for t in document["terms"])
    assert manual.load_terms(ROOT / "catalog" / "manual") == []  # nothing is entered yet (no row is signed)


@pytest.mark.parametrize("change, said", [
    (lambda d, t: t[0].pop("citation"), "term 1 (A. Example) has no citation"),
    (lambda d, t: t[1].update(start="2021-01-31"), "term 2 (B. Sample) starts on 2021-01-31, not after the term before it ended (2021-01-31)"),
    (lambda d, t: t[0].update(end=None), "term 2 (B. Sample) follows a term that has not ended"),
    (lambda d, t: t[0].update(end="2016-01-01"), "term 1 (A. Example) ends before it starts"),
    (lambda d, t: t[0].update(start="February 2017"), "does not give its start and end as days"),
    (lambda d, t: t[0].update(party="Whig"), "has a party that is not one of D, R, I"),
    (lambda d, t: t[0].update(verdict="good"), "has a field this format does not know: verdict"),
    (lambda d, t: t[0]["citation"].update(accessed="2026-11-13"), "read on 2026-11-13, after the file was captured"),
    (lambda d, t: d.update(terms=[]), "the file has no terms"),
    (lambda d, t: d.update(kind="series"), "the file is not a hand-entered terms file of format 1"),
    (lambda d, t: d.update(office="The Office"), "the file's office is not a short name in lower case"),
    (lambda d, t: d.pop("origin"), "the file has no origin"),
])
def test_what_makes_a_terms_file_unusable(change, said):
    assert said in terms_problems(change)


# --- dated spans: a recession layer (M19) --------------------------------------------------------------

SPANS = REPO / "catalog" / "manual" / "spans" / "invented-recessions.json"


def spans_problems(change) -> str:
    document = json.loads(SPANS.read_text())
    change(document, document["spans"])
    problems: list[str] = []
    assert manual.read_spans_file(json.dumps(document).encode(), problems, today="2026-11-12") is None
    return " | ".join(problems)


def test_a_spans_file_says_when_each_stretch_ran_each_with_a_citation():
    (document,) = manual.load_spans(REPO / "catalog" / "manual")
    assert document["layer"] == "recession"
    assert [(s["start"], s["end"]) for s in document["spans"]] == [("2018-03-01", "2018-11-30"), ("2022-07-01", "2023-03-31")]
    assert all(manual.citation_problem(s["citation"]) is None for s in document["spans"])
    assert manual.load_spans(ROOT / "catalog" / "manual") == []  # nothing is entered yet (no row is signed)
    assert manual.stray_files(REPO / "catalog" / "manual") == []


@pytest.mark.parametrize("change, said", [
    (lambda d, s: s[1].update(start="2018-11-30"), "not after the span before it ended"),
    (lambda d, s: s[0].update(end="2018-02-01"), "ends before it starts"),
    (lambda d, s: s[0].update(end=None), "follows a span that has not ended"),
    (lambda d, s: s[0].pop("citation"), "has no citation"),
    (lambda d, s: s[0].update(cause="a rate rise"), "a field this format does not know: cause"),
    (lambda d, s: d.update(layer="boom"), "layer is not one of recession"),
    (lambda d, s: d.update(origin={"producer": "x"}), "does not name its Origin"),
    (lambda d, s: d.update(spans=[]), "the file has no spans"),
    (lambda d, s: d.update(kind="terms"), "the file is not a hand-entered spans file of format 1"),
])
def test_what_makes_a_spans_file_unusable(change, said):
    assert said in spans_problems(change)
