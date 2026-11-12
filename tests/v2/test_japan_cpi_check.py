"""`atlas crosscheck japan-cpi` (PLAN M14): does the IMF's all-items index for Japan say what the
Statistics Bureau of Japan's own file says, for the months research 02 compared? Every value
here is invented; the files have the two sources' real shapes."""
from __future__ import annotations

import json
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import pytest

from atlas.capture.cli import main as capture_main
from atlas.crosscheck import STATEMENT, main, read_estat_cpi
from atlas.rights import load_register

from .capture_helpers import ALLOW, Scripted
from .imf_helpers import body as imf_body

ROOT = Path(__file__).resolve().parents[2]
JPN = "JPN.CPI._T.IX.M"
IMF_URL = f"https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/CPI/+/{JPN}?dimensionAtObservation=TIME_PERIOD"
ESTAT_URL = "https://www.e-stat.go.jp/en/stat-search/file-download?statInfId=000032103842&fileKind=1"
MONTHS = [f"{2024 + (n + 8) // 12}-{(n + 8) % 12 + 1:02d}" for n in range(25)]  # 2024-09 to 2026-09


def index(month: str) -> str:
    """An invented index: 100 through 2020, then a tenth of a point a month."""
    year, number = int(month[:4]), int(month[5:])
    return f"{100 + max(0, (year - 2021) * 12 + number) * 0.1:.1f}"


def estat(values: dict[str, str] | None = None, *, codes=("0001", "0161"), encoding="shift_jis") -> bytes:
    """The Statistics Bureau's 2020-base file in small: two rows of names (the English one with
    quoted commas), the row of item codes, three more header rows, then a row a month."""
    values = values if values is not None else {m: index(m) for m in
                                                [f"{y}-{n:02d}" for y in range(2020, 2027) for n in range(1, 13)]
                                                if m <= "2026-09"}
    lines = ["類・品目,総合,生鮮食品を除く総合", 'Group/Item,All items,"All items, less fresh food"',
             f"類・品目符号(Group/Item code),{','.join(codes)}", "含類総連番(Serial number),001,733",
             "ウエイト(Weight),1000000000,900000000", "ウエイト１万分比(Weight per 10000),10000,9000"]
    lines += [f"{month.replace('-', '')},{value}," for month, value in values.items()]
    return ("\r\n".join(lines) + "\r\n").encode(encoding)


def imf(values: dict[str, str] | None = None, reference="2020A") -> bytes:
    values = values if values is not None else {m: index(m) for m in MONTHS}
    obs = [(month.replace("-", "-M"), value, "O") for month, value in values.items()]
    return imf_body({JPN: {"obs": obs, "reference": reference}})


def run(tmp_path, capsys, imf_bytes=None, estat_bytes=None):
    (tmp_path / "imf.json").write_bytes(imf_bytes if imf_bytes is not None else imf())
    (tmp_path / "estat.csv").write_bytes(estat_bytes if estat_bytes is not None else estat())
    code = main(["japan-cpi", "--imf", str(tmp_path / "imf.json"), "--estat", str(tmp_path / "estat.csv")])
    return code, capsys.readouterr().out


def test_the_statement_names_the_25_months_research_02_compared():
    statement = json.loads(STATEMENT.read_text())
    assert (statement["first"], statement["last"], statement["decimals"]) == ("2024-09", "2026-09", 1)
    assert statement["imf"] == {"agency": "IMF.STA", "flow": "CPI", "series": JPN, "reference": "2020A"}
    assert statement["estat"]["item"] == "0001" and statement["estat"]["base_year"] == 2020
    assert statement["estat"]["url"] == ESTAT_URL
    # The series the Catalog binds jp_cpi to, on the base the register pins.
    entry = json.loads((ROOT / "catalog" / "series" / "jp_cpi.json").read_text())
    assert entry["source"]["origin"]["origin_id"] == JPN and entry["base_period"] == "2020"


def test_the_bureaus_file_is_read_by_its_item_code():
    values = read_estat_cpi(estat())
    assert values["2026-09"] == index("2026-09") and next(iter(values)) == "2020-01" and len(values) == 81


@pytest.mark.parametrize("body, said", [
    (estat(codes=("0002", "0161")), "it has no column for item 0001"),
    ("Group/Item,All items\r\n202609,101.5\r\n".encode("shift_jis"), "it has no row of item codes"),
    (estat({"2026-08": "101.3", "2026-09": "n/a"}), "its value for 2026-09 is not a number"),
    (estat() + b"202609,1.0,\r\n", "it gives 2026-09 twice"),
    # A month listed first with no value and then with one is listed twice all the same.
    (estat({"2026-08": "101.3", "2026-09": ""}) + b"202609,101.5,\r\n", "it gives 2026-09 twice"),
    (b"\x81\x00\xff\xfe", "it is not Shift-JIS text"),
    (estat() + b"notes,x,\r\n", "it has a row that is not a month"),
])
def test_a_file_that_is_not_the_bureaus_shape_is_not_read(body, said):
    with pytest.raises(ValueError, match=said):
        read_estat_cpi(body)


def test_equal_in_all_25_months_is_a_match(tmp_path, capsys):
    code, out = run(tmp_path, capsys)
    assert code == 0, out
    assert "2024-09 to 2026-09: 25 of 25 months equal at 1 decimal" in out
    assert out.rstrip().endswith("check: matches")
    assert "2020 = 100" in out and "reference period 2020A" in out


def test_the_funds_longer_figure_is_rounded_to_the_bureaus_decimals_half_up(tmp_path, capsys):
    values = {m: index(m) for m in MONTHS}
    values["2025-03"] = f"{values['2025-03']}4999"
    values["2025-04"] = str(float(values["2025-04"]) - 0.05)[:6]  # x.x5 below: rounds up to the Bureau's
    code, out = run(tmp_path, capsys, imf_bytes=imf(values))
    assert code == 0, out


def test_one_month_that_differs_fails_and_is_named(tmp_path, capsys):
    values = {m: index(m) for m in MONTHS}
    values["2025-06"] = "999.9"
    code, out = run(tmp_path, capsys, imf_bytes=imf(values))
    assert code == 1
    assert f"DIFFERENT 2025-06: the Fund 999.9, the Bureau {index('2025-06')}" in out
    assert "24 of 25 months equal" in out and out.rstrip().endswith("check: FAILED")


def test_a_month_one_side_does_not_hold_is_not_a_match(tmp_path, capsys):
    values = {m: index(m) for m in MONTHS if m != "2026-09"}
    code, out = run(tmp_path, capsys, imf_bytes=imf(values))
    assert code == 1 and "MISSING 2026-09: the Fund has no value" in out
    held = {m: v for m, v in read_estat_cpi(estat()).items() if m != "2024-12"}
    code, out = run(tmp_path, capsys, estat_bytes=estat(held))
    assert code == 1 and "MISSING 2024-12: the Bureau has no value" in out


def test_a_rebased_file_is_not_compared_as_if_nothing_had_changed(tmp_path, capsys):
    # The Bureau rebases every five years. A file whose 2020 average is not 100 is on another base.
    rebased = {m: f"{float(v) * 0.9:.1f}" for m, v in read_estat_cpi(estat()).items()}
    code, out = run(tmp_path, capsys, estat_bytes=estat(rebased))
    assert code == 1 and "the Bureau's file averages 90.0 over 2020, not 100: it is not on the 2020 base" in out
    # And the Fund's side: the reference period it labels the index with.
    code, out = run(tmp_path, capsys, imf_bytes=imf(reference="2025A"))
    assert code == 1 and "is on the reference period '2025A'; '2020A' was expected" in out


def test_live_asks_each_source_once_and_keeps_nothing(tmp_path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    transport = Scripted({IMF_URL: [(200, imf())], ESTAT_URL: [(200, estat())]})
    code = main(["japan-cpi", "--live"], transport=transport, sleep=lambda seconds: None)
    out = capsys.readouterr().out
    assert code == 0, out
    assert [(r.method, r.url) for r in transport.sent] == [("GET", IMF_URL), ("GET", ESTAT_URL)]
    assert "retrieved 2026-11-11T15:50:01Z" in out and "retrieved 2026-11-11T15:50:02Z" in out
    assert "Nothing was kept." in out
    assert list(tmp_path.iterdir()) == []


def test_live_reports_a_source_that_does_not_answer(tmp_path, capsys):
    transport = Scripted({IMF_URL: [(200, imf())], ESTAT_URL: [(404, "gone")]})
    code = main(["japan-cpi", "--live"], transport=transport, sleep=lambda seconds: None)
    assert code == 1 and "HTTP 404" in capsys.readouterr().out


def test_a_capture_store_is_read_through_the_adapter_that_wrote_it(tmp_path, capsys):
    # The committed fixtures, captured under a register signed for this test only. Their values
    # are invented, so they are compared with an invented file of the Bureau's that agrees.
    table = load_register()
    next(row for row in table["rows"] if row["id"] == "imf")["decision"] = dict(ALLOW)
    (tmp_path / "register.json").write_text(json.dumps(table))
    assert capture_main(["--store", str(tmp_path / "store"), "--register", str(tmp_path / "register.json"),
                         "--replay", str(ROOT / "fixtures" / "capture"), "--only", "imf-cpi-g20"]) == 0
    capsys.readouterr()
    fixture = json.loads((ROOT / "fixtures/capture/imf/imf-cpi-g20/part-1.json").read_text())["data"]
    structure = fixture["structures"][0]
    at = [v["id"] for v in structure["dimensions"]["series"][0]["values"]].index("JPN")
    times = [v["value"] for v in structure["dimensions"]["observation"][0]["values"]]
    held = {times[int(i)].replace("-M", "-"): str(Decimal(cell[0]).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
            for i, cell in fixture["dataSets"][0]["series"][f"{at}:0:0:0:0"]["observations"].items() if cell[0]}
    bureau = {**{f"2020-{n:02d}": "100.0" for n in range(1, 13)}, **held}
    (tmp_path / "estat.csv").write_bytes(estat(bureau))
    statement = json.loads(STATEMENT.read_text())
    statement.update(first="2024-09", last="2026-09")
    (tmp_path / "statement.json").write_text(json.dumps(statement))
    code = main(["japan-cpi", "--store", str(tmp_path / "store"), "--estat", str(tmp_path / "estat.csv"),
                 "--statement", str(tmp_path / "statement.json")])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "capture " in out and "imf-cpi-g20" in out and "25 of 25 months equal" in out


def test_it_is_a_command_of_atlas(tmp_path, capsys):
    from atlas.cli import main as atlas_main

    (tmp_path / "imf.json").write_bytes(imf())
    (tmp_path / "estat.csv").write_bytes(estat())
    assert atlas_main(["crosscheck", "japan-cpi", "--imf", str(tmp_path / "imf.json"),
                       "--estat", str(tmp_path / "estat.csv")]) == 0
    assert "check: matches" in capsys.readouterr().out
