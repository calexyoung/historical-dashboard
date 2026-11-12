#!/usr/bin/env bash
# Can this machine carry Macro Atlas beside what it already runs? (PLAN 4.8 and M26.)
# Read-only: it looks and changes nothing. Run it on the VPS before the first deploy.
#
#   deploy/headroom.sh [production|staging]
#
# What it needs room for: two always-on Next containers (staging and production) and, twice
# a day, one Python and Node job. The minimums below are budgets, not measurements from the
# VPS: 2 x 256 MB for the web containers and 1 GB for the job leave no slack under 1536 MB of
# available memory, and the store, thirty Releases and fourteen backups are budgeted at 10 GB.
# Both can be changed for one run: HEADROOM_MIN_MEM_MB, HEADROOM_MIN_DISK_MB.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
directory=/
if [ -n "${1:-}" ]; then
  atlas_surface "$1"
  directory="$ATLAS_DATA_DIR"
  while [ ! -d "$directory" ]; do directory="$(dirname "$directory")"; done
fi
need_mem="${HEADROOM_MIN_MEM_MB:-1536}"
need_disk="${HEADROOM_MIN_DISK_MB:-10240}"

mem="${HEADROOM_MEM_AVAILABLE_MB:-}"
if [ -z "$mem" ] && [ -r /proc/meminfo ]; then
  mem="$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)"
fi
disk="${HEADROOM_DISK_FREE_MB:-$(df -Pm "$directory" | awk 'NR == 2 {print $4}')}"

echo "== memory"
if command -v free >/dev/null 2>&1; then free -m; else echo "(no free on this machine)"; fi
echo "== disk"
df -h "$directory"
echo "== processors and load"
(command -v nproc >/dev/null 2>&1 && nproc) || true
uptime || true
echo "== what Docker runs now"
docker stats --no-stream || echo "(docker stats did not answer)"
docker system df || echo "(docker system df did not answer)"

echo "== verdict"
status=0
if [ -z "$mem" ]; then
  echo "NO   available memory could not be read on this machine (no /proc/meminfo)"; status=1
elif [ "$mem" -lt "$need_mem" ]; then
  echo "NO   available memory is $mem MB; Macro Atlas is budgeted $need_mem MB"; status=1
else
  echo "ok   available memory is $mem MB (budget $need_mem MB)"
fi
if [ "$disk" -lt "$need_disk" ]; then
  echo "NO   free disk at $directory is $disk MB; Macro Atlas is budgeted $need_disk MB"; status=1
else
  echo "ok   free disk at $directory is $disk MB (budget $need_disk MB)"
fi
if [ "$status" = 0 ]; then echo "HEADROOM: enough"; else echo "HEADROOM: not enough; do not deploy yet"; fi
exit "$status"
