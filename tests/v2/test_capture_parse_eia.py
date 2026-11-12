"""The EIA adapter (PLAN M15; ADR 0029): one route of the Administration's API v2, the series
named by one facet, every Period, in pages. Bodies are small and every value is invented."""
import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint
from atlas.capture.run import RegisterError, endpoints_from_register

from .bea_eia_helpers import EIA_URL, body, eia, generation, spot
from .capture_helpers import LiveScripted, Scripted, origin_row, register

EIA = ADAPTERS["eia"]
KEY = "abcDEF0123456789abcDEF0123456789abcdefgh"
BASE = {"route": "petroleum/pri/spt", "frequency": "monthly", "series": ["RBRTE", "RWTC"],
        "units": {"RBRTE": "$/BBL", "RWTC": "$/BBL"}}


def url(offset=0, length=5000, series=("RBRTE", "RWTC"), route="petroleum/pri/spt", frequency="monthly"):
    facets = "".join(f"&facets%5Bseries%5D%5B%5D={s}" for s in series)
    return (f"{EIA_URL}/{route}/data/?frequency={frequency}&data%5B0%5D=value{facets}"
            "&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=asc"
            "&sort%5B1%5D%5Bcolumn%5D=series&sort%5B1%5D%5Bdirection%5D=asc"
            f"&offset={offset}&length={length}")


def endpoint(**params):
    return Endpoint("eia-x", "eia", "eia", "U.S. Energy Information Administration", ("Spot Prices",),
                    "direct", {**BASE, **params})


def read(answers: dict, spec=None, start="2026-11-11T15:50:00"):
    spec = spec or endpoint()
    transport = Scripted({u: [(200, body(a))] for u, a in answers.items()}, start=start)
    raw = capture(spec, Fetch(Session(transport, sleep=lambda s: None)))
    return raw, EIA.parse(raw)


ROWS = [spot("RBRTE", "2026-08", "71.5"), spot("RWTC", "2026-08", "68.20"),
        spot("RBRTE", "2026-09", "70"), spot("RWTC", "2026-09", "-1.25")]


def test_monthly_prices_are_read_by_series_as_the_administration_printed_them():
    raw, state = read({url(): eia(ROWS)})
    assert raw.evidence.complete, raw.evidence.problems
    assert state.complete
    assert state.series == {
        "RBRTE": [{"period": "2026-08", "value": "71.5", "status": "observed", "footnotes": []},
                  {"period": "2026-09", "value": "70", "status": "observed", "footnotes": []}],
        "RWTC": [{"period": "2026-08", "value": "68.20", "status": "observed", "footnotes": []},
                 {"period": "2026-09", "value": "-1.25", "status": "observed", "footnotes": []}]}
    assert raw.evidence.checks == {"total": 4, "pages": 1, "series": {
        "RBRTE": {"rows": 2, "first": "2026-08", "last": "2026-09"},
        "RWTC": {"rows": 2, "first": "2026-08", "last": "2026-09"}}}
    assert EIA.coverage(raw.evidence.scope) == (None, None)


def test_the_key_is_asked_for_by_name_and_is_not_in_the_request_that_is_kept():
    spec = endpoint()
    assert EIA.key(spec.params) == ("api_key", "EIA_API_KEY")
    transport = LiveScripted({url() + "&api_key=" + KEY: [(200, body(eia(ROWS)))]})
    raw = capture(spec, Fetch(Session(transport, sleep=lambda s: None, keys={"EIA_API_KEY": KEY})))
    assert raw.evidence.complete and raw.parts[0].request.url == url()


def test_a_week_is_named_for_the_iso_week_of_its_date_and_a_week_listed_with_no_number_is_missing():
    spec = endpoint(route="petroleum/pri/gnd", frequency="weekly", series=["GAS"], units={"GAS": "$/GAL"})
    rows = [spot("GAS", "2026-11-02", "3.950", "$/GAL"), spot("GAS", "2026-11-09", None, "$/GAL"),
            spot("GAS", "2026-10-26", "3.9", "$/GAL")]
    rows.sort(key=lambda row: row["period"])
    raw, state = read({url(series=["GAS"], route="petroleum/pri/gnd", frequency="weekly"):
                       eia(rows, route="petroleum/pri/gnd", frequency="weekly")}, spec)
    assert raw.evidence.complete, raw.evidence.problems
    assert [(o["period"], o["value"], o["status"]) for o in state.series["GAS"]] == [
        ("2026-W44", "3.9", "observed"), ("2026-W45", "3.950", "observed"), ("2026-W46", None, "unavailable")]


def test_a_bare_number_is_kept_as_the_text_the_administration_sent():
    page = body(eia([spot("RWTC", "2026-09", "X")])).replace(b'"X"', b"68.20")
    spec = endpoint(series=["RWTC"], units={"RWTC": "$/BBL"})
    transport = Scripted({url(series=["RWTC"]): [(200, page)]})
    raw = capture(spec, Fetch(Session(transport, sleep=lambda s: None)))
    assert raw.evidence.complete, raw.evidence.problems
    assert EIA.parse(raw).series["RWTC"][0]["value"] == "68.20"


def test_a_figure_printed_without_a_zero_before_its_point_is_given_one_and_nothing_else_changes():
    rows = [spot("RBRTE", "2026-08", ".995"), spot("RWTC", "2026-08", "-.50"), spot("RBRTE", "2026-09", "1.")]
    raw, state = read({url(): eia(rows)})
    assert raw.evidence.problems == ["RBRTE has a value that is not a number or null for 2026-09: '1.'"]
    raw, state = read({url(): eia(rows[:2])})
    assert (state.series["RBRTE"][0]["value"], state.series["RWTC"][0]["value"]) == ("0.995", "-0.50")


def test_a_long_series_is_read_in_pages_until_the_total_is_reached():
    spec = endpoint(series=["RWTC"], units={"RWTC": "$/BBL"}, page_size=2)
    rows = [spot("RWTC", f"2026-0{m}", f"6{m}.0") for m in range(1, 6)]
    pages = {url(o, 2, ["RWTC"]): eia(rows[o:o + 2], total=5, offset=o, length=2) for o in (0, 2, 4)}
    raw, state = read(pages, spec)
    assert raw.evidence.complete, raw.evidence.problems
    assert len(raw.parts) == 3 and raw.evidence.checks["pages"] == 3
    assert [o["period"] for o in state.series["RWTC"]] == ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]

    # The table grew between two pages: the totals no longer agree.
    pages[url(4, 2, ["RWTC"])] = eia(rows[4:], total=6, offset=4, length=2)
    raw, state = read(pages, spec)
    assert state.complete is False
    assert "the pages do not agree on the total; the data changed while it was read" in raw.evidence.problems


def test_generation_is_read_from_its_own_column_by_fuel_with_the_other_facets_held():
    spec = endpoint(route="electricity/electric-power-operational-data", column="generation", facet="fueltypeid",
                    series=["ALL"], facets={"location": "US", "sectorid": "99"}, units={"ALL": "thousand megawatthours"})
    address = (f"{EIA_URL}/electricity/electric-power-operational-data/data/?frequency=monthly&data%5B0%5D=generation"
               "&facets%5Bfueltypeid%5D%5B%5D=ALL&facets%5Blocation%5D%5B%5D=US&facets%5Bsectorid%5D%5B%5D=99"
               "&sort%5B0%5D%5Bcolumn%5D=period&sort%5B0%5D%5Bdirection%5D=asc"
               "&sort%5B1%5D%5Bcolumn%5D=fueltypeid&sort%5B1%5D%5Bdirection%5D=asc&offset=0&length=5000")
    how = {"route": "electricity/electric-power-operational-data", "column": "generation"}
    raw, state = read({address: eia([generation("ALL", "2026-08", "400000.55472")], **how)}, spec)
    assert raw.evidence.complete, raw.evidence.problems
    assert state.series["ALL"][0]["value"] == "400000.55472"
    other = generation("ALL", "2026-08", "1")
    other["sectorid"] = "1"
    raw, _ = read({address: eia([other], **how)}, spec)
    assert "a row for ALL in 2026-08 has sectorid '1', not '99'" in raw.evidence.problems


def one(row, **how):
    return eia([row], **how)


@pytest.mark.parametrize(("answer", "said"), [
    ({"error": {"code": "API_KEY_INVALID", "message": "An invalid api_key was supplied."}},
     "EIA says: API_KEY_INVALID An invalid api_key was supplied."),
    (eia(ROWS, warnings=[{"warning": "parameter out of range: length", "description": "The maximum is 5000."}]),
     "EIA warns: parameter out of range: length The maximum is 5000."),
    (eia([]), "the answer has no rows"),
    (eia(ROWS[:1] + ROWS[2:3]), "RWTC is not in the answer"),
    (eia([spot("RBRTE", "2026-08", "1"), spot("RWTC", "2026-08", None)]),
     "RWTC is in the answer without a single number"),
    (eia(ROWS, total=7), "the answer says there are 7 rows and 4 were read"),
    (eia(ROWS, route="petroleum/pri/gnd"), "the answer says it is /v2/petroleum/pri/gnd/data/, not /v2/petroleum/pri/spt/data/"),
    (eia(ROWS, frequency="weekly"), "the answer is weekly, not monthly"),
    (eia([*ROWS, spot("NOPE", "2026-09", "1")]), "NOPE was not asked for"),
    (eia([ROWS[1], ROWS[0], *ROWS[2:]]), "the rows are not in order of period and series, or one is repeated, at 2026-08 RBRTE"),
    (eia([*ROWS, ROWS[3]]), "the rows are not in order of period and series, or one is repeated, at 2026-09 RWTC"),
    (eia([*ROWS[:3], spot("RWTC", "2026-09", "1", "$/GAL")]), "RWTC is in '$/GAL' for 2026-09; '$/BBL' was expected"),
    (eia([*ROWS[:3], spot("RWTC", "2026-09", "n/a")]), "RWTC has a value that is not a number or null for 2026-09: 'n/a'"),
    (eia([*ROWS[:3], spot("RWTC", "2026-9", "1")]), "RWTC has a time that is not a month: '2026-9'"),
    (eia([*ROWS, spot("RBRTE", "2026-12", "1"), spot("RWTC", "2026-12", "1")]),
     "RBRTE has a value for 2026-12, a Period that had not begun on 2026-11-11"),
])
def test_an_answer_that_is_not_the_whole_of_what_was_asked_is_incomplete_and_says_why(answer, said):
    raw, state = read({url(): answer})
    assert raw.evidence.complete is False and state.complete is False
    assert said in raw.evidence.problems, raw.evidence.problems


def test_two_dates_in_one_week_are_one_period_given_twice():
    spec = endpoint(route="petroleum/pri/gnd", frequency="weekly", series=["GAS"], units={"GAS": "$/GAL"})
    rows = [spot("GAS", "2026-11-02", "3.9", "$/GAL"), spot("GAS", "2026-11-03", "3.9", "$/GAL")]
    raw, _ = read({url(series=["GAS"], route="petroleum/pri/gnd", frequency="weekly"):
                   eia(rows, route="petroleum/pri/gnd", frequency="weekly")}, spec)
    assert "GAS gives 2026-W45 twice" in raw.evidence.problems


def test_paging_stops_at_a_ceiling_and_says_so():
    spec = endpoint(series=["RWTC"], units={"RWTC": "$/BBL"}, page_size=1)
    answers = {url(o, 1, ["RWTC"]): eia([spot("RWTC", f"19{o:02d}-01", "1")], total=10**6, offset=o, length=1)
               for o in range(EIA.MAX_PAGES)}
    raw, _ = read(answers, spec)
    assert len(raw.parts) == EIA.MAX_PAGES
    assert f"the answer says there are 1000000 rows and {EIA.MAX_PAGES} were read" in raw.evidence.problems


@pytest.mark.parametrize(("params", "said"), [
    ({"route": "petroleum/../x"}, "it names no route"),
    ({"frequency": "hourly"}, "its frequency is not daily, weekly, monthly, quarterly or annual"),
    ({"series": ["RWTC", "RWTC"]}, "it does not name its series"),
    ({"units": {"RWTC": "$/BBL"}}, "it does not pin the units of RBRTE"),
    ({"facets": {"series": "X"}}, "its facets hold the facet that names its series"),
    ({"page_size": 6000}, "its page_size is not between 1 and 5000"),
])
def test_the_register_cannot_list_an_endpoint_the_adapter_could_not_read(params, said):
    entry = {"id": "eia-x", "adapter": "eia", "datasets": ["Spot Prices"], "params": {**BASE, **params}}
    table = register(origin_row("eia", "U.S. Energy Information Administration", [entry]))
    with pytest.raises(RegisterError, match=said):
        endpoints_from_register(table)
