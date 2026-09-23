"""Assemble data/atlas.json and render dist/index.html (SPEC section 7)."""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader

from . import sources
from .transform import assemble, expand_approval

log = logging.getLogger("atlas.build")

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "atlas"
WEB = ROOT / "web"
DATA_JSON = ROOT / "data" / "atlas.json"
DIST = ROOT / "dist" / "index.html"
MAX_BYTES = 2 * 1024 * 1024
PLACEHOLDERS = ("__DATA__", "__EVENTS__", "__PRES__", "__BANDS__", "__BUILT__")


def load_yaml(name: str):
    return yaml.safe_load((PKG / name).read_text())


def load_catalog(include_disabled: bool = False) -> list[dict]:
    """Catalog entries; `enabled: false` ones (e.g. waiting on a blocked source) are skipped."""
    return [e for e in load_yaml("catalog.yaml") if include_disabled or e.get("enabled", True)]


def load_events() -> list[dict]:
    return load_yaml("events.yaml")


def load_approval() -> dict:
    return load_yaml("approval.yaml")


def load_politics() -> dict:
    return load_yaml("politics.yaml")


ELECTION_SERIES = {
    "president": ("pres_margin", "Presidential popular vote margin (D−R)"),
    "house": ("house_margin", "House popular vote margin (D−R)"),
}


def with_politics(data: dict, politics: dict) -> dict:
    """Inject election-margin series (SPEC 10.3): two-party margin on each election's November."""
    for kind, (key, name) in ELECTION_SERIES.items():
        rows = sorted((int(y), dr) for y, dr in politics["elections"][kind].items())
        s = {"d": [f"{y}-11" for y, _ in rows], "v": [round((d - r) / (d + r) * 100, 2) for _, (d, r) in rows]}
        data["series"][key] = s
        data["meta"][key] = {
            "name": name, "cat": "Politics & sentiment", "unit": "pp", "src": "Wikipedia election infoboxes",
            "note": "Two-party share, D minus R; positive = Democratic; holds until the next election",
            "freq": "E", "last_obs": s["d"][-1],
        }
    return data


def fetch_all(catalog: list[dict], force: bool = False, cache_only: bool = False, use_seed: bool = True):
    """Fetch every catalog entry; fail soft. Returns (raw, failures, seeded).

    A failed series falls back to data/seed/<key>.json when present (recorded in `seeded`)."""
    raw, failures, seeded = {}, {}, {}
    for e in catalog:
        if e["source"] == "derived":
            continue  # computed in transform.assemble from other series
        try:
            if cache_only and not any(sources.cache_path(e["key"], x).exists() for x in ("csv", "json")):
                raise sources.FetchError("not cached")
            raw[e["key"]] = sources.fetch(e, force=force)
        except Exception as ex:  # noqa: BLE001 - fail soft per SPEC 3.1
            fb = e.get("fallback")
            if fb:
                try:
                    alt = dict(e, key=e["key"] + "__fallback", **fb)
                    raw[e["key"]] = sources.fetch(alt, force=force)
                    seeded[e["key"]] = f"fallback {fb['source']} {fb['id']} (primary failed: {ex})"
                    log.warning("fetch failed: %s: %s — using fallback %s %s", e["key"], ex, fb["source"], fb["id"])
                    continue
                except Exception as ex2:  # noqa: BLE001
                    ex = f"{ex}; fallback: {ex2}"
            seed = sources.load_seed(e["key"]) if use_seed else None
            if seed:
                raw[e["key"]], seeded[e["key"]] = seed
                log.warning("fetch failed: %s (%s %s): %s — using seed data", e["key"], e["source"], e["id"], ex)
            else:
                failures[e["key"]] = str(ex)
                log.warning("fetch failed: %s (%s %s): %s", e["key"], e["source"], e["id"], ex)
    return raw, failures, seeded


def build_dataset(catalog: list[dict], raw: dict, seeded: dict | None = None) -> dict:
    data = assemble(catalog, raw, seeded or {})
    DATA_JSON.parent.mkdir(parents=True, exist_ok=True)
    DATA_JSON.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    return data


def with_approval(data: dict, approval: dict) -> dict:
    """Inject the hand-entered approval series (SPEC 4.3 / 7.2)."""
    data = dict(data, series=dict(data["series"]), meta=dict(data["meta"]))
    s = expand_approval(approval["approval"], data["first_month"])
    data["series"]["approval"] = s
    data["meta"]["approval"] = {
        "name": "Presidential approval (Gallup, approx.)", "cat": "Politics & sentiment", "unit": "%",
        "src": "Gallup (hand-entered)", "note": "Approximate quarterly averages", "freq": "Q*",
        "last_obs": s["d"][-1],
    }
    data["last_month"] = max(data["last_month"], s["d"][-1])
    return data


def _js(obj) -> str:
    """JSON safe for inlining inside <script>."""
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/").replace("\u2028", "\\u2028")


def render(data: dict, events: list[dict], terms: list, built: str | None = None, bands: dict | None = None) -> str:
    env = Environment(loader=FileSystemLoader(str(WEB)), autoescape=False)
    tpl = env.get_template("template.html")
    html = tpl.render(styles=(WEB / "styles.css").read_text(), stats=(WEB / "stats.js").read_text(),
                     app=(WEB / "app.js").read_text())
    built = built or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ev = [{k: e[k] for k in ("month", "title", "cat", "day", "url") if k in e} for e in events]
    for ph, val in (("__DATA__", _js(data)), ("__EVENTS__", _js(ev)), ("__PRES__", _js(terms)),
                     ("__BANDS__", _js(bands or {})), ("__BUILT__", _js(built))):
        if ph not in html:
            raise RuntimeError(f"template missing placeholder {ph}")
        html = html.replace(ph, val)
    return html


def extract_inline_script(html: str) -> str:
    blocks = re.findall(r"<script>(.*?)</script>", html, flags=re.S)
    return "\n;\n".join(blocks)


def js_syntax_check(src: str) -> None:
    node = shutil.which("node")
    if not node:
        log.warning("node not found; skipping JS syntax check")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(src)
    r = subprocess.run([node, "--check", f.name], capture_output=True, text=True)
    Path(f.name).unlink(missing_ok=True)
    if r.returncode != 0:
        raise RuntimeError("JS syntax error:\n" + r.stderr)


def write_dist(html: str) -> int:
    size = len(html.encode())
    if size >= MAX_BYTES:
        raise RuntimeError(f"dist/index.html is {size} bytes (limit {MAX_BYTES})")
    js_syntax_check(extract_inline_script(html))
    DIST.parent.mkdir(parents=True, exist_ok=True)
    DIST.write_text(html)
    return size


def build(force: bool = False, cache_only: bool = False) -> dict:
    from .check import run_checks

    catalog, events, approval, politics = load_catalog(), load_events(), load_approval(), load_politics()
    raw, failures, seeded = fetch_all(catalog, force=force, cache_only=cache_only)
    data = build_dataset(catalog, raw, seeded)
    full = with_politics(with_approval(data, approval), politics)
    errors, warnings = run_checks(full, catalog, events)
    html = render(full, events, approval["terms"], bands=politics["bands"])
    size = write_dist(html)
    summary = {
        "series": len(full["series"]), "first_month": full["first_month"], "last_month": full["last_month"],
        "events": len(events), "bytes": size, "failed": sorted(failures), "seeded": sorted(seeded), "check_errors": len(errors),
        "check_warnings": len(warnings),
    }
    print(f"Built {DIST.relative_to(ROOT)}: {summary['series']} series, "
          f"{summary['first_month']} → {summary['last_month']}, {summary['events']} events, "
          f"{size / 1024:.0f} KB")
    if failures:
        print(f"  {len(failures)} series failed to fetch (omitted): {', '.join(sorted(failures))}")
    if seeded:
        print(f"  {len(seeded)} series used committed seed data (live fetch failed): {', '.join(sorted(seeded))}")
    if errors or warnings:
        print(f"  check: {len(errors)} errors, {len(warnings)} warnings (run `make check` for details)")
    return summary
