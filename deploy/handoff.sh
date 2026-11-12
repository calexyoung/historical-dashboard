#!/usr/bin/env bash
# The capture hand-off (PLAN 4.7 and M26; atlas/handoff.py; deploy/RUNBOOK.md, "The capture
# hand-off"): the interim Captures, from a clone of the capture repository into this
# Surface's store, once, checked at both ends.
#
#   deploy/handoff.sh staging /srv/macro-atlas/handoff/macro-atlas-captures
#
# Disable the capture workflow and let its last run end before cloning. The store must hold
# no Capture yet, and the timer must not have been started. Afterwards:
# deploy/refresh.sh <surface> --no-capture replays them and writes the first Release.
set -euo pipefail
USAGE="CLONE"
. "$(dirname "$0")/lib.sh"
atlas_surface "${1:-}"
clone="${2:-}"
if [ ! -d "$clone" ]; then
  echo "usage: $(basename "$0") production|staging CLONE   ($clone is not a directory)" >&2
  exit 2
fi
clone="$(cd "$clone" && pwd)"
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$ATLAS_DATA_DIR/store:/store" -v "$clone:/handoff:ro" "macro-atlas-$ATLAS_SURFACE-ingest" \
  handoff --from /handoff --store /store
