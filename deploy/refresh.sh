#!/usr/bin/env bash
# The timer's job for one Surface (PLAN 4.7 and M26): capture, replay, release, in the
# writer's container, to completion. macro-atlas-ingest@.service runs this; so can a person.
#
#   deploy/refresh.sh production            deploy/refresh.sh staging --no-capture
#
# It uses the image deploy.sh built and never builds one: what runs on the timer is the code
# and the rights register of the last deploy. A refresh or a backup already running is waited
# for, up to half an hour (the two share a lock in the store), and then refused. It asks the agencies' servers, so it is not for
# tests; anything after the Surface is passed to `atlas refresh`. Exit status 1 means a
# source did not answer whole, no Release was promoted, or one was and the run failed after
# that; the last line says which (`journalctl -u macro-atlas-ingest@...`).
set -euo pipefail
USAGE="[atlas refresh options]"
. "$(dirname "$0")/lib.sh"
atlas_surface "${1:-}"
shift
exec "$DEPLOY_DIR/atlas.sh" "$SURFACE" refresh --profile public --wait "${ATLAS_WAIT_SECONDS:-1800}" "$@"
