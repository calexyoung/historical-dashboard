PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.PHONY: fetch build check test smoke serve clean setup lint-py v2-setup v2-check

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
