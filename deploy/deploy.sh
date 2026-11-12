#!/usr/bin/env bash
# Deploy one Surface on this machine (PLAN 4.8, 6.1 point 5 "Deploy" and M26; deploy/RUNBOOK.md).
#
#   deploy/deploy.sh staging
#   deploy/deploy.sh production          # asks you to type the word; --yes when no one can
#
# A production deploy is Alex's to start. This script is never run by CI or by the builder
# against a server.
#
#   1. builds the writer's image from this checkout, so the preflight reads this commit's
#      rights register and not an older image's;
#   2. the preflight: `atlas doctor --surface <surface>` on the release root to be served.
#      It refuses a local-profile Release, an unsigned register and a legacy Series, in any
#      Release a reader could open. If it refuses, the script stops here: nothing is built
#      for the web app and nothing is started;
#   3. builds the web image for this Surface and base path;
#   4. starts it and waits for its health check;
#   5. asks it over loopback which build it is and which Release it serves.
#
# Staging is held to production's rule (ADR 0015). It does not touch Caddy, the timers or
# the environment file with the keys: those are the runbook's manual steps.
set -euo pipefail
USAGE="[--yes]"
. "$(dirname "$0")/lib.sh"
atlas_surface "${1:-}"
confirmed="${2:-}"

for part in store public; do
  if [ ! -d "$ATLAS_DATA_DIR/$part" ]; then
    echo "STOPPED: $ATLAS_DATA_DIR/$part is not a directory. Make it first, owned by uid 10001"
    echo "         (deploy/RUNBOOK.md, 'The server, once'); Docker would make it as root's."
    exit 1
  fi
done
if [ "$SURFACE" = production ] && [ "$confirmed" != "--yes" ]; then
  if [ -t 0 ]; then
    read -r -p "This deploys to the public production path. Type the word production to go on: " word
    [ "$word" = production ] || { echo "STOPPED: not confirmed; nothing was done."; exit 1; }
  else
    echo "STOPPED: a production deploy is started by name: deploy/deploy.sh production --yes"
    exit 1
  fi
fi

commit="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "== 1/5 build the writer's image from this checkout ($commit)"
compose build ingest

echo "== 2/5 preflight: atlas doctor --surface $SURFACE on $ATLAS_DATA_DIR/public"
if ! compose run --rm --no-deps ingest doctor --surface "$SURFACE"; then
  echo "STOPPED: the preflight refused $ATLAS_DATA_DIR/public for the $SURFACE surface;"
  echo "         nothing was built for the web app and nothing was started. What serves now is unchanged."
  exit 1
fi

echo "== 3/5 build the web image ($ATLAS_SURFACE at $BASE_PATH)"
compose build web

echo "== 4/5 start it and wait until it is healthy"
compose up -d --wait --no-deps web

echo "== 5/5 ask it over loopback"
url="http://127.0.0.1:$ATLAS_WEB_PORT$BASE_PATH/api/health"
answer="$(curl -fsS --max-time 15 "$url")" || { echo "FAILED: $url did not answer"; exit 1; }
case "$answer" in
  *"\"status\":\"ok\""*"\"surface\":\"$SURFACE\""*) echo "ok  $answer" ;;
  *) echo "FAILED: $url did not answer as the $SURFACE build: $answer"; exit 1 ;;
esac
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SURFACE" "$commit" >> "$ATLAS_DATA_DIR/deploys.log" \
  || echo "note: could not add a line to $ATLAS_DATA_DIR/deploys.log; write the commit down yourself: $commit"
echo "DEPLOYED $SURFACE at $commit on 127.0.0.1:$ATLAS_WEB_PORT$BASE_PATH"
