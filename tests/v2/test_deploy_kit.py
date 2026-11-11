"""The web-only deploy kit binds to loopback and gives every build its Surface explicitly.

PLAN M1 acceptance and section 6.1 points 1 and 5. These check the files; `deploy/check-images.sh`
builds the images, inspects their layers for seeded values and runs `docker compose up`.
"""
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = yaml.safe_load((ROOT / "deploy" / "compose.web.yaml").read_text())
DOCKERFILE = (ROOT / "deploy" / "Dockerfile").read_text()
SERVICES = COMPOSE["services"]


def test_there_is_one_web_service_per_base_path():
    paths = sorted(s["build"]["args"]["BASE_PATH"] for s in SERVICES.values())
    assert paths == ["/macro-atlas", "/macro-atlas-staging"]


@pytest.mark.parametrize("name", sorted(SERVICES))
def test_every_published_port_is_bound_to_loopback(name):
    ports = SERVICES[name]["ports"]
    assert ports
    for port in ports:
        assert isinstance(port, str) and port.startswith("127.0.0.1:"), port
    assert "network_mode" not in SERVICES[name]


@pytest.mark.parametrize("name", sorted(SERVICES))
def test_every_service_is_built_for_the_local_surface_explicitly(name):
    # The compose file is for Alex's machine. Staging and production builds belong to M26/M27.
    assert SERVICES[name]["build"]["args"]["ATLAS_SURFACE"] == "local"


@pytest.mark.parametrize("name", sorted(SERVICES))
def test_the_release_root_is_mounted_read_only_and_nothing_else_is_mounted(name):
    service = SERVICES[name]
    assert len(service["volumes"]) == 1
    assert service["volumes"][0].endswith(":/releases:ro")
    assert service["read_only"] is True
    assert "environment" not in service or "ATLAS_SURFACE" not in service["environment"]


def test_the_dockerfile_has_no_default_surface_or_base_path():
    # A build that is not told its Surface must fail, not fall back to one.
    assert re.search(r"^ARG ATLAS_SURFACE$", DOCKERFILE, re.MULTILINE)
    assert re.search(r"^ARG BASE_PATH$", DOCKERFILE, re.MULTILINE)
    assert not re.search(r"^ARG (ATLAS_SURFACE|BASE_PATH)=", DOCKERFILE, re.MULTILINE)
    assert not re.search(r"^ENV .*ATLAS_SURFACE", DOCKERFILE, re.MULTILINE)


def test_the_image_runs_as_a_non_root_user_with_a_health_check_and_no_release_inside():
    assert re.search(r"^USER node$", DOCKERFILE, re.MULTILINE)
    assert "HEALTHCHECK" in DOCKERFILE and "/api/health" in DOCKERFILE
    for line in DOCKERFILE.splitlines():
        if line.startswith(("COPY", "ADD")):
            for forbidden in ("fixtures", "var/", "data", "dist", "web/"):
                assert forbidden not in line, line
