# Macro Atlas ingest image (ADR 0002, ADR 0008, ADR 0025): the one writer. Python (capture,
# replay, the release writer) and Node (the engine step, `atlas-core verify`) in one image,
# run to completion by a host timer. No scheduler runs inside it and it holds no data: the
# store and the release root are mounted when it starts.
#
#   docker build -f deploy/ingest.Dockerfile -t macro-atlas-ingest .
#   docker run --rm -v STORE:/store -v PUBLIC:/public macro-atlas-ingest refresh --profile public
#
# On the server it is the `ingest` service of deploy/compose.yaml, started by deploy/refresh.sh
# from a host timer (deploy/RUNBOOK.md).
#
# What may enter the build context is the allowlist beside this file
# (deploy/ingest.Dockerfile.dockerignore): the atlas package, the schema, the Catalog, the spot values,
# the content a Release is compiled from (Events, Claims and their committed locks, Topics) and
# the engine's source. No generated release, no store, none of v1's data files, and none of
# v1's hand-entered tables. deploy/check-images.sh reads every layer for seeded values and runs
# a whole release, Node step included, inside the image.
#
# The engine runs from its TypeScript source (Node strips the types), so the image has no
# node_modules and nothing is fetched from npm.

FROM node:24-bookworm-slim AS node

FROM python:3.12-slim-bookworm AS run
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/app/.venv/bin:$PATH \
    ATLAS_STORE=/store \
    ATLAS_PUBLIC=/public
COPY pyproject.toml uv.lock ./
# Runtime dependencies only, exactly as locked; the project itself is run from /app.
RUN uv sync --locked --no-dev --no-install-project && node --version
COPY atlas ./atlas
COPY schema ./schema
COPY catalog ./catalog
COPY checks/spot.json ./checks/spot.json
COPY content ./content
COPY packages/core/package.json ./packages/core/package.json
COPY packages/core/bin ./packages/core/bin
COPY packages/core/src ./packages/core/src
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin atlas \
    && mkdir /store /public && chown atlas /store /public
USER atlas
ENTRYPOINT ["python", "-m", "atlas"]
CMD ["doctor"]
