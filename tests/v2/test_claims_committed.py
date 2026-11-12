"""What the repository itself holds of Claims (PLAN M21; ADR 0034, ADR 0035): one real
statement, as a draft record, and no lock but the fixture's. The Claim here is real; nothing
in this file states a value of any Series."""
import shutil
from pathlib import Path

from atlas.catalog import check as C
from atlas.content import claims as K

ROOT = Path(__file__).resolve().parents[2]
WORKED = "2023-02-07-biden-on-the-unemployment-rate"


def committed() -> dict[str, dict]:
    out = {}
    for path in K.claim_files():
        claim, problems = K.read_claim(path.read_bytes(), path.name)
        assert claim is not None and problems == [], (path.name, problems)
        out[claim["id"]] = claim
    return out


def test_every_committed_claim_is_a_draft_and_the_repository_holds_no_lock():
    claims = committed()
    assert claims, "M21 commits one worked Claim"
    # D7(a): only Alex publishes a Claim. None is published, so no real lock is kept.
    assert {claim["status"] for claim in claims.values()} == {"draft"}
    assert not (K.CLAIMS_DIR / K.LOCKS).exists() or list((K.CLAIMS_DIR / K.LOCKS).iterdir()) == []


def test_the_worked_claim_is_a_whole_record():
    claim = committed()[WORKED]
    assert claim["claimant"] == {"name": "Joseph R. Biden, Jr.", "role": "President of the United States", "party": "Democratic"}
    assert claim["quote"] == "But unemployment rate is at 3.4 percent, a 50-year low."
    assert len(claim["sources"]) == 2
    for source in claim["sources"]:
        assert source["archive_url"].startswith("https://web.archive.org/web/2023")
        assert source["archive_url"].endswith(source["url"]) and source["locator"] and source["kind"] == "transcript"
    assert len({source["url"].split("/")[2] for source in claim["sources"]}) == 2  # two hosts, two records
    assert [(r["series"], r["measure"]) for r in claim["readings"]] == [("unrate", "value_at"), ("unrate", "rank")]
    assert len(claim["readings"][1]["alternative_windows"]) == 2
    assert len(claim["readings_not_measured"]) == 3 and claim["corrections"] == []


def test_the_committed_content_passes_the_check_and_a_catalog_elsewhere_is_not_held_to_it(tmp_path):
    assert C.check().ok
    # A Catalog in another place is checked with the content beside it, not the repository's:
    # one Series copied out, and no complaint that the worked Claim reads a Series it lacks.
    series = tmp_path / "catalog" / "series"
    series.mkdir(parents=True)
    shutil.copy(ROOT / "catalog" / "series" / "cpi.json", series / "cpi.json")
    report = C.check(series)
    assert report.ok and report.layers[-1].ran
    # ...and with a Claim beside it that reads a Series it does not hold, it says so.
    claims = tmp_path / "content" / "claims"
    claims.mkdir(parents=True)
    shutil.copy(K.CLAIMS_DIR / f"{WORKED}.md", claims / f"{WORKED}.md")
    said = [problem.message for problem in C.check(series).layers[-1].problems]
    assert said and all("unrate, which is not in the catalog" in message for message in said)
