"""The legacy converter: v1's committed output as a local-profile Release (PLAN 4.2, M2, 6.1).

``legacy_release()`` reads v1's files where they are (``data/atlas.json``, the v1 catalog,
``events.yaml``, ``politics.yaml``, ``approval.yaml``) and writes one Release under
``$ATLAS_LOCAL``, through the same staging and promotion helper the release writer will use
(``atlas.staging``). It exists so the v2 site can be used on v1's data while the real sources are
built. What it does and does not carry over is written up in ``docs/method/legacy-release.md``.

The interim data rule (PLAN 6.1) shapes it:

- It writes the ``local`` Profile and nothing else. There is no parameter for another.
- It refuses a root that is, holds, or lies inside ``$ATLAS_PUBLIC`` or ``$ATLAS_STORE``.
- It fetches nothing and imports no network library. Nothing from it enters the store.
- Every Series is marked ``legacy_monthly_rounded`` and its Rights are recorded as not settled.

Hidden here: v1's ``atlas.json`` layout (month arrays on one monthly axis), which v1 series are
really quarterly, annual or per election, v1's channels and the lineage of its computed series.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import os
import re
import subprocess
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import yaml

from atlas.capture.store import StoreLocked, locked
from atlas.content.compile import ContentError, add_reading_files, compile_content
from atlas.period import next_period, period_bounds
from atlas.release import LEGACY, SCHEMA_VERSION
from atlas.staging import promote, stage

ROOT = Path(__file__).resolve().parents[1]

ATLAS_JSON = "data/atlas.json"
CATALOG_YAML = "atlas/catalog.yaml"
EVENTS_YAML = "atlas/events.yaml"
POLITICS_YAML = "atlas/politics.yaml"
APPROVAL_YAML = "atlas/approval.yaml"
#: v1's files the converter reads. Not ``atlas/events.yaml``: since M19 v1's Events are files
#: of their own (``content/events``) that the content compiler reads (ADR 0033).
INPUTS = (ATLAS_JSON, CATALOG_YAML, POLITICS_YAML, APPROVAL_YAML)
#: Where the Events are, relative to the repository; recorded among a Release's inputs.
CONTENT_EVENTS = "content/events"

SEMANTICS_VERSION = "v1-legacy"  # v1 computed what is in derived/; the v2 engine did not
NOT_RECORDED = "Not recorded by v1"


class LegacyRefused(Exception):
    """The converter will not run as asked, or v1's files are not what it understands."""


# --- v1's vocabulary, mapped once and explicitly. An unknown value stops the conversion. ---

# v1 `freq` is the source's cadence; atlas.json already holds W and D as monthly means or closes.
CADENCE = {"M": "monthly", "W": "monthly", "D": "monthly", "Q": "quarterly", "A": "annual"}
PERIODS_PER_YEAR = {"monthly": 12, "quarterly": 4, "annual": 1}

SEGMENT_OF_CATEGORY = {
    "US markets": "markets_money",
    "Commodities & energy": "markets_money",
    "Currencies": "markets_money",
    "Rates & money": "markets_money",
    "US economy": "economy_jobs",
    "Housing": "economy_jobs",
    "Global markets": "us_in_the_world",
    "Europe": "us_in_the_world",
    "Asia & other": "us_in_the_world",
    "Politics & sentiment": "governance_politics",
}

# Measure kind is v2's word; v1 has none. Decided here by unit, then by key where the unit does
# not settle it. A price or an exchange rate is a rate: it is averaged, never summed.
MEASURE_KIND_OF_KEY = {
    "gdp": "annualized",  # seasonally adjusted annual rate
    "profits": "annualized",
    "houst": "annualized",
    "m2": "stock",
    "fedassets": "stock",
    "ecb_assets": "stock",
    "debt": "stock",
    "credit": "stock",
    "payems": "stock",
    "trade": "flow",
    "retail": "flow",
    "claims": "flow",
    "ez_gdp": "flow",
    "cn_gdp": "flow",
    "usrec": "rate",  # a 0/1 indicator
    "life_exp": "rate",
    "births": "rate",
}
_PRICE_UNIT = re.compile(r"[$€£¥₹₺]|^(C|R|MX)\$")


def _measure_kind(key: str, unit: str) -> str:
    if key in MEASURE_KIND_OF_KEY:
        return MEASURE_KIND_OF_KEY[key]
    if unit.startswith("%") or unit == "pp":
        return "rate"
    if unit.startswith("index"):
        return "index"
    if _PRICE_UNIT.search(unit):
        return "rate"
    raise LegacyRefused(f"{key}: no measure kind is decided for v1 unit {unit!r} (atlas/legacy.py)")


def _unit_kind(unit: str) -> str:
    if unit == "pp":
        return "percentage_points"
    if unit.startswith("%"):
        return "percent"
    if unit.startswith("index"):
        return "index"
    if _PRICE_UNIT.search(unit):
        return "currency"
    if unit in ("thousands", "persons/week"):
        return "count"
    return "other"


def _slug(text: str, limit: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit].strip("-")


# --- periods ---------------------------------------------------------------------------------


def _period_of_month(key: str, freq: str, month: str) -> str:
    """v1 puts every value on a month. The Period it really describes, by the Series' cadence."""
    if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
        raise LegacyRefused(f"{key}: {month!r} is not a v1 month")
    year, m = month[:4], int(month[5:])
    if freq == "monthly":
        return month
    if freq == "quarterly":
        if m not in (1, 4, 7, 10):
            raise LegacyRefused(f"{key}: quarterly value on {month}, which does not start a quarter")
        return f"{year}-Q{(m - 1) // 3 + 1}"
    if m != 1:
        raise LegacyRefused(f"{key}: annual value on {month}, which is not a January")
    return year


def _observation(freq: str, period: str, value: float | None, status: str) -> dict:
    bounds = period_bounds(freq, period)
    if bounds is None:
        raise LegacyRefused(f"{period!r} is not a {freq} period")
    return {
        "period": period,
        "period_start": bounds[0],
        "period_end": bounds[1],
        "value": value,
        "status": status if value is not None else "missing",
    }


def _series_file(key: str, freq: str, values: dict[str, float | None], status: str = "final") -> dict:
    """A series file with every Period between the first and last present; a hole is explicit."""
    if not values:
        raise LegacyRefused(f"{key}: v1 holds no values")
    labels = list(values)
    if freq == "irregular":
        observations = [_observation(freq, p, values[p], status) for p in labels]
    else:
        observations, period, last = [], labels[0], labels[-1]
        while True:
            observations.append(_observation(freq, period, values.get(period), status))
            if period == last:
                break
            period = next_period(freq, period)
            if period is None or len(observations) > 100_000:
                raise LegacyRefused(f"{key}: v1's periods are not in order")
    return {
        "key": key,
        "freq": freq,
        "representation": LEGACY,
        "period_start": observations[0]["period_start"],
        "period_end": observations[-1]["period_end"],
        "observations": observations,
    }


def election_day(year: int) -> date:
    """The Tuesday after the first Monday of November: the day a federal general election is held."""
    first = date(year, 11, 1)
    first_monday = first + timedelta(days=(7 - first.weekday()) % 7)
    return first_monday + timedelta(days=1)


def _month_start(month: str) -> str:
    return f"{month}-01"


def _day_before_month(month: str) -> str:
    """The last day before ``month`` begins: v1's band ends are exclusive months."""
    return (date(int(month[:4]), int(month[5:7]), 1) - timedelta(days=1)).isoformat()


def _month_end(month: str) -> str:
    year, m = int(month[:4]), int(month[5:7])
    return date(year, m, calendar.monthrange(year, m)[1]).isoformat()


# --- sources and rights ------------------------------------------------------------------------


def _rights(owner: str) -> dict:
    """Not settled: nobody has read the terms for this Origin and Channel (PLAN M2, D2)."""
    return {"owner": owner, "terms_url": None, "status": "unknown", "attribution": None, "reviewed": None,
            "ml_use": False}  # not settled is no permission to call it usable for model training (ADR 0041)


def _source_of(key: str, meta: dict, catalog_entry: dict | None) -> dict:
    """Origin and Channel as v1 recorded them, read from atlas.json's own ``src`` label.

    The label, not the catalog, says what was actually used: when a direct source failed and v1
    fell back to FRED, the label names FRED. v1 never recorded the producing agency behind a FRED
    series or a Yahoo symbol, so that is said, not guessed.
    """
    label = meta["src"]
    head, _, origin_id = label.partition(" ")
    if head == "FRED":
        return {
            "origin": {
                "producer": NOT_RECORDED,
                "dataset": "FRED series",
                "origin_id": origin_id,
                "url": f"https://fred.stlouisfed.org/series/{origin_id}",
            },
            "channel": {"via": "fred"},
        }
    if head == "Yahoo":
        return {
            "origin": {
                "producer": NOT_RECORDED,
                "dataset": "Yahoo Finance symbol",
                "origin_id": origin_id,
                "url": None,
            },
            "channel": {"via": "yahoo"},
        }
    if head == "Computed:":
        return {
            "origin": {"producer": "Computed by v1", "dataset": "v1 computed series", "origin_id": origin_id, "url": None},
            "channel": {"via": "computed"},
        }
    csv = (catalog_entry or {}).get("csv")
    if csv and csv.get("src_name") == head:
        return {
            "origin": {"producer": head, "dataset": origin_id, "origin_id": origin_id, "url": csv.get("url")},
            "channel": {"via": "direct"},
        }
    raise LegacyRefused(f"{key}: v1 source label {label!r} is not one this converter understands")


HAND_ENTERED = {"via": "hand_entered"}


# --- the conversion ----------------------------------------------------------------------------


def _load(repo: Path) -> tuple[dict[str, bytes], dict, list, dict, dict]:
    raw: dict[str, bytes] = {}
    for path in INPUTS:
        try:
            raw[path] = (repo / path).read_bytes()
        except OSError as error:
            raise LegacyRefused(f"v1 input {path} cannot be read ({error.strerror})") from error
    data = json.loads(raw[ATLAS_JSON])
    catalog, politics, approval = (
        yaml.safe_load(raw[p].decode("utf-8")) for p in (CATALOG_YAML, POLITICS_YAML, APPROVAL_YAML)
    )
    return raw, data, catalog, politics, approval


def _base_entry(key: str, name: str, unit: str, category: str, freq: str, continuity: str = "discrete") -> dict:
    if category not in SEGMENT_OF_CATEGORY:
        raise LegacyRefused(f"{key}: no segment is decided for v1 category {category!r}")
    return {
        "key": key,
        "name": name,
        "unit": unit,
        "unit_kind": _unit_kind(unit),
        "measure_kind": _measure_kind(key, unit),
        "freq": freq,
        "continuity": continuity,
        "representation": LEGACY,
        "segment": SEGMENT_OF_CATEGORY[category],
        "topics": [_slug(category)],
    }


def _atlas_json_series(data: dict, catalog: list) -> tuple[list[dict], dict[str, dict]]:
    """The 123 series v1 keeps in atlas.json: catalog entries and series files."""
    by_key = {e["key"]: e for e in catalog}
    yoy_parent = {e["yoy_key"]: e for e in catalog if e.get("derive_yoy")}
    entries, files = [], {}
    for key, v1 in data["series"].items():
        meta = data["meta"][key]
        if meta["freq"] not in CADENCE:
            raise LegacyRefused(f"{key}: v1 frequency {meta['freq']!r} is not one this converter understands")
        freq = CADENCE[meta["freq"]]
        own, parent = by_key.get(key), yoy_parent.get(key)
        if parent is not None and meta.get("parent") != parent["key"]:
            raise LegacyRefused(f"{key}: atlas.json and the v1 catalog disagree about its parent")
        described = own or parent
        if described is None:
            raise LegacyRefused(f"{key} is in atlas.json but not in the v1 catalog")
        entry = _base_entry(key, meta["name"], meta["unit"], meta["cat"], freq)
        notes = [meta.get("note") or ""]
        if own and own.get("known_truncated"):
            notes.append(f"The source series ends early ({own['known_truncated']}).")
        if meta.get("seed"):
            notes.append(f"v1 could not fetch this series afresh and used: {meta['seed']}.")
        description = " ".join(n.rstrip(".") + "." for n in notes if n)
        if description:
            entry["description"] = description
        if own and own.get("agg") in ("mean", "last") and "derive" not in own:
            entry["agg"] = own["agg"]
        if described.get("max_lag_months"):
            entry["max_lag"] = f"P{int(described['max_lag_months'])}M"
        bounds = (own or {}).get("range") if own else parent.get("yoy_range")
        if bounds:
            entry["range"] = [float(bounds[0]), float(bounds[1])]
        entry["source"] = _source_of(key, meta, described)
        producer = entry["source"]["origin"]["producer"]
        entry["rights"] = _rights(NOT_RECORDED if producer == "Computed by v1" else producer)
        entry["status"] = "active"
        # Lineage of what v1 computed. The values are v1's own outputs, carried as they are.
        if parent is not None:
            entry["agg"] = "none"
            entry["recipe"] = {
                "op": "pct_change",
                "inputs": [parent["key"]],
                "order": "aggregate_then_compute",
                "params": {"lag": PERIODS_PER_YEAR[freq]},
            }
        elif own and "derive" in own:
            entry["agg"] = "none"
            entry["recipe"] = {"op": "ratio", "inputs": list(own["derive"]["div"]), "order": "aggregate_then_compute"}
        if len(v1["d"]) != len(v1["v"]):
            raise LegacyRefused(f"{key}: atlas.json has {len(v1['d'])} months and {len(v1['v'])} values")
        values: dict[str, float | None] = {}
        for month, value in zip(v1["d"], v1["v"], strict=True):
            period = _period_of_month(key, freq, month)
            if period in values:
                raise LegacyRefused(f"{key}: two v1 values fall in {period}")
            values[period] = value
        entries.append(entry)
        files[key] = _series_file(key, freq, values)
    return entries, files


def _hand_entered_series(politics: dict, approval: dict) -> tuple[list[dict], dict[str, dict]]:
    """The three series v1 adds at build time from hand-entered files, at their real cadence."""
    entries, files = [], {}

    # Presidential approval: entered per quarter. v1 repeated each quarter over its three months.
    values: dict[str, float | None] = {}
    for year in sorted(approval["approval"], key=int):
        for quarter, value in enumerate(approval["approval"][year]):
            values[f"{int(year):04d}-Q{quarter + 1}"] = None if value is None else float(value)
    while values and values[next(reversed(values))] is None:  # quarters not yet entered
        values.popitem()
    entry = _base_entry("approval", "Presidential approval (Gallup, approx.)", "%", "Politics & sentiment", "quarterly")
    entry["description"] = "Approximate quarterly averages, entered by hand."
    entry["source"] = {
        "origin": {"producer": "Gallup", "dataset": "Presidential approval, quarterly averages", "origin_id": None, "url": None},
        "channel": dict(HAND_ENTERED),
    }
    entry["rights"] = _rights("Gallup")
    entry["status"] = "active"
    entries.append(entry)
    files["approval"] = _series_file("approval", "quarterly", values, status="estimate")

    # Election margins: v1's own formula on the votes it records, one Observation per election.
    names = {
        "president": ("pres_margin", "Presidential popular vote margin (D−R)"),
        "house": ("house_margin", "House popular vote margin (D−R)"),
    }
    for kind, (key, name) in names.items():
        results = {}
        for year, (dem, rep) in sorted(politics["elections"][kind].items()):
            results[election_day(int(year)).isoformat()] = round((dem - rep) / (dem + rep) * 100, 2)
        entry = _base_entry(key, name, "pp", "Politics & sentiment", "irregular", continuity="held")
        entry["description"] = (
            "Two-party share, Democratic minus Republican; positive means Democratic. "
            "Each result stands until the next election."
        )
        entry["source"] = {
            "origin": {
                "producer": "Wikipedia election infoboxes",
                "dataset": f"United States {kind} elections, popular vote",
                "origin_id": None,
                "url": None,
            },
            "channel": dict(HAND_ENTERED),
        }
        entry["rights"] = _rights("Wikipedia")
        entry["status"] = "active"
        entries.append(entry)
        files[key] = _series_file(key, "irregular", results)
    return entries, files


def _v1(dataset: str, via: str = "hand_entered") -> dict:
    """Where one of v1's own Annotations came from. It is marked as the legacy representation,
    which no public-profile Release may hold (schema/README.md)."""
    return {"producer": "Macro Atlas v1", "dataset": dataset, "via": via, "representation": LEGACY}


def _annotations(data: dict, politics: dict, approval: dict) -> list[dict]:
    """v1's bands and recessions as Annotations. Its Events are not here: they are files
    (``content/events``), and the content compiler projects them (M19)."""
    out: list[dict] = []
    seen: set[str] = set()

    def unique(identifier: str) -> str:
        candidate, n = identifier, 1
        while candidate in seen:
            n += 1
            candidate = f"{identifier}-{n}"
        seen.add(candidate)
        return candidate

    # Terms of government and office holders. v1 keeps these to the month, end month exclusive.
    sets = {"pres": {"source": None, "rows": approval["terms"]}, **politics["bands"]}
    for name, band in sets.items():
        for start, end, label, style in band["rows"]:
            attributes = {"party": style} if style in ("D", "R") else {}
            out.append(
                {
                    "id": unique(f"governance-{name}-{start}"),
                    "kind": "governance",
                    "anchor": {"type": "span", "start": _month_start(start), "end": _day_before_month(end)},
                    "label": label,
                    "ref": None,
                    "source": {"url": band["source"]} if band.get("source") else None,
                    "category": name,
                    "attributes": {**attributes, "date_precision": "month"},
                    "provenance": _v1(f"{APPROVAL_YAML} terms" if name == "pres" else f"{POLITICS_YAML} bands.{name}"),
                }
            )

    # Recessions: runs of months where v1's 0/1 recession series is 1.
    usrec = data["series"].get("usrec")
    if usrec:
        run: list[str] = []
        runs: list[list[str]] = []
        previous = None
        for month, value in zip(usrec["d"], usrec["v"], strict=True):
            adjacent = previous is not None and next_period("monthly", previous) == month
            if value == 1 and run and adjacent:
                run.append(month)
            elif value == 1:
                if run:
                    runs.append(run)
                run = [month]
            elif run:
                runs.append(run)
                run = []
            previous = month
        if run:
            runs.append(run)
        for months in runs:
            out.append(
                {
                    "id": unique(f"recession-{months[0]}"),
                    "kind": "recession",
                    "anchor": {"type": "span", "start": _month_start(months[0]), "end": _month_end(months[-1])},
                    "label": "US recession (NBER)",
                    "ref": None,
                    "source": {"name": "v1 series usrec (FRED USREC)", "url": "https://fred.stlouisfed.org/series/USREC"},
                    "attributes": {"date_precision": "month"},
                    "provenance": _v1("usrec (FRED USREC)", "fred"),
                }
            )
    return out


def _dump(document) -> bytes:
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _commit_of(repo: Path, path: str) -> str | None:
    """The commit whose copy of ``path`` was read, or None if that cannot be said (the working
    copy differs from it, or this is not a git checkout)."""
    def git(*args: str) -> str | None:
        try:
            done = subprocess.run(
                ["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=20, check=False
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return done.stdout if done.returncode == 0 else None

    status = git("status", "--porcelain", "--", path)
    if status is None or status.strip():
        return None
    head = (git("rev-parse", "HEAD") or "").strip()
    return head if re.fullmatch(r"[0-9a-f]{40}", head) else None


def _as_utc(moment: datetime | None) -> datetime:
    moment = moment or datetime.now(UTC)
    if moment.tzinfo is None:
        raise LegacyRefused("the conversion time must carry a time zone")
    return moment.astimezone(UTC).replace(microsecond=0)


# The engine's Transforms, in its order (packages/core/src/transform.ts).
TRANSFORMS = ("lin", "chg", "ch1", "pch", "pc1", "pca", "log", "rebase", "z", "drawdown")
#: Those that divide by one of the Series' own values, or take its logarithm.
RATIO_TRANSFORMS = frozenset({"pch", "pc1", "pca", "log", "rebase", "drawdown"})
#: Those that need a year made of a fixed number of Periods.
YEARLY_TRANSFORMS = frozenset({"ch1", "pc1", "pca"})


def offered_transforms(entry: dict, series_file: dict) -> list[str]:
    """Which Transforms a Series offers (docs/method/transforms.md).

    Those that divide by one of the Series' own values, or take its logarithm, read the right
    way only on a Series that stays above zero: a percent change from a negative value has the
    wrong sign, and an index on a base the Series later crosses means nothing. v1 offered all
    of its six for everything. An irregular Series has no Observation one year earlier and no
    fixed number of Periods in a year. The differences (``chg``, ``ch1``) are in the Series'
    own unit and mislead on no sign.
    """
    observed = [o["value"] for o in series_file["observations"] if o["value"] is not None]
    positive = bool(observed) and min(observed) > 0
    offered = []
    for name in TRANSFORMS:
        if name in RATIO_TRANSFORMS and not positive:
            continue
        if name in YEARLY_TRANSFORMS and entry["freq"] == "irregular":
            continue
        offered.append(name)
    return offered


def build_release(repo: Path = ROOT, now: datetime | None = None) -> tuple[str, dict[str, bytes]]:
    """The Release's id and files, in memory. Reads v1's files; writes nothing."""
    repo = Path(repo)
    created = _as_utc(now)
    raw, data, catalog, politics, approval = _load(repo)

    entries, files = _atlas_json_series(data, catalog)
    more_entries, more_files = _hand_entered_series(politics, approval)
    clash = {e["key"] for e in entries} & {e["key"] for e in more_entries}
    if clash:
        raise LegacyRefused(f"v1 holds {', '.join(sorted(clash))} twice")
    entries += more_entries
    files |= more_files
    for entry in entries:
        entry["allowed_transforms"] = offered_transforms(entry, files[entry["key"]])

    out: dict[str, bytes] = {}
    rows: dict[str, dict] = {}
    for entry in entries:
        key = entry["key"]
        folder, kind = ("derived", "derived") if "recipe" in entry else ("series", "stored")
        out[f"{folder}/{key}.json"] = _dump(files[key])
        rows[key] = {
            "kind": kind,
            "sha256": hashlib.sha256(out[f"{folder}/{key}.json"]).hexdigest(),
            "channel": entry["source"]["channel"]["via"],
            "rights_status": entry["rights"]["status"],
            "representation": entry["representation"],
        }
    # The content: Events from their files (drafts too: this is a local-profile Release), and
    # v1's bands and recessions for every set no hand-entered file provides.
    try:
        content = compile_content(profile="local", content=repo / "content", manual=repo / "catalog" / "manual",
                                  legacy_annotations=_annotations(data, politics, approval),
                                  carry_locks=False)
    except ContentError as error:
        raise LegacyRefused(f"the content cannot be compiled: {error}") from None
    out["catalog.json"] = _dump({"series": entries})
    out.update(content.files)
    # The headline Series and the search index: projections of the Catalog and content above.
    reading_report = add_reading_files(out, [], content.highlights)
    n_events = len(json.loads(content.files["content/events.json"])["events"])

    generated = data.get("generated")
    inputs = []
    for path in INPUTS:
        row = {"path": path, "sha256": hashlib.sha256(raw[path]).hexdigest(), "commit": _commit_of(repo, path)}
        row["generated"] = generated if path == ATLAS_JSON else None
        inputs.append(row)
    digest = hashlib.sha256()
    for name, body in sorted((name, body) for name, body in content.read if name.startswith("events/")):
        digest.update(name.encode() + b"\0" + hashlib.sha256(body).digest())
    inputs.append({"path": CONTENT_EVENTS, "sha256": digest.hexdigest(), "commit": _commit_of(repo, CONTENT_EVENTS),
                   "generated": None, "note": f"{n_events} Events, as files (M19); the hash is over their names and bytes"})

    digest = hashlib.sha256()
    for path in sorted(out):
        digest.update(path.encode() + b"\0" + hashlib.sha256(out[path]).digest())
    release_id = f"{created:%Y%m%dT%H%M%SZ}-{digest.hexdigest()[:7]}"
    out["manifest.json"] = _dump(
        {
            "schema_version": SCHEMA_VERSION,
            "semantics_version": SEMANTICS_VERSION,
            "release_id": release_id,
            "profile": "local",
            "created": f"{created:%Y-%m-%dT%H:%M:%SZ}",
            "rights_register": {"version": "none", "sha256": None, "signed": False},
            "series": rows,
            "withheld": [],
            "checks": {
                "passed": True,
                "report": [
                    {
                        "check": "legacy conversion",
                        "outcome": "pass",
                        "detail": f"{len(entries)} series carried over from v1's committed output; "
                                  f"{n_events} events compiled from {CONTENT_EVENTS}",
                    },
                    *reading_report,
                ],
            },
            "inputs": inputs,
        }
    )
    return release_id, out


def _resolved(path: str | os.PathLike) -> Path:
    return Path(path).expanduser().resolve()


def _overlaps(a: Path, b: Path) -> bool:
    return a == b or a in b.parents or b in a.parents


def local_root(repo: Path = ROOT, out: Path | None = None) -> Path:
    """Where the Release goes: ``out``, else $ATLAS_LOCAL, else var/local. Never a root that is,
    holds or lies inside $ATLAS_PUBLIC or $ATLAS_STORE, by any name (links are resolved)."""
    root = _resolved(out or os.environ.get("ATLAS_LOCAL") or repo / "var" / "local")
    for name, default in (("ATLAS_PUBLIC", "public"), ("ATLAS_STORE", "store")):
        other = _resolved(os.environ.get(name) or repo / "var" / default)
        if _overlaps(root, other):
            raise LegacyRefused(
                f"the legacy converter writes local-profile releases only: {root} overlaps ${name} ({other})"
            )
    return root


def _fit_for_a_legacy_release(root: Path) -> None:
    """What the release writer (M9, ADR 0023) keeps in a root, honoured here too: a root says
    once which Profile it is for, and a Series withdrawn from it stays out. This converter
    carries every Series v1 has, so it does not write into a root with a withdrawal."""
    def read(name: str) -> dict:
        try:
            found = json.loads((root / name).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise LegacyRefused(f"{root / name} cannot be read ({error})") from None
        return found if isinstance(found, dict) else {}

    marker = read("root.json")
    if marker and marker.get("profile") != "local":
        raise LegacyRefused(f"{root} is a {marker.get('profile')}-profile root; the legacy "
                            "converter writes local-profile releases only")
    if marker and marker.get("real_bytes") is False:
        raise LegacyRefused(f"{root} holds invented values; v1's Series are never mixed with them")
    gone = sorted(read("withdrawn.json").get("series", {}))
    if gone:
        raise LegacyRefused(f"{', '.join(gone)} was withdrawn from {root}; write the release with "
                            "`python -m atlas release --profile local`, which leaves it out")


def legacy_release(*, repo: Path = ROOT, out: Path | None = None, now: datetime | None = None) -> Path:
    """Convert v1's committed output and promote it as the current local Release.

    Returns the promoted release directory. Raises ``LegacyRefused`` (before writing anything)
    for a root it may not write to or v1 files it does not understand, and
    ``atlas.staging.PromotionRefused`` if the result breaks the Release contract.
    """
    root = local_root(repo, out)
    release_id, files = build_release(repo, now)
    root.mkdir(parents=True, exist_ok=True)
    try:
        # The root's own lock, the one the release writer holds (M9): two writers never stage
        # and promote in one root at the same time.
        with locked(root):
            _fit_for_a_legacy_release(root)
            directory = stage(root, release_id)
            for path, data in files.items():
                target = directory / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            return promote(root, release_id, profile="local")
    except StoreLocked:
        raise LegacyRefused(f"another run holds {root / 'LOCK'}; nothing was changed") from None


def main() -> int:
    try:
        promoted = legacy_release()
    except LegacyRefused as refused:
        print(f"legacy-release refused: {refused}")
        return 1
    catalog = json.loads((promoted / "catalog.json").read_text(encoding="utf-8"))["series"]
    events = len(json.loads((promoted / "content" / "events.json").read_text(encoding="utf-8"))["events"])
    print(f"Promoted {promoted.name} (local profile, not for publication): {len(catalog)} series, {events} events")
    print(f"  {promoted}")
    return 0
