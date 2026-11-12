"""The two Census readers (PLAN M16; ADR 0030): a flat file of the Economic Indicators, whole,
in a zip; and the construction workbook. Files are small and every value is invented."""
import pytest

from atlas.capture import Fetch, Session, capture
from atlas.capture.adapters import ADAPTERS, Endpoint
from atlas.capture.run import RegisterError, endpoints_from_register

from .capture_helpers import Scripted, origin_row, register
from .census_helpers import C30_URL, FLAT_URL, TITLE, UNITS, c30, flat, flat_csv, workbook, zipped

EITS = ADAPTERS["census_eits"]
C30 = ADAPTERS["census_c30"]
RETAIL = "44X72:SM:US:SA"
LABELS = {RETAIL: {"category": "44X72: Retail Trade and Food Services", "data_type": "Sales - Monthly",
                   "unit": "MLN$", "geo": "U.S. Total"}}
SHAPE = {
    "categories": [("44X72", "44X72: Retail Trade and Food Services"), ("44000", "44000: Retail Trade")],
    "data_types": [("SM", "Sales - Monthly", "MLN$"), ("MPCSM", "Sales - Monthly Percent Change", "PCT")],
    "periods": ["Jul-2026", "Aug-2026", "Sep-2026", "Oct-2026", "Nov-2026", "Dec-2026"],
}
ROWS = [
    ("Jul-2026", "44X72", "SM", "US", False, "700100"), ("Jul-2026", "44X72", "SM", "US", True, "690000"),
    ("Aug-2026", "44X72", "SM", "US", True, "691250"), ("Aug-2026", "44X72", "MPCSM", "US", True, "0.2"),
    ("Sep-2026", "44X72", "SM", "US", True, "-12.5"), ("Sep-2026", "44000", "SM", "US", True, "600000"),
    ("Sep-2026", "44X72", "MPCSM", "US", True, "Z"), ("Sep-2026", "44X72", "SM", "US", True, "0.4", "E_SM"),
]


def flat_endpoint(**params):
    return Endpoint("census-x", "census", "census_eits", "U.S. Census Bureau", ("Monthly Retail Trade",), "direct",
                    {"program": "MARTS", "series": [RETAIL], "labels": LABELS, **params})


def read_flat(body: bytes, spec=None, start="2026-11-11T15:50:00"):
    spec = spec or flat_endpoint()
    transport = Scripted({FLAT_URL + spec.params["program"]: [(200, body, [["Content-Type", "application/octet-stream"]])]},
                         start=start)
    raw = capture(spec, Fetch(Session(transport, sleep=lambda s: None)))
    return raw, EITS.parse(raw)


def problems_of(body: bytes, spec=None, **more) -> str:
    raw, state = read_flat(body, spec, **more)
    assert not raw.evidence.complete and not state.complete and state.series == {}
    return "; ".join(raw.evidence.problems)


# --- the flat files -------------------------------------------------------------------------------


def test_a_series_is_read_by_the_bureaus_own_codes_as_the_file_printed_it():
    raw, state = read_flat(flat("MARTS", **SHAPE, rows=ROWS))
    assert raw.evidence.complete, raw.evidence.problems
    assert state.complete
    # The adjusted estimate only: not the unadjusted one, not another category, not the row of
    # sampling error for the same month. A month the file lists with no row is no Observation.
    assert state.series == {RETAIL: [
        {"period": "2026-07", "value": "690000", "status": "observed", "footnotes": []},
        {"period": "2026-08", "value": "691250", "status": "observed", "footnotes": []},
        {"period": "2026-09", "value": "-12.5", "status": "observed", "footnotes": []}]}
    assert raw.evidence.checks == {
        "member": "MARTS-mf.csv", "updated": "Thursday, 15-Oct-26 07:31:23 EDT", "rows": 8,
        "series": {RETAIL: {"rows": 3, "first": "2026-07", "last": "2026-09"}}}
    assert raw.evidence.scope == {"program": "MARTS", "series": [RETAIL], "labels": LABELS,
                                  "asked_on": "2026-11-11"}
    assert raw.parts[0].request.url == FLAT_URL + "MARTS"
    assert EITS.coverage(raw.evidence.scope) == (None, None)


def test_a_file_without_a_section_of_sampling_error_is_read_the_same_way():
    series = "BOPGS:BAL:US:SA"
    spec = flat_endpoint(program="FTD", series=[series], labels={series: {
        "category": "Balance of Payment Goods and Services", "data_type": "Balance", "unit": "MLN$",
        "geo": "United States"}})
    body = flat("FTD", categories=[("BOPGS", "Balance of Payment Goods and Services")],
                data_types=[("BAL", "Balance", "MLN$")], geos=[("US", "United States")], errors=(),
                periods=["Aug-2026", "Sep-2026"],
                rows=[("Aug-2026", "BOPGS", "BAL", "US", True, "-70123"), ("Sep-2026", "BOPGS", "BAL", "US", True, "-68000")])
    raw, state = read_flat(body, spec)
    assert raw.evidence.complete, raw.evidence.problems
    assert [o["value"] for o in state.series[series]] == ["-70123", "-68000"]


def test_a_label_that_differs_from_the_one_pinned_makes_the_capture_incomplete():
    shape = {**SHAPE, "data_types": [("SM", "Sales - Monthly", "BLN$"), SHAPE["data_types"][1]]}
    assert "labels its unit 'BLN$', and the endpoint expects 'MLN$'" in problems_of(flat("MARTS", **shape, rows=ROWS))
    shape = {**SHAPE, "categories": [("44X72", "44X72: Something Else"), SHAPE["categories"][1]]}
    assert "labels its category '44X72: Something Else'" in problems_of(flat("MARTS", **shape, rows=ROWS))


@pytest.mark.parametrize("rows, said", [
    ([*ROWS, ("Oct-2026", "44X72", "SM", "US", True, "(S)")], "has a value that is not a number for 2026-10: '(S)'"),
    ([*ROWS, ("Aug-2026", "44X72", "SM", "US", True, "691250")], "gives 2026-08 twice"),
    ([*ROWS, ("Dec-2026", "44X72", "SM", "US", True, "1")], "has a value for 2026-12, a Period that had not begun on 2026-11-11"),
    ([row for row in ROWS if not (row[2] == "SM" and row[4] and row[1] == "44X72" and len(row) == 6)],
     f"{RETAIL} has no rows"),
])
def test_what_makes_a_flat_file_incomplete(rows, said):
    assert said in problems_of(flat("MARTS", **SHAPE, rows=rows))


def test_a_series_the_file_does_not_know_is_named():
    spec = flat_endpoint(series=["44X72:SM:US:SA", "99999:SM:US:SA"],
                         labels={**LABELS, "99999:SM:US:SA": LABELS[RETAIL]})
    assert "99999:SM:US:SA: the file has no category 99999" in problems_of(flat("MARTS", **SHAPE, rows=ROWS), spec)


@pytest.mark.parametrize("body, said", [
    (b"<html>Access denied</html>", "the answer is not a zip file"),
    (zipped({"README": b"nothing"}), "the zip does not hold MARTS-mf.csv"),
    (zipped({"MARTS-mf.csv": b"CATEGORIES\r\ncat_idx,cat_code,cat_desc,cat_indent\r\n1,44X72,\"x\",0\r\n"}),
     "the file has no DATA TYPES section"),
    (zipped({"MARTS-mf.csv": flat_csv(**SHAPE, rows=ROWS).replace("per_idx,per_name", "per_idx,per_label").encode()}),
     "the TIME PERIODS section does not begin with per_idx,per_name"),
    (zipped({"MARTS-mf.csv": flat_csv(**SHAPE, rows=ROWS).replace("3,Sep-2026", "3,Q3-2026").encode()}),
     "the file lists the time period 'Q3-2026', which is not a month"),
    (zipped({"MARTS-mf.csv": (flat_csv(**SHAPE, rows=ROWS) + "9,1,1,0,1,1,5\r\n").encode()}),
     "a row of data names period 9, which the file does not list"),
    (zipped({"MARTS-mf.csv": (flat_csv(**SHAPE, rows=ROWS) + "1,1,1,0,1\r\n").encode()}),
     "a row of data has 5 cells, not 7"),
    (zipped({"MARTS-mf.csv": flat_csv(**SHAPE, rows=ROWS).encode() + b"\xff"}), "the file is not UTF-8 text"),
])
def test_a_file_in_another_shape_is_incomplete_and_gives_no_observation(body, said):
    assert said in problems_of(body)


def test_a_member_too_large_to_be_a_flat_file_is_not_opened():
    huge = zipped({"MARTS-mf.csv": b"0" * (EITS.MAX_BYTES + 1)})
    assert "MARTS-mf.csv is larger than" in problems_of(huge)


@pytest.mark.parametrize("params, said", [
    ({"program": "marts"}, "its program is not a code"),
    ({"series": []}, "it names no series"),
    ({"series": ["44X72:SM:US"]}, "44X72:SM:US is not category:data type:geography:SA or NSA"),
    ({"series": [RETAIL, RETAIL]}, "it names a series twice"),
    ({"labels": {}}, f"it does not pin the labels of {RETAIL}"),
    ({"labels": {RETAIL: {"category": "x", "data_type": "y", "unit": "MLN$"}}}, f"it does not pin the labels of {RETAIL}"),
])
def test_the_register_refuses_a_flat_file_endpoint_it_cannot_read(params, said):
    entry = {"id": "census-x", "adapter": "census_eits", "datasets": ["Monthly Retail Trade"],
             "params": {"program": "MARTS", "series": [RETAIL], "labels": LABELS, **params}}
    with pytest.raises(RegisterError, match=said):
        endpoints_from_register(register(origin_row("census", "U.S. Census Bureau", [entry])))


# --- the construction workbook --------------------------------------------------------------------

TOTAL, PRIVATE = "Total Construction", "Total Private Construction2"
MONTHS = [("Sep-26p", [2100000, 900000, 1600000]), ("Aug-26r", [2090000.5, 899000, 1590000]),
          ("Jul-26r", [2080000, 898000, 1580000]), ("Jun-26", [2070000, 897000, 1570000])]


def c30_endpoint(**params):
    return Endpoint("census-c30", "census", "census_c30", "U.S. Census Bureau",
                    ("Value of Construction Put in Place",), "direct",
                    {"file": "totsatime.xlsx", "series": [TOTAL, PRIVATE], "title": TITLE, "units": UNITS, **params})


def read_c30(body: bytes, spec=None, start="2026-11-11T15:50:00"):
    spec = spec or c30_endpoint()
    kind = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    transport = Scripted({C30_URL + spec.params["file"]: [(200, body, [["Content-Type", kind]])]}, start=start)
    raw = capture(spec, Fetch(Session(transport, sleep=lambda s: None)))
    return raw, C30.parse(raw)


def c30_problems(body: bytes, spec=None, **more) -> str:
    raw, state = read_c30(body, spec, **more)
    assert not raw.evidence.complete and not state.complete and state.series == {}
    return "; ".join(raw.evidence.problems)


def test_the_workbook_is_read_by_column_heading_with_the_bureaus_marks():
    raw, state = read_c30(c30(MONTHS))
    assert raw.evidence.complete, raw.evidence.problems
    assert state.series == {
        TOTAL: [{"period": "2026-06", "value": "2070000", "status": "observed", "footnotes": []},
                {"period": "2026-07", "value": "2080000", "status": "revised", "footnotes": []},
                {"period": "2026-08", "value": "2090000.5", "status": "revised", "footnotes": []},
                {"period": "2026-09", "value": "2100000", "status": "preliminary", "footnotes": []}],
        PRIVATE: [{"period": "2026-06", "value": "1570000", "status": "observed", "footnotes": []},
                  {"period": "2026-07", "value": "1580000", "status": "revised", "footnotes": []},
                  {"period": "2026-08", "value": "1590000", "status": "revised", "footnotes": []},
                  {"period": "2026-09", "value": "1600000", "status": "preliminary", "footnotes": []}]}
    assert raw.evidence.checks == {"rows": 4, "first": "2026-06", "last": "2026-09",
                                   "preliminary": 1, "revised": 2}
    assert raw.evidence.scope["asked_on"] == "2026-11-11"
    assert C30.coverage(raw.evidence.scope) == (None, None)


def test_a_two_digit_year_is_read_from_the_day_of_the_fetch_and_then_counted_back():
    months = [("Feb-00", [3, 1, 2]), ("Jan-00", [3, 1, 2]), ("Dec-99", [3, 1, 2]), ("Nov-99", [3, 1, 2])]
    _, state = read_c30(c30(months), start="2000-04-03T15:00:00")
    assert [o["period"] for o in state.series[TOTAL]] == ["1999-11", "1999-12", "2000-01", "2000-02"]
    # Replayed a century later the same bytes say the same thing: the day asked is in the scope.
    raw, _ = read_c30(c30(months), start="2000-04-03T15:00:00")
    assert C30.examine(raw.evidence.scope, raw.bodies).complete


@pytest.mark.parametrize("body, said", [
    (b"not a workbook", "the answer is not a zip file"),
    (zipped({"xl/workbook.xml": b"<workbook/>"}), "the workbook has no xl/worksheets/sheet1.xml"),
    (workbook([[TITLE], [UNITS], [None], ["Date", "Total\r\n_x000D_Construction"]],
              extra={"xl/worksheets/sheet2.xml": b"<worksheet/>"}), "the workbook has 2 sheets, not one"),
    (c30(MONTHS, title="Value of Construction Put in Place - Not Seasonally Adjusted"), "its title is"),
    (c30(MONTHS, units="(Billions of dollars.)"), "the line under its title is"),
    (c30(MONTHS, headers=("Total\r\n_x000D_Construction", "Total\r\n_x000D_Residential", "Total\r\n_x000D_Private Construction")),
     "it has no column headed 'Total Private Construction2'"),
    (c30(MONTHS, headers=("Total\r\n_x000D_Construction", "Total Construction", "Total\r\n_x000D_Private Construction2")),
     "it has two columns headed 'Total Construction'"),
    (c30([]), "the table has no rows"),
    (c30([MONTHS[0], MONTHS[2]]), "'Jul-26r' follows 'Sep-26p'; the month before it is Aug-26"),
    (c30([("Dec-26", [1, 2, 3]), ("Nov-26", [1, 2, 3])]), "its newest row, 'Dec-26', is for a Period that had not begun on 2026-11-11"),
    (c30([("Jan-27", [1, 2, 3]), ("Dec-26", [1, 2, 3])]), "its newest row, 'Jan-27', is for a Period that had not begun on 2026-11-11"),
    (c30([MONTHS[0], ("Aug-26r", [None, 1, 2])]), "Total Construction has no number for 2026-08"),
    (c30([MONTHS[0], ("Aug-26r", ["n/a", 1, 2])]), "Total Construction has a value that is not a number for 2026-08: 'n/a'"),
    (c30(MONTHS, after=("p Preliminary", "May-26")), "'May-26' is a month below the end of the table"),
    (workbook([[TITLE], [UNITS], [None], ["Month", "Total\r\n_x000D_Construction"]]), "it has no row of column headings"),
    # A row of figures with a name that is not a month is not taken for a note under the table.
    (c30([*MONTHS[:3], ("Jun-26x", [1, 2, 3])]), "row 8 holds numbers and is not named for a month ('Jun-26x')"),
    (c30([*MONTHS[:2], (None, [1, 2, 3]), MONTHS[3]]), "row 7 holds numbers and is not named for a month (None)"),
])
def test_what_makes_the_workbook_incomplete(body, said):
    assert said in c30_problems(body)


def test_a_sheet_too_large_to_be_the_table_is_not_opened():
    body = zipped({"xl/workbook.xml": b"<workbook/>", "xl/sharedStrings.xml": b"<sst/>",
                   "xl/worksheets/sheet1.xml": b" " * (C30.MAX_BYTES + 1)})
    assert "xl/worksheets/sheet1.xml is larger than" in c30_problems(body)


def test_xml_that_declares_an_entity_is_not_read():
    bomb = (b'<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]>'
            b'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&b;</t></si></sst>')
    sheet = b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'
    body = zipped({"xl/workbook.xml": b"<workbook/>", "xl/sharedStrings.xml": bomb, "xl/worksheets/sheet1.xml": sheet})
    assert "declares a document type or an entity; it was not read" in c30_problems(body)
    # However the bytes are encoded: the parser is asked, not the letters searched for.
    wide = bomb.decode().replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-16"?>').encode("utf-16")
    assert b"<!DOCTYPE" not in wide
    body = zipped({"xl/workbook.xml": b"<workbook/>", "xl/sharedStrings.xml": wide, "xl/worksheets/sheet1.xml": sheet})
    assert "declares a document type or an entity; it was not read" in c30_problems(body)
    body = zipped({"xl/workbook.xml": b"<workbook/>", "xl/sharedStrings.xml": b"<sst/>", "xl/worksheets/sheet1.xml": wide})
    assert "declares a document type or an entity; it was not read" in c30_problems(body)


@pytest.mark.parametrize("params, said", [
    ({"file": "../totsatime.xlsx"}, "its file is not the name of a workbook"),
    ({"series": []}, "it names no series"),
    ({"series": [TOTAL, TOTAL]}, "it names a series twice"),
    ({"title": ""}, "it does not pin the title and the line on units"),
])
def test_the_register_refuses_a_workbook_endpoint_it_cannot_read(params, said):
    entry = {"id": "census-c30", "adapter": "census_c30", "datasets": ["Value of Construction Put in Place"],
             "params": {"file": "totsatime.xlsx", "series": [TOTAL], "title": TITLE, "units": UNITS, **params}}
    with pytest.raises(RegisterError, match=said):
        endpoints_from_register(register(origin_row("census", "U.S. Census Bureau", [entry])))
