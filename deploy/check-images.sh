#!/usr/bin/env bash
# The deploy kit's own test (PLAN M1 acceptance; section 6.1 'Build and CI'). Needs Docker.
#
#   1. Plants a seeded value where generated releases and v1's data live (var/, data/, dist/,
#      web/), builds both images, and reads every layer: the seed, a line of v1's real
#      data/atlas.json and the fixture release must not be in any of them.
#   2. Brings the compose file up and checks that each base path serves the fixture release from
#      its own build, that each container is healthy, and that both ports are bound to 127.0.0.1.
#   3. Checks that a build with no Surface, or with one that does not match its base path, fails.
#   4. Builds the ingest image (Python and Node, PLAN M11), reads its layers for the same seeds,
#      checks its content/ is the tracked one, and runs a whole release with Derived series and
#      the repository's Events inside it on the invented vintage fixture.
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
  # The front door is the Overview (M22): a page, complete in its HTML, not a redirect.
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$url/")" = 200 ] || { echo "FAIL: $url/ should answer 200"; exit 1; }
  curl -fsS "$url/" | grep -q '>Overview</h1>' || { echo "FAIL: $url/ should be the Overview"; exit 1; }
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

echo "== the ingest image: its own allowlist, every layer read, a whole release run inside it"
# deploy/ingest.Dockerfile (PLAN M11): Python and Node, the one writer. The seeds planted above
# are still in place, so the same needles must be absent from its layers too.
INGEST=macro-atlas-local-ingest
docker build -q -f deploy/ingest.Dockerfile -t "$INGEST" . >/dev/null
# Also absent: v1's hand-entered tables, which sit inside the atlas package.
python3 deploy/scan_image.py "$INGEST" "${NEEDLES[@]}" \
  "v1-catalog-table=$(head -c 2000 atlas/catalog.yaml | tail -c 80)" \
  "v1-approval-table=$(head -c 2000 atlas/approval.yaml | tail -c 80)"
if python3 deploy/scan_image.py "$INGEST" "known=atlas-core verify --release" >/dev/null 2>&1; then
  echo "FAIL: the layer scan did not find a string the ingest image is known to hold"; exit 1
fi
echo "ok  the scan finds a string that is in the ingest image"
# The content in the image is the tracked content/ and nothing else: no note, no stray file,
# no lock that is not committed (M26; ADR 0033, ADR 0040).
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  diff <(git ls-files content | LC_ALL=C sort) \
       <(docker run --rm --entrypoint sh "$INGEST" -c 'cd /app && find content -type f' | LC_ALL=C sort) \
    || { echo "FAIL: the ingest image's content/ is not the tracked content/"; exit 1; }
  echo "ok  the ingest image holds exactly the tracked content files"
fi
[ "$(docker run --rm --entrypoint id "$INGEST" -u)" != 0 ] || { echo "FAIL: the ingest image runs as root"; exit 1; }
# The real commands on the invented vintage fixture (mounted, never in the image): capture
# replay, vintage replay, then a release whose two Derived series the Node step computes.
# The image's own filesystem is read-only: everything is written under the mounted /tmp.
docker run --rm --read-only --tmpfs /tmp -v "$PWD/fixtures:/app/fixtures:ro" --entrypoint sh "$INGEST" -c '
  set -e
  python fixtures/release/demo.py --quiet --out /tmp/demo >/dev/null
  release="/tmp/demo/public/releases/$(cat /tmp/demo/public/CURRENT)"
  test -s "$release/derived/fx_price_change.json"
  test -s "$release/derived/fx_jobs_per_price.json"
  grep -q "\"semantics_version\":\"0\." "$release/manifest.json"
  # The content the image holds is compiled into the Release (M26): public Events, no draft.
  python -c "import json, sys; sys.exit(not json.load(open(sys.argv[1]))[\"events\"])" "$release/content/events.json"
  test ! -e /tmp/demo/public/.staging || test -z "$(ls -A /tmp/demo/public/.staging)"
' || { echo "FAIL: a release with Derived series could not be written inside the ingest image"; exit 1; }
echo "ok  ingest: non-root, read-only filesystem, a release with Derived series from the Node step"
# With no register row signed the real job refuses, in the image as anywhere else.
if docker run --rm --read-only --tmpfs /store --tmpfs /public "$INGEST" release --profile public >/dev/null 2>&1; then
  echo "FAIL: the ingest image released something from an empty store"; exit 1
fi
echo "ok  ingest: atlas release --profile public refuses on an empty store"

echo "ALL OK"
