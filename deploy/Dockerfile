# Macro Atlas web image (ADR 0008): the Next standalone server, non-root, with no Release inside.
# The release root is mounted read-only at /releases when the container starts.
#
# Build from the repository root, giving the Surface and the base path explicitly. There are no
# defaults on purpose: a build that is not told what it is for fails (PLAN 6.1 point 1).
#
#   docker build -f deploy/Dockerfile \
#     --build-arg ATLAS_SURFACE=local --build-arg BASE_PATH=/macro-atlas -t macro-atlas-web .
#
# What may enter the build context is an allowlist in /.dockerignore: no generated release and
# none of v1's data files. deploy/check-images.sh inspects the built image for seeded values.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY site/package.json site/
RUN npm ci

FROM node:24-alpine AS build
ARG ATLAS_SURFACE
ARG BASE_PATH
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 ATLAS_SURFACE="$ATLAS_SURFACE" BASE_PATH="$BASE_PATH" \
    npm run build -w @macro-atlas/site

FROM node:24-alpine AS run
ARG ATLAS_SURFACE
ARG BASE_PATH
WORKDIR /app
# The Surface is fixed inside the build, not here: no environment variable can change it.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ATLAS_RELEASE_ROOT=/releases \
    HEALTH_PATH=${BASE_PATH}/api/health
LABEL co.mydashboards.macro-atlas.surface="${ATLAS_SURFACE}" \
      co.mydashboards.macro-atlas.base-path="${BASE_PATH}"
COPY --from=build --chown=node:node /app/site/.next/standalone ./
COPY --from=build --chown=node:node /app/site/.next/static ./site/.next/static
USER node
EXPOSE 3000
# Fails when no Release may be served: the proxy answers 503 on every path (PLAN 6.1 point 5).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}${HEALTH_PATH}" >/dev/null || exit 1
CMD ["node", "site/server.js"]
