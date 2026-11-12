#!/usr/bin/env bash
# Put a backup back (PLAN 4.3 and M26; atlas/backup.py; deploy/RUNBOOK.md, "Restore").
#
#   deploy/restore.sh staging /srv/macro-atlas/backups/staging/macro-atlas-20261201T081500Z.tar.gz
#
# It restores into ATLAS_DATA_DIR/store and ATLAS_DATA_DIR/public and never over anything:
# both must be absent or empty, so move what is there aside first. It refuses while the web
# app of this Surface runs, because a running container keeps the directory it was started
# on and would go on serving the old one. Stop the timers before, and start the web app again
# after (`deploy/deploy.sh <surface>`), which mounts the restored root.
#
# The writer's container gets the parent directory, not the two mounts of compose.yaml: a
# restore moves whole directories into place, which cannot be done to a mount point.
set -euo pipefail
USAGE="ARCHIVE"
. "$(dirname "$0")/lib.sh"
atlas_surface "${1:-}"
archive="${2:-}"
if [ ! -f "$archive" ]; then
  echo "usage: $(basename "$0") production|staging ARCHIVE   ($archive is not a file)" >&2
  exit 2
fi
if [ -n "$(compose ps -q web)" ]; then
  echo "STOPPED: the web app of $PROJECT is running and would keep serving the directory it"
  echo "         was started on. Stop the timers, then: docker compose -p $PROJECT down"
  exit 1
fi
compose build ingest
directory="$(cd "$(dirname "$archive")" && pwd)"
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -v "$ATLAS_DATA_DIR:/data" -v "$directory:/backups:ro" "macro-atlas-$ATLAS_SURFACE-ingest" \
  restore --from "/backups/$(basename "$archive")" --store /data/store --public /data/public
echo "RESTORED into $ATLAS_DATA_DIR. Next: deploy/deploy.sh $SURFACE, then start the timers."
