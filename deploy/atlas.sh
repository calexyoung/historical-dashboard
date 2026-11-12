#!/usr/bin/env bash
# Any `atlas` command in the writer's container of one Surface, with its store and its root
# mounted as compose.yaml says (deploy/RUNBOOK.md):
#
#   deploy/atlas.sh production doctor
#   deploy/atlas.sh production capture --status
#   deploy/atlas.sh staging rollback 20261201T154500Z-0a1b2c3 --profile public
#
# It uses the image the last deploy built and never builds one.
set -euo pipefail
USAGE="COMMAND [options]"
. "$(dirname "$0")/lib.sh"
atlas_surface "${1:-}"
shift
[ "$#" -gt 0 ] || { echo "usage: $(basename "$0") production|staging $USAGE" >&2; exit 2; }
compose run --rm ingest "$@"
