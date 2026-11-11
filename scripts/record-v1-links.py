"""Record what v1's own page does with its presets and with ten hash links (PLAN M4).

Run by hand, once, against v1's built page (dist/index.html, from `make build`):

    .venv/bin/python scripts/record-v1-links.py > checks/v1-links.json

It opens the page in a browser with the network cut off, lets v1's own `applyParams` and preset
buttons set v1's state, and writes down the selection, mode, range and layers v1 arrived at. The
Explorer's tests (site/src/lib/explorer) must arrive at the same from the same link. The output
holds series keys, months and event titles; no Observation value (PLAN 6.1).
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "dist" / "index.html").as_uri()

# Ten links in the form v1 wrote them (`#` + stateToParams()), chosen to cover every parameter
# v1 ever wrote, the fallbacks in applyParams, and the oldest form (shPres).
LINKS = [
    "sel=spx,unrate,wti,cpi_yoy&mode=z&from=2000-01&to=2026-10",
    "sel=spx,unrate,wti,umcsent,m2&mode=rebase&from=2019-06&to=2022-06",
    "sel=cpi_yoy,fedfunds,gas,wages_yoy,umcsent&mode=raw&from=2020-01&to=2026-10&ev=policy,financial",
    "sel=spx,dax,nikkei,shanghai,sensex,ftse&mode=log&from=2000-01&to=2026-10&shEv=0&bands=pres",
    "sel=gdp,unrate,approval,pres_margin&mode=yoy&from=2005-01&to=2020-12&shRec=0&bands=senate",
    "sel=spx,vix&mode=dd&from=2007-01&to=2013-12&hi=12&bands=fed_chair&ext=1",
    "sel=spx,unrate,wti&mode=rebase&from=2007-10&to=2010-10&cmp=2020-01",
    "sel=fedfunds,gs10&mode=raw&from=2010-01&to=2026-10&basis=lvl&lag=6&sx=fedfunds&sy=gs10&roll=24",
    "sel=spx,unrate&mode=z&from=2001-01&to=2012-12&shPres=1&ev=",
    "sel=wti,nosuchseries,gas,brent,natgas,spx,vix,unrate,gold,copper&mode=bogus&from=2024-01&to=2024-03",
]

READ = """() => ({
  sel: S.sel, mode: S.mode, from: MONTHS[S.i0], to: MONTHS[S.i1],
  recessions: document.getElementById('shRec').checked,
  events: document.getElementById('shEv').checked,
  event_categories: [...S.evcats].sort(),
  bands: document.getElementById('bands').value,
  highlighted_event: S.hi == null ? null : { month: EVENTS[S.hi].month, day: EVENTS[S.hi].day ?? null, title: EVENTS[S.hi].title },
  compare_from: S.cmp == null ? null : MONTHS[S.cmp],
  max_min: document.getElementById('shExt').checked,
  basis: S.basis, lag: S.lag, sx: S.sx, sy: S.sy, roll: S.roll,
})"""


def main() -> None:
    out = {
        "description": "What v1's own page (web/app.js) did with its 11 presets and with ten hash links, recorded by scripts/record-v1-links.py from dist/index.html. `to_is_last_month` says the range ran to the end of v1's axis, which is how a preset written with `lastM` behaves. Recorded, not derived: do not edit by hand.",
    }
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith("file:") else route.abort())

        page = context.new_page()
        page.goto(PAGE)
        out["v1_axis"] = page.evaluate("() => ({ first_month: MONTHS[0], last_month: lastM })")
        last = out["v1_axis"]["last_month"]
        presets = []
        for i, name in enumerate(page.evaluate("() => PRESETS.map(p => p[0])")):
            page.evaluate(f"() => {{ try {{ document.querySelectorAll('#presets .chip')[{i}].click(); }} catch (e) {{}} }}")
            state = page.evaluate(READ)
            presets.append({"name": name, "v1": {**{k: state[k] for k in ("sel", "mode", "from", "to", "compare_from")}, "to_is_last_month": state["to"] == last}})
        out["presets"] = presets
        page.close()

        links = []
        for link in LINKS:
            page = context.new_page()  # a fresh page: nothing carries over between links
            page.goto(PAGE + "#" + link)
            state = page.evaluate(READ)
            links.append({"hash": "#" + link, "v1": {**state, "to_is_last_month": state["to"] == last}})
            page.close()
        out["links"] = links
        browser.close()
    json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
