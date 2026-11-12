"""The server deploy kit as files (PLAN 4.8, 6.1 and M26; ADR 0008, ADR 0040): the compose
file, its two environment files, the Caddy snippet, the timer units and the scripts.

These read the files and run the scripts against a pretend ``docker``. ``deploy/smoke.sh``
builds the images and runs all of it for real behind a throwaway Caddy (CI's ``images`` job)."""
from __future__ import annotations

import configparser
import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "deploy"
COMPOSE_TEXT = (DEPLOY / "compose.yaml").read_text()
COMPOSE = yaml.safe_load(COMPOSE_TEXT)
WEB, INGEST = COMPOSE["services"]["web"], COMPOSE["services"]["ingest"]
SURFACES = {"production": ("/macro-atlas", "3101"), "staging": ("/macro-atlas-staging", "3102")}


def directives(text: str) -> str:
    """A file without its comment lines: what the program that reads it acts on."""
    return "".join(line for line in text.splitlines(keepends=True) if not line.lstrip().startswith("#"))


SNIPPET = directives((DEPLOY / "Caddyfile.snippet").read_text())
UNITS = sorted((DEPLOY / "systemd").iterdir())
SCRIPTS = sorted(DEPLOY.glob("*.sh"))


def settings(surface: str) -> dict[str, str]:
    lines = (DEPLOY / f"{surface}.env").read_text().splitlines()
    return dict(line.split("=", 1) for line in lines if line and not line.startswith("#"))


def unit(path: Path) -> configparser.RawConfigParser:
    parser = configparser.RawConfigParser(strict=False, delimiters=("=",), comment_prefixes=("#",),
                                          dict_type=_Repeated)
    parser.optionxform = str
    parser.read_string(path.read_text())
    return parser


class _Repeated(dict):
    """A key a unit gives twice (two OnCalendar lines) keeps both values, one per line."""

    def __setitem__(self, key, value):
        if key in self and isinstance(value, list) and isinstance(self[key], list):
            self[key].extend(value)
        else:
            super().__setitem__(key, value)


# --- compose: web and ingest, one file, two builds --------------------------------------------------


def test_there_are_two_services_and_only_the_web_app_stays_up():
    assert sorted(COMPOSE["services"]) == ["ingest", "web"]
    assert WEB["restart"] == "unless-stopped"
    assert INGEST["profiles"] == ["job"] and INGEST["restart"] == "no"   # `up` never starts the writer


def test_the_only_published_port_is_the_web_apps_on_loopback():
    assert WEB["ports"] == ["127.0.0.1:${ATLAS_WEB_PORT:?set ATLAS_WEB_PORT}:3000"]
    assert "ports" not in INGEST
    for service in (WEB, INGEST):
        assert "network_mode" not in service and "expose" not in service


def test_nothing_about_a_build_has_a_default():
    """A build that is not told its Surface, its path, its port or its directories fails
    (PLAN 6.1 point 1); the compose file falls back to nothing."""
    assert WEB["build"]["args"] == {"ATLAS_SURFACE": "${ATLAS_SURFACE:?set ATLAS_SURFACE}",
                                    "BASE_PATH": "${BASE_PATH:?set BASE_PATH}"}
    assert not re.findall(r"\$\{(?:ATLAS_SURFACE|BASE_PATH|ATLAS_WEB_PORT|ATLAS_DATA_DIR)(?::?-)", COMPOSE_TEXT)
    for service in (WEB, INGEST):
        assert "ATLAS_SURFACE" not in service.get("environment", {})


def test_the_web_app_reads_the_root_and_nothing_else_and_the_writer_holds_both():
    assert WEB["volumes"] == ["${ATLAS_DATA_DIR:?set ATLAS_DATA_DIR}/public:/releases:ro"]
    assert INGEST["volumes"] == ["${ATLAS_DATA_DIR:?set ATLAS_DATA_DIR}/store:/store",
                                 "${ATLAS_DATA_DIR:?set ATLAS_DATA_DIR}/public:/public"]
    assert "env_file" not in WEB and "environment" not in WEB        # no key reaches the web app
    assert INGEST["env_file"] == [{"path": "${ATLAS_SERVER_ENV:?set ATLAS_SERVER_ENV}", "required": False}]


@pytest.mark.parametrize("service", [WEB, INGEST], ids=["web", "ingest"])
def test_both_containers_are_locked_down(service):
    assert service["read_only"] is True
    assert service["cap_drop"] == ["ALL"]
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert "privileged" not in service and "user" not in service     # the images' own non-root users


@pytest.mark.parametrize("surface", sorted(SURFACES))
def test_each_surface_has_its_own_build_port_and_directories(surface):
    found = settings(surface)
    base, port = SURFACES[surface]
    assert (found["ATLAS_SURFACE"], found["BASE_PATH"], found["ATLAS_WEB_PORT"]) == (surface, base, port)
    assert found["ATLAS_DATA_DIR"] == f"/srv/macro-atlas/{surface}"
    assert found["ATLAS_BACKUP_DIR"] == f"/srv/macro-atlas/backups/{surface}"
    assert found["ATLAS_SERVER_ENV"] == f"/srv/macro-atlas/env/{surface}.env"
    assert not [name for name in found if "KEY" in name or "PASSWORD" in name or "TOKEN" in name]


def test_the_two_surfaces_share_no_port_and_no_directory():
    a, b = settings("production"), settings("staging")
    for name in ("ATLAS_WEB_PORT", "ATLAS_DATA_DIR", "ATLAS_BACKUP_DIR", "ATLAS_SERVER_ENV", "BASE_PATH"):
        assert a[name] != b[name], name


def test_no_environment_file_of_the_kit_holds_a_secret_and_the_servers_own_is_ignored_by_git():
    ignored = (ROOT / ".gitignore").read_text()
    for path in DEPLOY.rglob("*.env"):
        assert path.name in ("production.env", "staging.env", "server.env.example"), path
        assert not re.search(r"(?m)^(BEA_API_KEY|EIA_API_KEY)=.+", path.read_text()), path
    assert "keys.env" in ignored or "*.env" in ignored


# --- Caddy ------------------------------------------------------------------------------------------


def test_the_two_matchers_cannot_overlap_and_the_prefix_is_kept():
    assert "@macro_atlas path /macro-atlas /macro-atlas/*\n" in SNIPPET
    assert "@macro_atlas_staging path /macro-atlas-staging /macro-atlas-staging/*\n" in SNIPPET
    assert "/macro-atlas*" not in SNIPPET                       # that would also catch staging
    assert "handle_path" not in SNIPPET and "uri strip_prefix" not in SNIPPET


def test_each_path_goes_to_its_own_loopback_port():
    assert "reverse_proxy {$ATLAS_PRODUCTION_UPSTREAM:127.0.0.1:3101}" in SNIPPET
    assert "reverse_proxy {$ATLAS_STAGING_UPSTREAM:127.0.0.1:3102} {" in SNIPPET
    assert sorted(re.findall(r"127\.0\.0\.1:(\d+)", SNIPPET)) == ["3101", "3102"]
    assert "trusted_proxies" not in SNIPPET                     # deploy/README.md, "The proxy in front"


def test_staging_asks_for_a_password_on_every_path_and_says_noindex():
    staging = SNIPPET[SNIPPET.index("handle @macro_atlas_staging"):]
    production = SNIPPET[SNIPPET.index("handle @macro_atlas {"):SNIPPET.index("@macro_atlas_staging path")]
    assert "basic_auth {" in staging and "{$ATLAS_STAGING_USER} {$ATLAS_STAGING_PASSWORD_HASH}" in staging
    assert 'header X-Robots-Tag "noindex"' in staging
    assert "basic_auth" not in production and "X-Robots-Tag" not in production
    # The password is not in the repository: no bcrypt hash, only the name of the variable.
    assert not re.search(r"\$2[aby]\$\d\d\$", SNIPPET)
    # One handle block per matcher: there is no path of staging the password does not cover.
    assert staging.count("reverse_proxy") == 1 and SNIPPET.count("handle @") == 2


# --- timers -----------------------------------------------------------------------------------------


def test_the_units_are_these():
    assert [path.name for path in UNITS] == [
        "macro-atlas-backup@.service", "macro-atlas-backup@.timer",
        "macro-atlas-ingest@.service", "macro-atlas-ingest@.timer"]


def calendars(name: str) -> list[str]:
    return unit(DEPLOY / "systemd" / name)["Timer"]["OnCalendar"].split("\n")


def test_every_timer_keeps_new_yorks_clock_and_catches_up_a_missed_run():
    assert calendars("macro-atlas-ingest@.timer") == ["*-*-* 10:45:00 America/New_York",
                                                      "*-*-* 17:30:00 America/New_York"]
    assert calendars("macro-atlas-backup@.timer") == ["*-*-* 03:15:00 America/New_York"]
    for path in UNITS:
        if path.suffix == ".timer":
            parsed = unit(path)
            assert parsed["Timer"]["Persistent"] == "true"
            assert parsed["Install"]["WantedBy"] == "timers.target"
            assert "OnBootSec" not in parsed["Timer"] and "OnUnitActiveSec" not in parsed["Timer"]
            assert "UTC" not in directives(path.read_text())


@pytest.mark.skipif(shutil.which("systemd-analyze") is None, reason="systemd is not on this machine")
def test_systemd_reads_each_calendar_expression():
    for name in ("macro-atlas-ingest@.timer", "macro-atlas-backup@.timer"):
        for expression in calendars(name):
            done = subprocess.run(["systemd-analyze", "calendar", expression], check=False,
                                  capture_output=True, text=True)
            assert done.returncode == 0, done.stderr
            assert "America/New_York" in done.stdout


@pytest.mark.parametrize("name, script", [("macro-atlas-ingest@.service", "refresh.sh"),
                                           ("macro-atlas-backup@.service", "backup.sh")])
def test_a_service_runs_one_script_to_completion_for_the_surface_it_is_named_for(name, script):
    parsed = unit(DEPLOY / "systemd" / name)
    assert parsed["Service"]["Type"] == "oneshot"
    assert parsed["Service"]["ExecStart"] == f"/srv/macro-atlas/checkout/deploy/{script} %i"
    assert "Restart" not in parsed["Service"]                   # the next timer is the retry
    assert "Install" not in parsed                              # only the timer starts it


def test_the_two_services_are_not_ordered_against_each_other():
    """Each after the other is an ordering cycle, which systemd breaks by dropping a job. A
    refresh and a backup share a lock in the store instead, and each script waits for it."""
    for name in ("macro-atlas-ingest@.service", "macro-atlas-backup@.service"):
        after = unit(DEPLOY / "systemd" / name)["Unit"]["After"]
        assert "macro-atlas" not in after, name
    assert '--wait "${ATLAS_WAIT_SECONDS:-1800}"' in (DEPLOY / "refresh.sh").read_text()
    assert '--wait "${ATLAS_WAIT_SECONDS:-1800}"' in (DEPLOY / "backup.sh").read_text()


def test_this_repository_installs_and_starts_nothing():
    """The units are files for Alex to copy. No script here calls systemctl or crontab."""
    for path in SCRIPTS:
        text = directives(path.read_text())
        assert "systemctl" not in text and "crontab" not in text, path.name
        assert "docker push" not in text and "ssh " not in text and "scp " not in text, path.name


# --- the scripts, against a pretend docker ----------------------------------------------------------


@pytest.fixture
def host(tmp_path):
    """A machine with a ``docker`` and a ``curl`` that write down what they were asked and do
    what the test says, and a data directory laid out as the runbook says."""
    bin_dir, data = tmp_path / "bin", tmp_path / "data"
    bin_dir.mkdir()
    for part in ("store", "public"):
        (data / part).mkdir(parents=True)
    log = tmp_path / "calls.log"
    (bin_dir / "docker").write_text(f"""#!/usr/bin/env bash
echo "docker $*" >> "{log}"
case " $* " in
  *" image inspect "*) exit "${{FAKE_NO_WRITER:-0}}" ;;
  *" doctor "*) exit "${{FAKE_PREFLIGHT:-0}}" ;;
  *" ps "*) [ -n "${{FAKE_RUNNING:-}}" ] && echo abc123 ;;
esac
exit 0
""")
    (bin_dir / "curl").write_text(f"""#!/usr/bin/env bash
echo "curl $*" >> "{log}"
echo '{{"status":"ok","surface":"'"${{FAKE_SURFACE:-production}}"'","release_id":"20260101T000000Z-0000000"}}'
""")
    for name in ("docker", "curl"):
        (bin_dir / name).chmod(0o755)

    def run(script: str, *args: str, **env: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(DEPLOY / script), *args], check=False, capture_output=True, text=True,
            stdin=subprocess.DEVNULL,
            env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(tmp_path), "ATLAS_DATA_DIR": str(data),
                 "ATLAS_BACKUP_DIR": str(tmp_path / "backups"), "ATLAS_SERVER_ENV": str(tmp_path / "server.env"), **env})

    run.calls = lambda: [line for line in log.read_text().splitlines()] if log.exists() else []
    run.data = data
    return run


def test_every_script_is_executable_and_stops_at_the_first_error():
    assert [path.name for path in SCRIPTS] == [
        "atlas.sh", "backup.sh", "check-images.sh", "check-staging-auth.sh", "deploy.sh", "handoff.sh",
        "headroom.sh", "lib.sh", "refresh.sh", "restore.sh", "smoke.sh"]
    for path in SCRIPTS:
        assert path.read_text().startswith("#!/usr/bin/env bash\n"), path.name
        assert "set -euo pipefail" in path.read_text(), path.name
        if path.name != "lib.sh":
            assert path.stat().st_mode & stat.S_IXUSR, path.name


def test_a_deploy_runs_the_preflight_first_and_a_refusal_starts_nothing(host):
    done = host("deploy.sh", "production", "--yes", FAKE_PREFLIGHT="1")

    assert done.returncode == 1
    calls = host.calls()
    assert any(" doctor --surface production" in call for call in calls)
    assert not [call for call in calls if " up " in call or "build web" in call or call.startswith("curl")]
    assert "STOPPED" in done.stdout and "nothing was built for the web app and nothing was started" in done.stdout


def test_a_refused_deploy_leaves_the_writer_the_timers_run_as_it_was(host):
    """The candidate is what is built and asked. It is named `latest`, which refresh.sh runs,
    only after the web app has answered; a refusal never gets that far."""
    host("deploy.sh", "production", "--yes", FAKE_PREFLIGHT="1")
    assert not [call for call in host.calls() if call.startswith("docker tag")]
    assert "ATLAS_INGEST_TAG" not in (DEPLOY / "refresh.sh").read_text() + (DEPLOY / "atlas.sh").read_text()
    assert INGEST["image"].endswith("-ingest:${ATLAS_INGEST_TAG:-latest}")

    host("deploy.sh", "production", "--yes")
    calls = host.calls()
    tag = "docker tag macro-atlas-production-ingest:candidate macro-atlas-production-ingest:latest"
    assert calls.count(tag) == 1 and calls.index(tag) > max(i for i, call in enumerate(calls) if call.startswith("curl"))


def test_the_first_deploy_has_no_writer_to_protect_so_the_candidate_becomes_it_at_once(host):
    """The first deploy stops at the preflight (no Release yet) and the runbook's next step,
    refresh.sh, needs a writer."""
    done = host("deploy.sh", "staging", "--yes", FAKE_PREFLIGHT="1", FAKE_NO_WRITER="1")

    assert done.returncode == 1
    calls = host.calls()
    tag = "docker tag macro-atlas-staging-ingest:candidate macro-atlas-staging-ingest:latest"
    assert tag in calls and calls.index(tag) < next(i for i, call in enumerate(calls) if " doctor " in call)


def test_a_deploy_that_passes_builds_the_writer_asks_it_then_builds_and_starts_the_web_app(host):
    done = host("deploy.sh", "production", "--yes")

    assert done.returncode == 0, done.stdout + done.stderr
    calls = "\n".join(host.calls())
    order = [calls.index(part) for part in ("build ingest", "doctor --surface production", "build web",
                                            "up -d --wait --no-deps web", "curl ")]
    assert order == sorted(order)
    # The preflight runs in the image just built from this commit, so it reads this commit's register.
    assert "-p macro-atlas-production" in calls and "--env-file" in calls
    assert "127.0.0.1:3101/macro-atlas/api/health" in calls
    assert (host.data / "deploys.log").read_text().split()[1] == "production"


def test_a_deploy_fails_when_what_answers_is_not_the_build_it_started(host):
    done = host("deploy.sh", "production", "--yes", FAKE_SURFACE="staging")

    assert done.returncode == 1 and "did not answer as the production build" in done.stdout


def test_staging_is_deployed_through_the_same_preflight(host):
    done = host("deploy.sh", "staging", "--yes", FAKE_SURFACE="staging")

    assert done.returncode == 0, done.stdout + done.stderr
    calls = "\n".join(host.calls())
    assert "doctor --surface staging" in calls and "-p macro-atlas-staging" in calls
    assert "127.0.0.1:3102/macro-atlas-staging/api/health" in calls


def test_a_production_deploy_is_never_started_without_being_asked_for_by_name(host):
    done = host("deploy.sh", "production")              # no --yes, and nobody at the keyboard

    assert done.returncode == 1 and "production" in done.stdout
    assert host.calls() == []
    for wrong in ([], ["local"], ["prod"]):
        assert host("deploy.sh", *wrong).returncode == 2
    assert host.calls() == []


def test_a_deploy_needs_the_data_directories_to_be_there_already(host):
    """Docker would make a missing one itself, owned by root, and the writer could not write."""
    shutil.rmtree(host.data / "store")

    done = host("deploy.sh", "staging", "--yes")

    assert done.returncode == 1 and "store is not a directory" in done.stdout and host.calls() == []


def test_the_timers_script_runs_the_one_job_in_the_writers_container(host):
    assert host("refresh.sh", "production").returncode == 0
    (call,) = host.calls()
    assert call.endswith("run --rm ingest refresh --profile public --wait 1800")
    assert "-p macro-atlas-production" in call and "--build" not in call


def test_any_command_of_the_writer_can_be_run_for_a_surface(host):
    assert host("atlas.sh", "staging", "rollback", "20261201T154500Z-0a1b2c3", "--profile", "public").returncode == 0
    (call,) = host.calls()
    assert call.endswith("run --rm ingest rollback 20261201T154500Z-0a1b2c3 --profile public")
    assert host("atlas.sh", "staging").returncode == 2


def test_the_hand_off_script_mounts_the_clone_read_only_and_the_store_alone(host, tmp_path):
    clone = tmp_path / "clone"
    clone.mkdir()

    assert host("handoff.sh", "staging", str(clone)).returncode == 0
    (call,) = host.calls()
    assert f"-v {host.data}/store:/store" in call and f"-v {clone.resolve()}:/handoff:ro" in call
    assert call.endswith("handoff --from /handoff --store /store") and "/public" not in call
    assert host("handoff.sh", "staging", str(tmp_path / "nowhere")).returncode == 2


def test_the_backup_script_mounts_only_the_backup_directory_besides(host, tmp_path):
    assert host("backup.sh", "staging").returncode == 0
    (call,) = host.calls()
    assert f"-v {tmp_path / 'backups'}:/backups" in call
    assert call.endswith("ingest backup --to /backups --keep 14 --wait 1800")
    assert (tmp_path / "backups").is_dir()


def test_a_restore_refuses_while_the_web_app_runs_and_otherwise_mounts_the_parent(host, tmp_path):
    archive = tmp_path / "backups" / "macro-atlas-20260412T071500Z.tar.gz"
    archive.parent.mkdir()
    archive.write_bytes(b"")

    refused = host("restore.sh", "staging", str(archive), FAKE_RUNNING="1")
    assert refused.returncode == 1 and "is running" in refused.stdout
    assert not [call for call in host.calls() if " restore " in call]

    assert host("restore.sh", "staging", str(archive)).returncode == 0
    call = host.calls()[-1]
    assert f"-v {host.data}:/data" in call and f"-v {archive.parent}:/backups:ro" in call
    assert call.endswith(f"restore --from /backups/{archive.name} --store /data/store --public /data/public")
    assert "/data/store:/store" not in call                      # not the compose mounts: the parent


def test_a_restore_never_replaces_the_writer_the_timers_run(host, tmp_path):
    """A restore builds a writer from whatever commit is checked out, before any deploy of that
    commit has passed. It builds and runs the candidate; `latest`, which refresh.sh runs, is
    replaced by deploy.sh alone, and only when a deploy has succeeded."""
    archive = tmp_path / "backups" / "macro-atlas-20260412T071500Z.tar.gz"
    archive.parent.mkdir()
    archive.write_bytes(b"")

    assert host("restore.sh", "staging", str(archive)).returncode == 0
    calls = host.calls()
    assert not [call for call in calls if call.startswith("docker tag")]
    (ran,) = [call for call in calls if call.startswith("docker run")]
    assert " macro-atlas-staging-ingest:candidate restore " in ran
    assert "export ATLAS_INGEST_TAG=candidate" in (DEPLOY / "restore.sh").read_text()


def test_a_backup_is_restored_only_by_a_python_whose_tarfile_can_refuse_what_an_archive_may_hide():
    """``tarfile``'s extraction filter came in 3.11.4; atlas/backup.py unpacks with it."""
    import tomllib

    floor = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["requires-python"]
    assert floor == ">=3.11.4"
    assert "Python 3.11.4 or later" in (DEPLOY / "capture" / "README.md").read_text()


@pytest.mark.parametrize("memory, disk, status", [("4096", "50000", 0), ("700", "50000", 1), ("4096", "900", 1)])
def test_the_headroom_script_says_no_below_its_stated_minimums_and_changes_nothing(host, memory, disk, status):
    done = host("headroom.sh", "staging", HEADROOM_MEM_AVAILABLE_MB=memory, HEADROOM_DISK_FREE_MB=disk)

    assert done.returncode == status, done.stdout + done.stderr
    assert ("HEADROOM: enough" in done.stdout) is (status == 0)
    assert f"{memory} MB" in done.stdout and f"{disk} MB" in done.stdout
    for call in host.calls():
        assert re.match(r"docker (stats --no-stream|system df|ps)", call), call   # read-only


def test_the_staging_password_check_fails_when_any_path_answers_without_one(host, tmp_path):
    """With the pretend curl answering 200 to everything, the check must say no."""
    done = host("check-staging-auth.sh", "https://example.org/macro-atlas-staging")

    assert done.returncode == 1 and "answered without the password" in done.stdout


# --- the runbook ------------------------------------------------------------------------------------

RUNBOOK = (DEPLOY / "RUNBOOK.md").read_text()
#: Things only a person with Alex's access can do. Each must be a step of the runbook, marked
#: as his: the phrase is how the step is recognised, so the list reads as the manual steps.
MANUAL = {
    "logging in to the server": "Log in to the VPS",
    "making the directories, owned by the writer": "chown -R 10001:10001",
    "checking out a commit": "check out the commit",
    "placing the API keys": "Place the keys",
    "making the staging password": "caddy hash-password",
    "applying the Caddy snippet": "import /srv/macro-atlas/checkout/deploy/Caddyfile.snippet",
    "reloading Caddy": "reload Caddy",
    "checking the ports are closed from outside": "must fail to connect",
    "disabling the capture workflow": "Disable workflow",
    "cloning the capture repository": "Clone it on the server",
    "installing the timer units": "/etc/systemd/system/",
    "starting the timers": "systemctl enable --now",
    "choosing the off-host backup target": "ATLAS_BACKUP_REMOTE=",
    "stopping the timers for a restore": "systemctl stop",
    "stopping the web app for a restore": "docker compose -p macro-atlas-staging down",
    "moving the old data aside": "mv /srv/macro-atlas/staging/store /srv/macro-atlas/staging/store.before",
    "deciding which surface captures": "One timer captures",
    "the production deploy": "deploy/deploy.sh production",
    "rolling the code back": "previous commit",
    "deleting backups after a withdrawal": "Delete those archives",
}


def test_the_runbook_names_every_file_of_the_kit():
    for path in sorted(DEPLOY.iterdir()):
        name = path.name + ("/" if path.is_dir() else "")
        assert f"`{name}`" in RUNBOOK or path.name in ("RUNBOOK.md", "__pycache__"), name


def test_the_runbook_explains_every_variable_the_kit_reads():
    read = set(re.findall(r"\$\{?(ATLAS_[A-Z_]+|BASE_PATH|HEADROOM_[A-Z_]+)", "".join(
        directives(path.read_text()) for path in [DEPLOY / "compose.yaml", DEPLOY / "Caddyfile.snippet", *SCRIPTS]
        if path.name not in ("smoke.sh", "check-images.sh"))))
    read |= {"BEA_API_KEY", "EIA_API_KEY", "ATLAS_CAPTURE_ONLY", "ATLAS_CAPTURE_USER_AGENT"}
    assert len(read) > 15
    for name in sorted(read):
        assert f"`{name}`" in RUNBOOK or (name.startswith("HEADROOM_") and "`HEADROOM_*`" in RUNBOOK), name


def test_the_runbook_lists_every_manual_step_as_alexs():
    steps = re.split(r"(?m)^\s*\d+\. ", RUNBOOK)
    for what, phrase in MANUAL.items():
        assert phrase in RUNBOOK, what
        owners = [step for step in steps if phrase in step]
        assert any("**[ALEX]**" in step for step in owners), f"{what} is not marked as a manual step"


def test_every_script_the_runbook_tells_someone_to_run_exists_and_every_step_is_numbered_once():
    for name in set(re.findall(r"deploy/([a-z-]+\.sh)", RUNBOOK)):
        assert (DEPLOY / name).is_file(), name
    for name in ("deploy.sh", "refresh.sh", "backup.sh", "restore.sh", "handoff.sh", "atlas.sh", "headroom.sh",
                 "check-staging-auth.sh"):
        assert f"**[SCRIPT]** `deploy/{name}" in RUNBOOK, name
    numbers = [int(n) for n in re.findall(r"(?m)^(\d+)\. ", RUNBOOK)]
    assert numbers == list(range(1, len(numbers) + 1)) and len(numbers) >= 35


def test_the_runbook_says_what_is_open_and_never_holds_a_secret():
    for decision in ("D2", "D6", "D9"):
        assert f"| {decision} |" in RUNBOOK
    assert not re.search(r"\$2[aby]\$\d\d\$", RUNBOOK) and not re.search(r"API_KEY=\S", RUNBOOK)


@pytest.mark.parametrize("address, status", [
    ("http://example.org/macro-atlas-staging", 1),
    ("http://127.0.0.1.example.org/macro-atlas-staging", 1),
    ("http://localhost.example.org:8080/macro-atlas-staging", 1),
    ("http://127.0.0.1:80@example.org/macro-atlas-staging", 2),      # the host is what follows the @
    ("https://atlas@example.org/macro-atlas-staging", 2),
])
def test_the_staging_check_never_sends_the_password_over_plain_http_to_another_machine(tmp_path, address, status):
    """Basic auth sends the password as it is. A pretend curl answers 401 to everything, so
    the first half passes; the second must stop before it gives curl anything."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "curl").write_text(f'#!/usr/bin/env bash\necho "$*" >> "{tmp_path}/args"\ncat >> "{tmp_path}/stdin"\nprintf 401\n')
    (bin_dir / "curl").chmod(0o755)

    done = subprocess.run(
        ["bash", str(DEPLOY / "check-staging-auth.sh"), address], check=False,
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
        env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "ATLAS_STAGING_USER": "atlas", "ATLAS_STAGING_PASSWORD": "a-password"})

    assert done.returncode == status, done.stdout + done.stderr
    assert ("not sent over plain HTTP" in done.stdout) is (status == 1)
    asked = (tmp_path / "args").read_text() if (tmp_path / "args").exists() else ""
    given = (tmp_path / "stdin").read_text() if (tmp_path / "stdin").exists() else ""
    assert "a-password" not in asked + given + done.stdout + done.stderr and " -K " not in asked


def test_the_staging_check_gives_curl_the_password_as_it_is_typed_and_never_on_a_command_line(tmp_path):
    """A backslash or a double quote in a password must reach the server as itself: curl
    reads the pair from a quoted value. What curl is given on its standard input is written
    down by a pretend curl, which answers 401 without it and 200 with it."""
    bin_dir, seen = tmp_path / "bin", tmp_path / "seen"
    bin_dir.mkdir()
    (bin_dir / "curl").write_text(f"""#!/usr/bin/env bash
echo "$*" >> "{seen}.args"
if [[ " $* " != *" -K - "* ]]; then printf 401; exit 0; fi
given="$(cat)"; echo "$given" >> "{seen}.stdin"
if [[ " $* " != *"http_code"* ]]; then echo '<script src="/macro-atlas-staging/_next/static/chunks/a.js">'; exit 0; fi
if [[ "$given" == *not-the-password* ]]; then printf 401; else printf 200; fi
""")
    (bin_dir / "curl").chmod(0o755)
    password = 'pa\\ss"wo\\nrd'                                # pa\ss"wo\nrd: a backslash, a quote, a literal \n

    done = subprocess.run(
        ["bash", str(DEPLOY / "check-staging-auth.sh"), "https://example.org/macro-atlas-staging"], check=False,
        capture_output=True, text=True, stdin=subprocess.DEVNULL,
        env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "ATLAS_STAGING_USER": 'at"las', "ATLAS_STAGING_PASSWORD": password})

    assert done.returncode == 0, done.stdout + done.stderr
    assert "STAGING AUTH OK" in done.stdout and "ok   200 with the password: /_next/static/chunks/a.js" in done.stdout
    given = Path(f"{seen}.stdin").read_text().splitlines()
    assert given[0] == 'user = "at\\"las:pa\\\\ss\\"wo\\\\nrd"'
    assert given[-1] == 'user = "at\\"las:not-the-password"'
    assert "ss" not in Path(f"{seen}.args").read_text() and password not in done.stdout + done.stderr
