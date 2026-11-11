"""The ready-to-copy kit for the capture host (PLAN M7, 4.7; ADR 0012; decision D6 is open).

The workflow is a file for Alex to copy into a separate private repository. Nothing here may
start a schedule in this repository: scheduled workflows run only from a default branch, and
where capture runs is Alex's to decide."""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "deploy" / "capture"
WORKFLOW = yaml.safe_load((KIT / "capture.yml").read_text())
STEPS = WORKFLOW["jobs"]["capture"]["steps"]
TRIGGERS = WORKFLOW[True]  # YAML reads the key `on` as true


def step(name_part):
    return next(s for s in STEPS if name_part in s.get("name", ""))


def test_this_repository_schedules_nothing():
    for path in (ROOT / ".github" / "workflows").glob("*.y*ml"):
        text = path.read_text()
        assert "atlas.capture" not in text and "atlas capture" not in text, path.name
        if path.name != "refresh.yml":  # v1's weekly refresh, untouched until cutover
            assert "schedule" not in (yaml.safe_load(text)[True] or {}), path.name


def test_the_workflow_runs_after_both_release_times_in_both_daylight_regimes():
    crons = [entry["cron"] for entry in TRIGGERS["schedule"]]
    assert crons == ["50 15 * * *", "45 22 * * *"]  # after 10:00 ET and after 16:15 ET, all year
    assert "workflow_dispatch" in TRIGGERS


def test_two_runs_never_write_the_store_at_once():
    assert WORKFLOW["concurrency"] == {"group": "capture", "cancel-in-progress": False}
    assert WORKFLOW["permissions"] == {"contents": "write"}


def test_the_code_is_checked_out_at_a_pinned_commit_beside_the_store():
    checkouts = [s for s in STEPS if s.get("uses", "").startswith("actions/checkout@")]
    assert [s["with"]["path"] for s in checkouts] == ["store", "atlas"]
    assert checkouts[1]["with"]["ref"] == "${{ vars.ATLAS_REF }}"  # a commit Alex names; no branch


def test_the_capture_step_needs_requests_only_and_no_secret():
    text = (KIT / "capture.yml").read_text()
    assert text.count(" install ") == 1 and "install requests==" in text  # nothing else
    assert "secrets." not in text
    assert step("Capture")["run"].strip().endswith("-m atlas.capture")


def test_what_was_captured_is_committed_even_when_the_run_failed():
    capture, keep, fail = step("Capture"), step("Keep"), step("Fail")
    assert capture["id"] == "capture" and capture["continue-on-error"] is True
    assert keep["if"] == "always()"
    assert "git push" in keep["run"]
    assert STEPS.index(capture) < STEPS.index(keep) < STEPS.index(fail)
    assert fail["if"] == "steps.capture.outcome != 'success'"
    assert "exit 1" in fail["run"]


def test_captures_that_could_not_be_pushed_are_saved_as_an_artifact_not_lost_with_the_runner():
    keep, bundle, upload = step("Keep"), step("Bundle"), step("Upload")
    assert keep["id"] == "keep"
    assert "git rebase --abort" in keep["run"]  # a failed rebase must not end the retries
    assert bundle["if"] == upload["if"] == "failure() && steps.keep.outcome == 'failure'"
    assert "git bundle create" in bundle["run"]
    assert upload["uses"].startswith("actions/upload-artifact@")
    assert upload["with"]["if-no-files-found"] == "error"
    assert STEPS.index(keep) < STEPS.index(bundle) < STEPS.index(upload)


def test_the_runbook_says_what_only_alex_can_do():
    text = (KIT / "README.md").read_text()
    for needed in ("D2", "D6", "ATLAS_REF", "--dry-run", "--verify", "MISSED", "hand-off"):
        assert needed in text, needed
