"""Census files in the shapes the Bureau served on 2026-11-11, built from plain descriptions: a
flat file of the Economic Indicators (a zip holding ``{PROGRAM}-mf.csv``) and a workbook of
construction spending (``totsatime.xlsx``). Every value a test puts in is invented."""
from __future__ import annotations

import io
import zipfile
from xml.sax.saxutils import escape

FLAT_URL = "https://www.census.gov/econ_getzippedfile/?programCode="
C30_URL = "https://www.census.gov/construction/c30/xlsx/"
STAMP = (2026, 11, 2, 9, 0, 20)  # every member of an invented zip is dated the same, so its bytes never change
TITLE = "Value of Construction Put in Place - Seasonally Adjusted Annual Rate"
UNITS = "(Millions of dollars. Details may not add to totals due to rounding.)"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def zipped(members: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(zipfile.ZipInfo(name, STAMP), data)
    return out.getvalue()


def flat_csv(*, categories, data_types, geos=(("US", "U.S. Total"),), periods, rows, errors=(("E_SM", "CV", "PCT"),),
             updated="Thursday, 15-Oct-26 07:31:23 EDT", notes=('"An invented note."',)) -> str:
    """The text of a flat file. ``categories``: (code, description); ``data_types``: (code,
    description, unit); ``periods``: names such as ``Jan-1992``; ``rows``: (period name,
    category code, data type code, geo code, adjusted, value) or, with ``error=code`` as a
    seventh item, a row of sampling error. The Bureau ends a line with CR LF and parts two
    sections with a line feed on its own; so does this."""
    index = {name: {code: str(n) for n, (code, *_) in enumerate(listed, start=1)}
             for name, listed in (("cat", categories), ("dt", data_types), ("geo", geos), ("et", errors))}
    per = {name: str(n) for n, name in enumerate(periods, start=1)}
    sections = [
        ["CATEGORIES", "cat_idx,cat_code,cat_desc,cat_indent",
         *(f'{n},{code},"{text}",0' for n, (code, text) in enumerate(categories, start=1))],
        ["DATA TYPES", "dt_idx,dt_code,dt_desc,dt_unit",
         *(f'{n},{code},"{text}",{unit}' for n, (code, text, unit) in enumerate(data_types, start=1))],
    ]
    if errors:
        sections.append(["ERROR TYPES", "et_idx,err_code,err_desc,err_unit",
                         *(f'{n},{code},"{text}",{unit}' for n, (code, text, unit) in enumerate(errors, start=1))])
    sections += [
        ["GEO LEVELS", "geo_idx,geo_code,geo_desc",
         *(f'{n},{code},"{text}"' for n, (code, text) in enumerate(geos, start=1))],
        ["TIME PERIODS", "per_idx,per_name", *(f"{n},{name}" for name, n in per.items())],
        ["NOTES", *notes],
        ["DATA UPDATED ON", updated],
    ]
    data = ["DATA", "per_idx,cat_idx,dt_idx,et_idx,geo_idx,is_adj,val" if errors
            else "per_idx,cat_idx,dt_idx,geo_idx,is_adj,val"]
    for period, category, data_type, geo, adjusted, value, *error in rows:
        cells = [per[period], index["cat"][category], "0" if error else index["dt"][data_type]]
        if errors:
            cells.append(index["et"][error[0]] if error else "0")
        cells += [index["geo"][geo], "1" if adjusted else "0", value]
        data.append(",".join(cells))
    sections.append(data)
    return "\r\n\n\n".join("\r\n".join(section) for section in sections) + "\r\n"


def flat(program: str, **described) -> bytes:
    """The zip the Bureau serves for one program: the flat file and a README."""
    return zipped({f"{program}-mf.csv": flat_csv(**described).encode(),
                   "/README": b"Economic Measures Time Series Dataset (invented)\n"})


def _column(n: int) -> str:
    name = ""
    while n:
        n, rest = divmod(n - 1, 26)
        name = chr(65 + rest) + name
    return name


def workbook(rows: list[list], *, extra: dict[str, bytes] | None = None) -> bytes:
    """An .xlsx with one sheet. A cell that is ``str`` is a shared string; an ``int`` or
    ``float`` or a ``("n", text)`` pair is a number printed as given; None is an empty cell."""
    strings: list[str] = []

    def cell(reference: str, value) -> str:
        if value is None:
            return f'<c r="{reference}" s="4"/>'
        if isinstance(value, str):
            if value not in strings:
                strings.append(value)
            return f'<c r="{reference}" s="1" t="s"><v>{strings.index(value)}</v></c>'
        text = value[1] if isinstance(value, tuple) else str(value)
        return f'<c r="{reference}" s="4"><v>{text}</v></c>'

    body = "".join(
        f'<row r="{r}">' + "".join(cell(f"{_column(c)}{r}", value) for c, value in enumerate(row, start=1)) + "</row>"
        for r, row in enumerate(rows, start=1))
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    sheet = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="{main}">'
             f"<sheetData>{body}</sheetData></worksheet>")
    shared = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="{main}" '
              f'count="{len(strings)}" uniqueCount="{len(strings)}">'
              + "".join(f'<si><t xml:space="preserve">{escape(text)}</t></si>' for text in strings) + "</sst>")
    book = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="{main}">'
            '<sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>')
    return zipped({"[Content_Types].xml": b"<Types/>", "xl/workbook.xml": book.encode(),
                   "xl/worksheets/sheet1.xml": sheet.encode(), "xl/sharedStrings.xml": shared.encode(),
                   **(extra or {})})


def c30(months: list[tuple[str, list]], *, headers=("Total\r\n_x000D_Construction", "Total\r\n_x000D_Residential",
                                                     "Total\r\n_x000D_Private Construction2"),
        title=TITLE, units=UNITS, after=("p Preliminary", "r Revised")) -> bytes:
    """The construction workbook: a title, a note on units, a header row, one row a month with
    the newest first (``("Sep-26p", [values...])``), and the lines the Bureau prints under the
    table."""
    rows = [[title], [units], [None], ["Date", *headers]]
    rows += [[name, *values] for name, values in months]
    rows += [[None], *([line] for line in after)]
    return workbook(rows)
