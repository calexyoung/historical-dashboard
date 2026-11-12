"""Bulk files (PLAN section 7 and M25; ADR 0039; ``docs/method/bulk-files.md``): the Release's
Observations and versions as files a reader takes away whole.

The store is M8's three-fetch fixture: invented values of a made-up Origin, released under a
register written for the test. A decision in a register here is test data."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path

import pytest

from atlas.publish import bulk as B
from atlas.publish import release, withdraw
from atlas.release import validate_files, validate_release

from .release_helpers import (
    NOW,
    SERIES,
    all_bytes,
    build_store,
    fixture_table,
    read_json,
    series_with_recipes,
    write_register,
)

#: The three formats' rows, written out by hand from fixtures/vintage/three-fetch (the third
#: fetch no longer lists February for the price Series, and revised January's jobs).
JOBS = [("fx_jobs", "2026-01", "2026-01-01", "2026-01-31", 150010.0, "final"),
        ("fx_jobs", "2026-02", "2026-02-01", "2026-02-28", 150120.0, "preliminary"),
        ("fx_jobs", "2026-03", "2026-03-01", "2026-03-31", 150300.0, "preliminary")]
PRICE = [("fx_price", "2026-01", "2026-01-01", "2026-01-31", 100.0, "final"),
         ("fx_price", "2026-02", "2026-02-01", "2026-02-28", None, "missing"),
         ("fx_price", "2026-03", "2026-03-01", "2026-03-31", 100.9, "final"),
         ("fx_price", "2026-04", "2026-04-01", "2026-04-30", 101.3, "final")]


@pytest.fixture
def register(tmp_path) -> Path:
    return write_register(tmp_path / "register.json")


@pytest.fixture
def store(tmp_path, register) -> Path:
    return build_store(tmp_path / "store", register)


def publish(tmp_path, register, store, **more):
    options = {"profile": "public", "root": tmp_path / "public", "store": store,
               "register": register, "series": SERIES, "now": NOW, **more}
    result = release(**options)
    assert result.outcome == "promoted", result.lines
    return Path(options["root"]) / "releases" / result.release_id


def six(rows) -> list[tuple]:
    """The first six columns of every row, as plain Python: dates as text, values as floats."""
    out = []
    for row in rows:
        value = row["value"]
        if isinstance(value, str):
            value = None if value == "" else float(value)
        elif value is not None:
            value = None if math.isnan(value) else float(value)  # NaN is how pandas says null
        out.append((row["key"], row["period"], str(row["period_start"])[:10], str(row["period_end"])[:10],
                    value, row["status"]))
    return out


def csv_rows(path: Path) -> list[dict]:
    return list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode("utf-8"))))


def ndjson_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in gzip.decompress(path.read_bytes()).decode("utf-8").splitlines()]


def parquet_rows(path: Path) -> list[dict]:
    import pyarrow.parquet as pq

    return pq.read_table(path).to_pylist()


# --- what is written ------------------------------------------------------------------------------


def test_a_public_release_carries_its_observations_as_one_long_csv(tmp_path, register, store):
    directory = publish(tmp_path, register, store)

    rows = csv_rows(directory / "downloads" / "observations.csv.gz")
    assert six(rows) == JOBS + PRICE
    assert list(rows[0]) == ["key", "period", "period_start", "period_end", "value", "status",
                             "frequency", "kind", "unit", "licence", "ml_use"]
    assert rows[0]["frequency"] == "monthly" and rows[0]["kind"] == "stored"
    assert rows[0]["unit"] == "thousands of persons" and rows[0]["licence"] == "public_domain"
    assert {row["ml_use"] for row in rows} == {"true"}
    assert validate_release(directory) == []


def test_the_three_formats_hold_the_same_rows(tmp_path, register, store):
    directory = publish(tmp_path, register, store) / "downloads"

    assert six(csv_rows(directory / "observations.csv.gz")) == JOBS + PRICE
    assert six(ndjson_rows(directory / "observations.ndjson.gz")) == JOBS + PRICE
    assert six(parquet_rows(directory / "observations.parquet")) == JOBS + PRICE
    # Every column, not only the six: the same table three times.
    columns = B.OBSERVATION_COLUMNS
    said = lambda v: "" if v is None else str(v).lower() if isinstance(v, bool) else str(v)  # CSV writes true and false
    as_text = lambda rows: [tuple(said(r[c]) for c in columns if c != "value") for r in rows]
    assert as_text(csv_rows(directory / "observations.csv.gz")) == as_text(ndjson_rows(directory / "observations.ndjson.gz"))
    assert as_text(ndjson_rows(directory / "observations.ndjson.gz")) == as_text(parquet_rows(directory / "observations.parquet"))


def test_values_are_not_rounded(tmp_path, register, store):
    directory = publish(tmp_path, register, store)

    published = {(o["period"]): o["value"] for o in read_json(directory / "series" / "fx_price.json")["observations"]}
    for rows in (csv_rows(directory / "downloads" / "observations.csv.gz"),
                 ndjson_rows(directory / "downloads" / "observations.ndjson.gz"),
                 parquet_rows(directory / "downloads" / "observations.parquet")):
        held = {row[1]: row[4] for row in six(rows) if row[0] == "fx_price"}
        assert held == {period: (None if value is None else float(value)) for period, value in published.items()}


def test_derived_series_are_in_the_table_at_their_own_frequency(tmp_path, register, store):
    directory = publish(tmp_path, register, store, series=series_with_recipes(tmp_path / "series.json"))

    rows = ndjson_rows(directory / "downloads" / "observations.ndjson.gz")
    derived = sorted(path.stem for path in (directory / "derived").glob("*.json"))
    assert derived, "the fixture's Recipes were computed"
    assert sorted({row["key"] for row in rows if row["kind"] == "derived"}) == derived
    for key in derived:
        published = read_json(directory / "derived" / f"{key}.json")["observations"]
        assert [(r["period"], r["value"]) for r in rows if r["key"] == key] == [(o["period"], o["value"]) for o in published]


def test_every_version_the_release_holds_is_in_vintages_parquet(tmp_path, register, store):
    directory = publish(tmp_path, register, store)

    rows = parquet_rows(directory / "downloads" / "vintages.parquet")
    held = read_json(directory / "vintages" / "fx_jobs.json")["rows"]
    mine = [row for row in rows if row["key"] == "fx_jobs"]
    assert [(r["period"], r["value"], r["status"], r["deleted"], r["recorded_from"], r["recorded_to"], r["channel"]) for r in mine] == [
        (h["period"], None if h["value"] is None else float(h["value"]), h["status"], h["deleted"], h["recorded_from"], h["recorded_to"], h["channel"])
        for h in held]
    # January's jobs figure was revised by the second fetch: two versions of one Period.
    assert len([r for r in mine if r["period"] == "2026-01"]) == 2
    assert {r["unit"] for r in mine} == {"thousands of persons"} and {r["licence"] for r in mine} == {"public_domain"}


# --- the datapackage ------------------------------------------------------------------------------


def test_the_datapackage_names_every_file_with_its_size_and_checksum(tmp_path, register, store):
    directory = publish(tmp_path, register, store)

    package = read_json(directory / "downloads" / "datapackage.json")
    assert package["$schema"] == "https://datapackage.org/profiles/2.0/datapackage.json"
    assert package["release_id"] == directory.name and package["created"] == "2026-05-13T15:07:11Z"
    on_disk = sorted(p.name for p in (directory / "downloads").iterdir() if p.name != "datapackage.json")
    assert sorted(r["path"] for r in package["resources"]) == on_disk
    assert {"observations.parquet", "observations.csv.gz", "observations.ndjson.gz", "vintages.parquet"} <= set(on_disk)
    for resource in package["resources"]:
        data = (directory / "downloads" / resource["path"]).read_bytes()
        assert resource["bytes"] == len(data)
        assert resource["hash"] == "sha256:" + hashlib.sha256(data).hexdigest()
    whole = next(r for r in package["resources"] if r["path"] == "observations.csv.gz")
    assert whole["series"] == ["fx_jobs", "fx_price"] and whole["rows"] == 7
    assert [f["name"] for f in whole["schema"]["fields"]] == list(B.OBSERVATION_COLUMNS)


def test_the_datapackage_is_split_into_resources_by_licence(tmp_path, store):
    # Two rows of the register, two licence classes: prices are public domain, jobs ask for a citation.
    table = fixture_table(datasets=["fixture prices"])
    second = {**table["rows"][0], "id": "fx-jobs", "datasets": ["fixture jobs"], "licence_class": "citation_required",
              "attribution": "Source: Fixture jobs office", "terms": [{"url": "https://example.org/terms", "read_on": "2026-01-01"}]}
    second.pop("capture", None)
    table["rows"].append(second)
    directory = publish(tmp_path, write_register(tmp_path / "two.json", table), store)

    package = read_json(directory / "downloads" / "datapackage.json")
    by_path = {r["path"]: r for r in package["resources"]}
    assert by_path["observations.public_domain.csv.gz"]["series"] == ["fx_price"]
    assert by_path["observations.citation_required.csv.gz"]["series"] == ["fx_jobs"]
    assert by_path["observations.citation_required.csv.gz"]["licence"] == "citation_required"
    cited = by_path["observations.citation_required.csv.gz"]
    assert cited["licenses"] == [{"name": "other-at", "title": "Citation required", "path": "https://example.org/terms"}]
    assert cited["attributions"] == ["Source: Fixture jobs office"]
    assert six(csv_rows(directory / "downloads" / "observations.citation_required.csv.gz")) == JOBS
    assert six(parquet_rows(directory / "downloads" / "observations.public_domain.parquet")) == PRICE
    assert six(ndjson_rows(directory / "downloads" / "observations.public_domain.ndjson.gz")) == PRICE
    # A version is under the licence class recorded with it. The store recorded both Series as
    # public domain when it captured them, so their history is in that file, whatever a row of
    # the register says of the Series today.
    assert {r["key"] for r in parquet_rows(directory / "downloads" / "vintages.public_domain.parquet")} == {"fx_jobs", "fx_price"}
    assert "vintages.citation_required.parquet" not in by_path
    # The whole table names both licences, and each row says which is its own.
    assert sorted(by_path["observations.parquet"]["licences"]) == ["citation_required", "public_domain"]
    assert {(r["key"], r["licence"]) for r in csv_rows(directory / "downloads" / "observations.csv.gz")} == {
        ("fx_jobs", "citation_required"), ("fx_price", "public_domain")}
    assert validate_release(directory) == []


# --- they load ------------------------------------------------------------------------------------


def test_the_files_load_in_pandas(tmp_path, register, store):
    import pandas as pd

    directory = publish(tmp_path, register, store) / "downloads"
    assert six(pd.read_parquet(directory / "observations.parquet").to_dict("records")) == JOBS + PRICE
    assert six(pd.read_csv(directory / "observations.csv.gz").to_dict("records")) == JOBS + PRICE
    assert six(pd.read_json(directory / "observations.ndjson.gz", lines=True, convert_dates=False).to_dict("records")) == JOBS + PRICE
    assert len(pd.read_parquet(directory / "vintages.parquet")) == 9


def test_the_files_load_in_polars(tmp_path, register, store):
    import polars as pl

    directory = publish(tmp_path, register, store) / "downloads"
    assert six(pl.read_parquet(directory / "observations.parquet").to_dicts()) == JOBS + PRICE
    assert six(pl.read_csv(directory / "observations.csv.gz").to_dicts()) == JOBS + PRICE
    assert six(pl.read_ndjson(gzip.decompress((directory / "observations.ndjson.gz").read_bytes())).to_dicts()) == JOBS + PRICE
    assert pl.read_parquet(directory / "vintages.parquet").height == 9


def test_the_files_load_in_duckdb(tmp_path, register, store):
    import duckdb

    directory = publish(tmp_path, register, store) / "downloads"
    names = ["key", "period", "period_start", "period_end", "value", "status"]

    def rows(sql: str) -> list[dict]:
        return [dict(zip(names, row, strict=True)) for row in duckdb.sql(sql).fetchall()]

    select = "select key, period, period_start, period_end, value, status from"
    assert six(rows(f"{select} read_parquet('{directory / 'observations.parquet'}')")) == JOBS + PRICE
    assert six(rows(f"{select} read_csv('{directory / 'observations.csv.gz'}')")) == JOBS + PRICE
    assert six(rows(f"{select} read_json('{directory / 'observations.ndjson.gz'}', format = 'newline_delimited')")) == JOBS + PRICE
    assert duckdb.sql(f"select count(*) from read_parquet('{directory / 'vintages.parquet'}')").fetchall() == [(9,)]


# --- what is never in them ------------------------------------------------------------------------


def _signed(**grants) -> dict:
    return {"display": True, "redistribute": True, "store": True, "ml_use": True, "signed_by": "Alex",
            "signed_on": "2026-01-01", **grants}


# --- not for use in training a model (ADR 0041) ---------------------------------------------------

JOBS_NOTE = "Not for use in training machine-learning models: Fixture Jobs Office's terms reserve it"


def reserved_register(tmp_path) -> Path:
    """Prices keep every Permission; jobs may be shown, handed out and stored, and their
    (invented) terms reserve use in training a model."""
    table = fixture_table(datasets=["fixture prices"])
    second = {**table["rows"][0], "id": "fx-jobs", "name": "Fixture Jobs Office", "datasets": ["fixture jobs"],
              "licence_class": "citation_required", "decision": _signed(ml_use=False)}
    second.pop("capture", None)
    table["rows"].append(second)
    return write_register(tmp_path / "ml-reserved.json", table)


def test_the_catalog_says_which_series_are_not_for_model_training_and_who_reserves_it(tmp_path, store):
    directory = publish(tmp_path, reserved_register(tmp_path), store,
                        series=series_with_recipes(tmp_path / "series.json"))

    rights = {e["key"]: e["rights"] for e in read_json(directory / "catalog.json")["series"]}
    assert rights["fx_price"]["ml_use"] is True and "ml_use_reserved_by" not in rights["fx_price"]
    assert rights["fx_jobs"]["ml_use"] is False and rights["fx_jobs"]["ml_use_reserved_by"] == ["Fixture Jobs Office"]
    # A Derived series is as restricted as the most restricted Series it is computed from.
    assert rights["fx_price_change"]["ml_use"] is True
    assert rights["fx_jobs_per_price"]["ml_use"] is False
    assert rights["fx_jobs_per_price"]["ml_use_reserved_by"] == ["Fixture Jobs Office"]
    assert read_json(directory / "manifest.json")["schema_version"] == "0.8.0"
    assert validate_release(directory) == []


def test_every_bulk_row_says_whether_it_is_for_model_training_in_every_format(tmp_path, store):
    downloads = publish(tmp_path, reserved_register(tmp_path), store,
                        series=series_with_recipes(tmp_path / "series.json")) / "downloads"
    want = {"fx_jobs": False, "fx_jobs_per_price": False, "fx_price": True, "fx_price_change": True}

    for rows in (parquet_rows(downloads / "observations.parquet"), ndjson_rows(downloads / "observations.ndjson.gz")):
        assert {(r["key"], r["ml_use"]) for r in rows} == set(want.items())
    assert {(r["key"], r["ml_use"]) for r in csv_rows(downloads / "observations.csv.gz")} == {
        (key, "true" if allowed else "false") for key, allowed in want.items()}
    # Every version of a Series carries the Series' answer.
    assert {(r["key"], r["ml_use"]) for r in parquet_rows(downloads / "vintages.parquet")} == {
        ("fx_jobs", False), ("fx_price", True)}
    # The CSV is still a plain table: no comment line a loader would have to skip.
    assert gzip.decompress((downloads / "observations.csv.gz").read_bytes()).startswith(b"key,period,")


def test_the_datapackage_says_it_in_words_for_each_file_and_each_licence_class(tmp_path, store):
    downloads = publish(tmp_path, reserved_register(tmp_path), store,
                        series=series_with_recipes(tmp_path / "series.json")) / "downloads"
    package = read_json(downloads / "datapackage.json")
    by_path = {r["path"]: r for r in package["resources"]}
    both = [{"key": "fx_jobs", "note": JOBS_NOTE}, {"key": "fx_jobs_per_price", "note": JOBS_NOTE}]

    for name in ("observations.parquet", "observations.csv.gz", "observations.ndjson.gz",
                 "observations.citation_required.parquet"):
        assert by_path[name]["ml_use"] is False and by_path[name]["ml_use_reserved"] == both, name
        assert JOBS_NOTE in by_path[name]["description"]
    assert by_path["vintages.parquet"]["ml_use_reserved"] == [{"key": "fx_jobs", "note": JOBS_NOTE}]
    # A version is filed under the licence class recorded with it (the store was captured when
    # the one row was public domain), and still carries today's answer about model training.
    assert by_path["vintages.public_domain.parquet"]["ml_use_reserved"] == [{"key": "fx_jobs", "note": JOBS_NOTE}]
    name = "observations.public_domain.parquet"
    assert by_path[name]["ml_use"] is True and by_path[name]["ml_use_reserved"] == []
    assert "machine-learning" not in by_path[name]["description"]
    assert JOBS_NOTE in package["description"] and "fx_jobs, fx_jobs_per_price" in package["description"]
    column = next(f for f in by_path["observations.parquet"]["schema"]["fields"] if f["name"] == "ml_use")
    assert column["type"] == "boolean" and "training machine-learning models" in column["description"]


def test_a_release_where_everything_is_allowed_says_nothing_more(tmp_path, register, store):
    package = read_json(publish(tmp_path, register, store) / "downloads" / "datapackage.json")
    assert all(r["ml_use"] is True and r["ml_use_reserved"] == [] for r in package["resources"])
    assert "machine-learning" not in json.dumps({**package, "resources": [
        {k: v for k, v in r.items() if k != "schema"} for r in package["resources"]]})


def test_the_ml_use_column_is_a_boolean_in_pandas_polars_and_duckdb(tmp_path, store):
    import duckdb
    import pandas as pd
    import polars as pl

    downloads = publish(tmp_path, reserved_register(tmp_path), store) / "downloads"
    want = {"fx_jobs": False, "fx_price": True}
    for frame in (pd.read_parquet(downloads / "observations.parquet"), pd.read_csv(downloads / "observations.csv.gz"),
                  pd.read_json(downloads / "observations.ndjson.gz", lines=True, convert_dates=False)):
        assert frame["ml_use"].dtype == bool
        assert frame.groupby("key")["ml_use"].all().to_dict() == want
        assert set(frame[~frame["ml_use"]]["key"]) == {"fx_jobs"}
    for frame in (pl.read_parquet(downloads / "observations.parquet"), pl.read_csv(downloads / "observations.csv.gz"),
                  pl.read_ndjson(gzip.decompress((downloads / "observations.ndjson.gz").read_bytes()))):
        assert frame.schema["ml_use"] == pl.Boolean
        assert set(frame.filter(pl.col("ml_use"))["key"]) == {"fx_price"}
    for reader in (f"read_parquet('{downloads / 'observations.parquet'}')", f"read_csv('{downloads / 'observations.csv.gz'}')",
                   f"read_json('{downloads / 'observations.ndjson.gz'}', format = 'newline_delimited')"):
        assert duckdb.sql(f"select distinct key from {reader} where not ml_use").fetchall() == [("fx_jobs",)]
    assert duckdb.sql(f"select distinct key from read_parquet('{downloads / 'vintages.parquet'}') where ml_use").fetchall() == [("fx_price",)]


def test_the_check_refuses_a_datapackage_that_does_not_say_what_its_rows_say(tmp_path, store):
    register = reserved_register(tmp_path)
    directory = publish(tmp_path, register, store)
    files = {path.relative_to(directory).as_posix(): path.read_bytes() for path in directory.rglob("*") if path.is_file()}
    gate = B.RightsGate(read_json(register))
    assert B.problems(files, gate) == []

    package = read_json(directory / "downloads" / "datapackage.json")
    for resource in package["resources"]:
        resource["ml_use"], resource["ml_use_reserved"] = True, []
    files["downloads/datapackage.json"] = json.dumps(package).encode()
    found = B.problems(files, gate)
    assert any("ml_use_reserved is not the Series its rows mark false" in line for line in found), found


def test_a_history_that_came_through_terms_that_do_not_allow_it_is_marked_false(tmp_path, register, store):
    directory = publish(tmp_path, register, store)
    files = {path.relative_to(directory).as_posix(): path.read_bytes() for path in directory.rglob("*") if path.is_file()}
    catalog = {e["key"]: e for e in read_json(directory / "catalog.json")["series"]}
    history = read_json(directory / "vintages" / "fx_price.json")
    everything = B.RightsGate(read_json(register))
    assert {r["ml_use"] for r in B._vintage_rows("fx_price", history, catalog["fx_price"], everything)} == {True}

    # The same history, asked of a register whose row for where it came from reserves training.
    table = fixture_table(decision=_signed(ml_use=False))
    assert {r["ml_use"] for r in B._vintage_rows("fx_price", history, catalog["fx_price"], B.RightsGate(table))} == {False}
    assert files  # the Release itself is untouched


def test_a_series_that_may_be_shown_but_not_handed_out_is_in_no_bulk_file(tmp_path, store):
    # Prices keep every Permission; jobs may be displayed and may not be redistributed.
    table = fixture_table(datasets=["fixture prices"])
    second = {**table["rows"][0], "id": "fx-jobs", "datasets": ["fixture jobs"], "decision": _signed(redistribute=False)}
    second.pop("capture", None)
    table["rows"].append(second)
    directory = publish(tmp_path, write_register(tmp_path / "display-only.json", table), store)

    assert (directory / "series" / "fx_jobs.json").is_file(), "it is published: its page renders"
    downloads = directory / "downloads"
    assert six(csv_rows(downloads / "observations.csv.gz")) == PRICE
    assert six(ndjson_rows(downloads / "observations.ndjson.gz")) == PRICE
    assert six(parquet_rows(downloads / "observations.parquet")) == PRICE
    assert {r["key"] for r in parquet_rows(downloads / "vintages.parquet")} == {"fx_price"}
    package = read_json(downloads / "datapackage.json")
    assert all(r["series"] == ["fx_price"] for r in package["resources"])
    assert package["left_out"] == [{"key": "fx_jobs", "reason": "the rights register row for Macro Atlas fixture (synthetic) (fx-jobs) does not allow redistribute, so it is not permitted on the production surface"}]
    report = {c["check"]: c for c in read_json(directory / "manifest.json")["checks"]["report"]}
    assert report["bulk files"]["outcome"] == "warn" and "fx_jobs" in report["bulk files"]["detail"]


def test_a_withheld_series_is_in_no_bulk_file_and_its_values_are_nowhere_in_the_root(tmp_path, store):
    # The row is signed for one dataset only: the jobs Series has no row at all.
    narrowed = write_register(tmp_path / "narrowed.json", fixture_table(datasets=["fixture prices"]))
    directory = publish(tmp_path, narrowed, store)

    assert [row["key"] for row in read_json(directory / "manifest.json")["withheld"]] == ["fx_jobs"]
    for name in ("observations.csv.gz", "observations.ndjson.gz"):
        text = gzip.decompress((directory / "downloads" / name).read_bytes()).decode()
        assert "fx_jobs" not in text and "150010" not in text and "150120" not in text
    assert {r["key"] for r in parquet_rows(directory / "downloads" / "observations.parquet")} == {"fx_price"}
    assert {r["key"] for r in parquet_rows(directory / "downloads" / "vintages.parquet")} == {"fx_price"}
    assert b"150010" not in all_bytes(tmp_path / "public")


def test_a_derived_series_resting_on_a_display_only_input_is_in_no_bulk_file(tmp_path, store):
    table = fixture_table(datasets=["fixture prices"])
    second = {**table["rows"][0], "id": "fx-jobs", "datasets": ["fixture jobs"], "decision": _signed(redistribute=False)}
    second.pop("capture", None)
    table["rows"].append(second)
    directory = publish(tmp_path, write_register(tmp_path / "display-only.json", table), store,
                        series=series_with_recipes(tmp_path / "series.json"))

    catalog = {e["key"]: e for e in read_json(directory / "catalog.json")["series"]}
    resting = sorted(key for key, entry in catalog.items() if "fx_jobs" in entry.get("recipe", {}).get("inputs", [])
                     and (directory / "derived" / f"{key}.json").is_file())
    assert resting, "the fixture has a Recipe over the jobs Series, and it was computed"
    keys = {r["key"] for r in ndjson_rows(directory / "downloads" / "observations.ndjson.gz")}
    assert "fx_jobs" not in keys and not keys & set(resting)


def test_a_release_with_nothing_that_may_be_handed_out_has_no_bulk_files(tmp_path, store):
    table = fixture_table(decision=_signed(redistribute=False))
    directory = publish(tmp_path, write_register(tmp_path / "display-only.json", table), store)

    assert not (directory / "downloads").exists()
    report = {c["check"]: c for c in read_json(directory / "manifest.json")["checks"]["report"]}
    assert report["bulk files"]["outcome"] == "warn"
    assert validate_release(directory) == []


def test_a_local_profile_release_has_no_bulk_files(tmp_path, register, store):
    result = release(profile="local", root=tmp_path / "local", store=store, register=register, series=SERIES,
                     now=NOW, legacy=False)
    assert result.outcome == "promoted", result.lines
    directory = tmp_path / "local" / "releases" / result.release_id

    assert not (directory / "downloads").exists()
    assert all(c["check"] != "bulk files" for c in read_json(directory / "manifest.json")["checks"]["report"])


def test_the_validator_refuses_bulk_files_in_a_local_profile_release(tmp_path, register, store):
    public = publish(tmp_path, register, store)
    result = release(profile="local", root=tmp_path / "local", store=store, register=register, series=SERIES,
                     now=NOW, legacy=False)
    local = tmp_path / "local" / "releases" / result.release_id
    (local / "downloads").mkdir()
    for path in (public / "downloads").iterdir():
        (local / "downloads" / path.name).write_bytes(path.read_bytes())
    package = read_json(local / "downloads" / "datapackage.json")
    package["release_id"] = local.name
    (local / "downloads" / "datapackage.json").write_text(json.dumps(package))

    assert "bulk_files" in {issue.code for issue in validate_release(local)}


# --- reuse and withdrawal -------------------------------------------------------------------------


def test_a_content_only_release_writes_its_bulk_files_again(tmp_path, register, store):
    first = publish(tmp_path, register, store)
    later = NOW.replace(hour=18)
    second = publish(tmp_path, register, store, reuse_data=True, now=later)

    assert second.name != first.name
    assert six(csv_rows(second / "downloads" / "observations.csv.gz")) == JOBS + PRICE
    assert read_json(second / "downloads" / "datapackage.json")["release_id"] == second.name
    assert validate_release(second) == []


def test_a_withdrawn_series_leaves_the_bulk_files_of_the_replacement(tmp_path, register, store):
    publish(tmp_path, register, store)
    result = withdraw(key="fx_jobs", reason="the terms forbid redistribution", profile="public",
                      root=tmp_path / "public", store=store, register=register, now=NOW.replace(hour=18))
    assert result.outcome == "withdrawn" and result.exit_code == 0, result.lines
    directory = tmp_path / "public" / "releases" / result.release_id

    assert six(csv_rows(directory / "downloads" / "observations.csv.gz")) == PRICE
    assert {r["key"] for r in parquet_rows(directory / "downloads" / "vintages.parquet")} == {"fx_price"}
    assert b"150010" not in all_bytes(tmp_path / "public")


def test_the_same_store_gives_the_same_bulk_files(tmp_path, register, store):
    first = publish(tmp_path, register, store)
    second = publish(tmp_path, register, store, root=tmp_path / "again")

    assert first.name == second.name
    for path in sorted((first / "downloads").iterdir()):
        assert path.read_bytes() == (second / "downloads" / path.name).read_bytes(), path.name


# --- the writer's own check -----------------------------------------------------------------------


def test_the_check_finds_a_row_that_should_not_be_there(tmp_path, register, store):
    from atlas.rights import RightsGate

    directory = publish(tmp_path, register, store)
    files = {p.relative_to(directory).as_posix(): p.read_bytes() for p in directory.rglob("*") if p.is_file()}
    narrowed = RightsGate(fixture_table(datasets=["fixture prices"]))

    assert B.problems(files, RightsGate(read_json(register))) == []
    found = B.problems(files, narrowed)
    assert found and all("fx_jobs" in problem for problem in found)

    # One format saying something the others do not.
    lines = gzip.decompress(files["downloads/observations.csv.gz"]).decode().splitlines()
    files["downloads/observations.csv.gz"] = gzip.compress("\n".join(lines[:-1] + [""]).encode(), mtime=0)
    assert any("observations.csv.gz" in problem for problem in B.problems(files, RightsGate(read_json(register))))


def test_the_check_holds_the_datapackage_to_the_rows_of_each_file(tmp_path, register, store):
    # The site decides whether a file may be handed out from the Series its resource lists.
    from atlas.rights import RightsGate

    directory = publish(tmp_path, register, store)
    files = {p.relative_to(directory).as_posix(): p.read_bytes() for p in directory.rglob("*") if p.is_file()}
    gate = RightsGate(read_json(register))
    assert B.problems(files, gate) == []

    def with_package(change) -> dict[str, bytes]:
        package = json.loads(files["downloads/datapackage.json"])
        change(next(r for r in package["resources"] if r["path"] == "observations.parquet"))
        return {**files, "downloads/datapackage.json": json.dumps(package).encode()}

    left_off = with_package(lambda r: r.update(series=["fx_price"]))
    assert validate_files(directory.name, left_off) == [], "the contract cannot see it: it reads no Parquet"
    assert any("observations.parquet" in p and "list of its Series" in p for p in B.problems(left_off, gate))
    assert any("count of its rows" in p for p in B.problems(with_package(lambda r: r.update(rows=6)), gate))
    assert any("licence classes" in p for p in B.problems(with_package(lambda r: r.update(licences=["cc_by"])), gate))
    gone = {k: v for k, v in files.items() if k != "downloads/datapackage.json"}
    assert B.problems(gone, gate) == ["datapackage.json: is missing or cannot be read"]


def test_a_file_of_versions_is_described_by_what_was_recorded_with_them(tmp_path, store):
    # The register now calls jobs citation-required, with terms and its own attribution. The
    # versions were captured as public domain under the fixture's attribution, and that is
    # what their file says: today's terms are not put on yesterday's rows.
    table = fixture_table(datasets=["fixture prices"])
    second = {**table["rows"][0], "id": "fx-jobs", "datasets": ["fixture jobs"], "licence_class": "citation_required",
              "attribution": "Source: Fixture jobs office", "terms": [{"url": "https://example.org/terms", "read_on": "2026-01-01"}]}
    second.pop("capture", None)
    table["rows"].append(second)
    directory = publish(tmp_path, write_register(tmp_path / "two.json", table), store)

    by_path = {r["path"]: r for r in read_json(directory / "downloads" / "datapackage.json")["resources"]}
    for name in ("vintages.parquet", "vintages.public_domain.parquet"):
        versions = by_path[name]
        assert versions["licences"] == ["public_domain"]
        assert versions["licenses"] == [{"name": "other-pd", "title": "Public domain"}]
        assert versions["attributions"] == ["Synthetic test data, Macro Atlas project"]
        assert versions["sources"] == [{"title": "Macro Atlas fixture (synthetic)"}]
    # The Observations are today's, and say today's terms.
    assert by_path["observations.citation_required.parquet"]["attributions"] == ["Source: Fixture jobs office"]
