#!/usr/bin/env bash
# The deploy kit's own test (PLAN M1 acceptance; section 6.1 'Build and CI'). Needs Docker.
#
#   1. Plants a seeded value where generated releases and v1's data live (var/, data/, dist/,
#      web/), builds both images, and reads every layer: the seed, a line of v1's real
#      data/atlas.json and the fixture release must not be in any of them.
#   2. Brings the compose file up and checks that each base path serves the fixture release from
#      its own build, that each container is healthy, and that both ports are bound to 127.0.0.1.
#   3. Checks that a build with no Surface, or with one that does not match its base path, fails.
#
# Nothing is pushed and nothing is uploaded.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f deploy/compose.web.yaml)
SEED="ATLAS-SEED-FRED-$(date +%s)-$$"
PLANTED=(var/local/releases/20260101T000000Z-5eed5eed/series/seed.json data/raw/atlas-seed.csv dist/atlas-seed.html web/atlas-seed.js)

cleanup() {
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
  rm -f "${PLANTED[@]}"
  rmdir -p var/local/releases/20260101T000000Z-5eed5eed/series 2>/dev/null || true
}
trap cleanup EXIT

for path in "${PLANTED[@]}"; do
  mkdir -p "$(dirname "$path")"
  printf '{"UNRATE": "%s"}\n' "$SEED" > "$path"
done

echo "== build both images"
"${COMPOSE[@]}" build

echo "== read every layer of both images"
NEEDLES=("seed=$SEED" "fixture-release-id=20260101T000000Z-0000000" "fixture-series-name=Fixture price index")
if [ -f data/atlas.json ]; then
  # A stretch of v1's real output: values that came through FRED and Yahoo.
  # scan_image.py reports a hit by its label, never by these bytes.
  NEEDLES+=("v1-data-sample=$(head -c 4000 data/atlas.json | tail -c 60)")
fi
for service in web web-staging-path; do
  python3 deploy/scan_image.py "macro-atlas-local-${service}" "${NEEDLES[@]}"
done

# The scanner must be able to find something that IS there, or its silence means nothing.
if python3 deploy/scan_image.py macro-atlas-local-web "known=strict-dynamic" >/dev/null 2>&1; then
  echo "FAIL: the layer scan did not find a string the image is known to hold"; exit 1
fi
echo "ok  the scan finds a string that is in the image"

echo "== docker compose up"
"${COMPOSE[@]}" up -d --wait

check() { # port base
  local url="http://127.0.0.1:$1$2"
  curl -fsS "$url/api/health" | grep -q '"release_id":"20260101T000000Z-0000000"' || { echo "FAIL: $url/api/health"; exit 1; }
  curl -fsS "$url/explore" | grep -q 'Fixture price index' || { echo "FAIL: $url/explore"; exit 1; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$url/")" = 307 ] || { echo "FAIL: $url/ should redirect"; exit 1; }
  echo "ok  $url"
}
check 3101 /macro-atlas
check 3102 /macro-atlas-staging
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/macro-atlas-staging/explore)" = 404 ] || { echo "FAIL: 3101 serves the staging path"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3102/macro-atlas/explore)" = 404 ] || { echo "FAIL: 3102 serves the production path"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: mydashboards.co' http://127.0.0.1:3101/macro-atlas/explore)" = 421 ] || { echo "FAIL: a local build answered to a public host name"; exit 1; }

echo "== loopback only, non-root, read-only release mount"
for service in web web-staging-path; do
  id="$("${COMPOSE[@]}" ps -q "$service")"
  bindings="$(docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}} {{end}}{{end}}' "$id")"
  for ip in $bindings; do
    [ "$ip" = "127.0.0.1" ] || { echo "FAIL: $service is published on $ip"; exit 1; }
  done
  [ -n "$bindings" ] || { echo "FAIL: $service publishes no port"; exit 1; }
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] || { echo "FAIL: $service is not healthy"; exit 1; }
  [ "$(docker exec "$id" id -u)" != 0 ] || { echo "FAIL: $service runs as root"; exit 1; }
  if docker exec "$id" sh -c 'touch /releases/x 2>/dev/null'; then echo "FAIL: /releases is writable"; exit 1; fi
  echo "ok  $service: 127.0.0.1 only, healthy, non-root, /releases read-only"
done

echo "== a build with no Surface, or a mismatched one, fails"
refuse() { # description, then build args
  local what="$1"; shift
  if docker build -q -f deploy/Dockerfile "$@" . >/dev/null 2>&1; then echo "FAIL: built with $what"; exit 1; fi
  echo "ok  refused: $what"
}
refuse "no surface" --build-arg BASE_PATH=/macro-atlas
refuse "no base path" --build-arg ATLAS_SURFACE=local
refuse "production at the staging path" --build-arg ATLAS_SURFACE=production --build-arg BASE_PATH=/macro-atlas-staging
refuse "staging at the production path" --build-arg ATLAS_SURFACE=staging --build-arg BASE_PATH=/macro-atlas

echo "ALL OK"
