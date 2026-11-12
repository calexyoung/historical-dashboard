#!/usr/bin/env bash
# Shared by the deploy kit's scripts (source it; it is not run). It turns the Surface a script
# was given into the settings of that build and the one way compose is called for it.
#
#   . "$(dirname "$0")/lib.sh"; atlas_surface "$1"; compose ps
#
# The settings come from deploy/<surface>.env. A variable already set in the environment
# wins, which is how deploy/smoke.sh points the same scripts at a temporary directory; on a
# server nothing sets them. ATLAS_PROJECT names the compose project (default
# macro-atlas-<surface>).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$DEPLOY_DIR")"

atlas_surface() {
  case "${1:-}" in
    production|staging) ;;
    *) echo "usage: $(basename "$0") production|staging${USAGE:+ $USAGE}" >&2; exit 2 ;;
  esac
  SURFACE="$1"
  ENV_FILE="$DEPLOY_DIR/$SURFACE.env"
  PROJECT="${ATLAS_PROJECT:-macro-atlas-$SURFACE}"
  local name value
  for name in ATLAS_SURFACE BASE_PATH ATLAS_WEB_PORT ATLAS_DATA_DIR ATLAS_BACKUP_DIR ATLAS_SERVER_ENV; do
    if [ -z "${!name:-}" ]; then
      value="$(sed -n "s/^$name=//p" "$ENV_FILE" | tail -1)"
      [ -n "$value" ] || { echo "STOPPED: $ENV_FILE does not set $name" >&2; exit 2; }
      printf -v "$name" '%s' "$value"
    fi
    export "${name?}"
  done
  if [ "$ATLAS_SURFACE" != "$SURFACE" ]; then
    echo "STOPPED: ATLAS_SURFACE is $ATLAS_SURFACE, and this was asked for $SURFACE" >&2
    exit 2
  fi
}

compose() {
  docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$DEPLOY_DIR/compose.yaml" "$@"
}
