PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.PHONY: fetch build check test smoke serve clean setup lint-py v2 v2-legacy-release v2-setup v2-check v2-dev v2-site-check v2-up v2-image-check

setup:
	uv sync --extra dev && .venv/bin/python -m playwright install chromium

fetch:
	$(PY) -m atlas fetch

build:
	$(PY) -m atlas build

check:
	$(PY) -m atlas check

test:
	$(PY) -m pytest -q -m "not smoke"

smoke:
	$(PY) -m pytest -q tests/test_smoke.py

serve:
	$(PY) -m http.server -d dist 8000

clean:
	rm -rf data/raw/* dist/index.html .pytest_cache

# --- v2 (docs/v2/PLAN.md). `make test` above runs v1's and v2's pytest suites together. ---

v2-setup:
	uv sync --extra dev && npm ci

lint-py:
	$(PY) -m ruff check

# Everything CI runs on a pull request into v2 (.github/workflows/v2-ci.yml).
v2-check: lint-py test
	npm run gen:check && npm run lint && npm run typecheck && npm test

# --- v2 on v1's data (M2). One command: convert v1's committed output into a local-profile
# release under $ATLAS_LOCAL (default var/local, git-ignored), then serve it on the local surface:
#   http://localhost:3000/macro-atlas/data      http://localhost:3000/macro-atlas/explore
# Local only (PLAN 6.1): the release is never public-profile, and nothing is fetched.
ATLAS_LOCAL ?= $(CURDIR)/var/local

v2: v2-legacy-release
	ATLAS_RELEASE_ROOT="$(ATLAS_LOCAL)" npm run dev -w @macro-atlas/site

v2-legacy-release:
	ATLAS_LOCAL="$(ATLAS_LOCAL)" $(PY) -m atlas legacy-release

# --- v2 site (M1). Everything below serves the synthetic fixture release unless told otherwise. ---

# The site in development mode, local surface: http://localhost:3000/macro-atlas/explore
v2-dev:
	npm run dev -w @macro-atlas/site

# M1's acceptance tests: three production builds over HTTP, then a real browser (Playwright).
# First time on a machine: npx playwright install chromium
v2-site-check:
	npm run test:built -w @macro-atlas/site
	ATLAS_SKIP_BUILD=1 npm run test:e2e -w @macro-atlas/site

# Both base paths in Docker, on loopback only:
#   http://localhost:3101/macro-atlas/explore   http://localhost:3102/macro-atlas-staging/explore
v2-up:
	docker compose -f deploy/compose.web.yaml up --build

# Builds both images, reads every layer for seeded values, and smoke-tests `docker compose up`.
v2-image-check:
	bash deploy/check-images.sh
