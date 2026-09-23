PY ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.PHONY: fetch build check test smoke serve clean setup

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
