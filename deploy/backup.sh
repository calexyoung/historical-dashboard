#!/usr/bin/env bash
# One checked archive of a Surface's store and release root (PLAN 4.3 and M26; atlas/backup.py).
# macro-atlas-backup@.service runs this nightly; so can a person.
#
#   deploy/backup.sh production
#
# A refresh that is running is waited for, up to half an hour, and then the backup is refused.
# The archive goes to ATLAS_BACKUP_DIR on this machine, and the newest ATLAS_BACKUP_KEEP
# (default 14) stay. A backup on the same disk is not a backup: when ATLAS_BACKUP_REMOTE is
# set (an rsync destination Alex chooses and pays for; /srv/macro-atlas/env/backup.env), the
# directory is copied there afterwards, and nothing is ever deleted there by this script.
# An archive holds every value the root holds. Keep it as private as the root.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
atlas_surface "${1:-}"
mkdir -p "$ATLAS_BACKUP_DIR"
compose run --rm -v "$ATLAS_BACKUP_DIR:/backups" ingest backup --to /backups \
  --keep "${ATLAS_BACKUP_KEEP:-14}" --wait "${ATLAS_WAIT_SECONDS:-1800}"
if [ -n "${ATLAS_BACKUP_REMOTE:-}" ]; then
  echo "== copy to the off-host target"
  rsync -a --ignore-existing "$ATLAS_BACKUP_DIR/" "$ATLAS_BACKUP_REMOTE/$SURFACE/"
  echo "ok  copied to the off-host target ($SURFACE)"
else
  echo "note: ATLAS_BACKUP_REMOTE is not set; this backup is on the same machine as what it backs up"
fi
