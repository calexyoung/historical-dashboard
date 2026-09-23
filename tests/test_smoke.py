"""Headless-browser smoke test of dist/index.html (SPEC 9, 11). Needs network for the Chart.js CDN.

Run with `make smoke` (or `pytest tests/test_smoke.py`). Screenshots go to tests/snapshots/.
"""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "index.html"
SNAP = ROOT / "tests" / "snapshots"

pw = pytest.importorskip("playwright.sync_api")
pytestmark = [pytest.mark.skipif(not DIST.exists(), reason="run `make build` first"), pytest.mark.smoke]


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # browser not installed
            pytest.skip(f"chromium unavailable: {e}")
        yield b
        b.close()


def open_page(browser, w, h, errors, scheme="light", hash_=""):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    page.goto(DIST.as_uri() + hash_)
    page.wait_for_function("window.Chart && document.querySelectorAll('.opt').length > 0")
    return page


def chart_state(page):
    return page.evaluate("""() => { const c = Chart.getChart('main');
      return { n: c.data.datasets.length, labels: c.data.labels.length,
               axes: Object.keys(c.options.scales), ids: c.data.datasets.map(d => d.yAxisID),
               nonNull: c.data.datasets.map(d => d.data.filter(v => v != null).length) }; }""")


def test_desktop(browser):
    errors = []
    page = open_page(browser, 1300, 900, errors)
    SNAP.mkdir(parents=True, exist_ok=True)

    # default view: four series, full range, recession shading & event ticks on
    st = chart_state(page)
    assert st["n"] == 4 and all(n > 0 for n in st["nonNull"])
    assert page.evaluate("S.sel.join(',')") == "spx,unrate,wti,cpi_yoy" and page.evaluate("S.mode") == "z"
    assert page.locator(".opt").count() >= 96
    assert page.locator("#matrix .cell").count() == 16
    assert page.is_checked("#shRec") and page.is_checked("#shEv")
    page.screenshot(path=str(SNAP / "desktop-default.png"), full_page=True)

    # all ten presets render
    chips = page.locator("#presets .chip")
    assert chips.count() == 11  # 10 from SPEC 6.3 + "2008 vs 2020" (SPEC 10.7)
    for i in range(10):
        chips.nth(i).click()
        st = chart_state(page)
        assert st["n"] >= 4, page.evaluate("S.sel")
        assert sum(st["nonNull"]) > 0
    page.screenshot(path=str(SNAP / "desktop-preset-oil-shock.png"))

    # five modes x 1, 2, 8 series
    for sel in (["spx"], ["spx", "unrate"], ["spx", "unrate", "wti", "cpi_yoy", "gdp", "income", "gold", "approval"]):
        page.evaluate(f"S.sel = {sel!r}; S.i0 = 0; S.i1 = MONTHS.length - 1; renderAll()")
        for mode in ("rebase", "z", "raw", "log", "yoy", "dd"):
            page.select_option("#mode", mode)
            st = chart_state(page)
            assert st["n"] == len(sel)
            assert all(n > 0 for n in st["nonNull"]), (mode, sel, st)

    # raw mode assigns axes by unit
    page.evaluate("S.sel = ['fedfunds','gs10','spx']; renderAll()")
    page.select_option("#mode", "raw")
    st = chart_state(page)
    assert st["ids"] == ["y", "y", "y2"] and "y2" in st["axes"]

    # 9th series is blocked with a toast, not alert()
    page.evaluate("S.sel = ['spx','nasdaq','dow','rut','vix','dax','ftse','stoxx']; renderAll()")
    page.on("dialog", lambda d: errors.append("alert() used"))
    page.fill("#search", "gold")  # auto-opens the matching group
    page.locator(".opt[data-k='gold'] input").click()  # blocked, so it must stay unchecked
    assert not page.is_checked(".opt[data-k='gold'] input")
    assert page.evaluate("S.sel.length") == 8 and page.locator("#toast.on").count() == 1
    page.fill("#search", "")

    # matrix and scatter agree at lag 0; basis switch changes both
    page.evaluate("S.sel = ['spx','unrate','wti']; S.lag = 0; S.sx = null; S.sy = null; renderAll()")
    page.locator("#matrix .cell[data-a='spx'][data-b='wti']").click()
    cell = page.locator("#matrix .cell[data-a='spx'][data-b='wti']").inner_text().replace("*", "")
    r_sc = page.locator("#rline b").inner_text()
    assert round(float(r_sc), 2) == float(cell)
    page.select_option("#basis", "lvl")
    cell2 = page.locator("#matrix .cell[data-a='spx'][data-b='wti']").inner_text().replace("*", "")
    r_sc2 = page.locator("#rline b").inner_text()
    assert cell2 != cell and r_sc2 != r_sc and round(float(r_sc2), 2) == float(cell2)
    assert page.evaluate("Chart.getChart('lagChart').data.datasets[0].data.length") == 49

    # click an event → highlight in list & chart state
    page.locator("#evList .ev").first.click()
    assert page.evaluate("S.hi") is not None and page.locator("#evList .ev.on").count() == 1

    # state lands in the URL hash; reload restores it
    page.evaluate("S.sel = ['gold','btc']; S.mode = 'log'; renderAll()")
    h = page.evaluate("location.hash")
    assert "sel=gold%2Cbtc" in h and "mode=log" in h
    page.reload()
    page.wait_for_function("window.Chart && Chart.getChart('main')")
    assert page.evaluate("S.sel.join(',')") == "gold,btc" and page.evaluate("S.mode") == "log"
    assert page.input_value("#basis") == page.evaluate("S.basis") == "lvl"  # controls reflect restored state
    assert page.input_value("#mode") == "log"

    # SPEC 10.7: compare two ranges, drawdown, max/min, rolling correlation
    chips.nth(10).click()
    st = chart_state(page)
    assert st["n"] == 6 and page.evaluate("S.cmp") is not None  # 3 series x 2 ranges
    assert all(n > 0 for n in st["nonNull"])
    page.check("#shExt")
    page.locator("#mainCard").screenshot(path=str(SNAP / "desktop-compare-2008-2020.png"))
    page.select_option("#cmp", "")
    page.select_option("#mode", "dd")
    dd = page.evaluate("Chart.getChart('main').data.datasets[0].data.filter(v => v != null)")
    assert max(dd) == 0 and min(dd) < -40  # S&P drawdown in 2007–10 exceeds 40%
    page.uncheck("#shExt")
    page.evaluate("S.sel = ['spx','unrate']; S.i0 = 0; S.i1 = MONTHS.length - 1; renderAll()")
    rc = page.evaluate("Chart.getChart('rollChart').data.datasets[0].data.filter(v => v != null).length")
    assert rc > 250
    page.select_option("#roll", "24")
    assert "roll=24" in page.evaluate("location.hash")

    # SPEC 10.8: PNG export, full-dataset CSV
    assert page.evaluate("chartPng()").startswith("data:image/png;base64,")
    with page.expect_download() as dl:
        page.click("#allBtn")
    head = open(dl.value.path()).read().splitlines()
    assert head[0].startswith('"month","') and len(head) == 4 + page.evaluate("MONTHS.length")
    assert len(head[0].split(",")) == 1 + page.evaluate("Object.keys(DB.series).length")

    # political bands + election-margin series (SPEC 10.3)
    assert page.locator("#bands option").count() == 7
    page.evaluate("S.sel = ['pres_margin','house_margin','approval']; S.mode = 'raw'; S.i0 = MI['2009-01']; S.i1 = MI['2012-12']; renderAll()")
    page.select_option("#bands", "house")
    st = chart_state(page)
    assert st["nonNull"][0] == st["labels"]  # 2008 result holds through the range start
    assert "bands=house" in page.evaluate("location.hash")
    page.evaluate("S.i0 = 0; S.i1 = MONTHS.length - 1; renderAll()")
    page.locator("#mainCard").screenshot(path=str(SNAP / "desktop-politics.png"))
    page.select_option("#bands", "none")

    # theme toggle re-renders with dark tokens
    page.click("#themeBtn")
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    page.evaluate("S.sel = ['spx','unrate','wti','cpi_yoy']; S.mode = 'z'; S.i0 = 0; S.i1 = MONTHS.length - 1; S.hi = null; renderAll()")
    page.screenshot(path=str(SNAP / "desktop-dark.png"), full_page=True)
    page.click("#themeBtn")
    assert not errors, errors


def test_mobile(browser):
    errors = []
    page = open_page(browser, 390, 844, errors, hash_="#sel=spx,unrate,wti,cpi_yoy&mode=z")
    no_hscroll = "document.documentElement.scrollWidth <= window.innerWidth"
    assert page.evaluate(no_hscroll)
    assert page.evaluate("document.querySelector('.chart-wrap').getBoundingClientRect().height") == 340
    page.screenshot(path=str(SNAP / "mobile-default.png"), full_page=True)

    # bottom sheet opens and closes
    assert page.is_visible("#openRail")
    page.click("#openRail")
    page.wait_for_function("document.getElementById('rail').getBoundingClientRect().top < window.innerHeight * 0.5")
    page.screenshot(path=str(SNAP / "mobile-sheet.png"))
    page.fill("#search", "gold")
    page.locator(".opt[data-k='gold'] input").check()
    page.click("#closeRail")
    page.wait_for_function("document.getElementById('rail').getBoundingClientRect().top >= window.innerHeight - 1")
    assert "gold" in page.evaluate("S.sel")

    page.locator("#presets .chip").nth(6).click()  # 6 world markets
    assert page.evaluate(no_hscroll)
    page.screenshot(path=str(SNAP / "mobile-preset.png"), full_page=True)
    assert not errors, errors
