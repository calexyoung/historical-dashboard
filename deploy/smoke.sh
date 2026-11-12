#!/usr/bin/env bash
# The deploy kit's local smoke test (PLAN 4.8 and M26 acceptance). Needs Docker. It builds the
# production and the staging image from deploy/compose.yaml, runs both behind a throwaway
# Caddy that loads deploy/Caddyfile.snippet, and checks the two paths together:
#
#   1. the preflight stops a deploy: deploy/deploy.sh production refuses a root of invented
#      values and starts nothing;
#   2. each container is published on 127.0.0.1 only, healthy, non-root, its root read-only;
#   3. through Caddy, /macro-atlas is the production build and /macro-atlas-staging the
#      staging build; staging answers 401 without the password on a page, a twin, a static
#      asset and the API, and 200 with it; a path that only looks like one of them is neither;
#   4. the writer promotes a Release and both web apps serve it with no restart;
#   5. deploy/backup.sh then deploy/restore.sh give back the same store and root elsewhere.
#
# Every value is invented: the store and the roots are written inside the writer's image by
# fixtures/release/demo.py from the recorded fixture exchanges. Nothing is asked of any
# agency, nothing is pushed or uploaded, and everything is removed at the end. The Caddy
# upstreams are the two containers by name, not 127.0.0.1:3101 and :3102 as on the server: a
# container cannot dial the host's loopback, which is the point of binding to it.
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="$(mktemp -d "${TMPDIR:-/tmp}/macro-atlas-smoke.XXXXXX")"
CADDY_IMAGE="caddy:2"
CADDY="macro-atlas-smoke-caddy-$$"
USER_NAME="atlas"
PASSWORD="smoke-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"

settings() { # surface
  echo "ATLAS_PROJECT=macro-atlas-smoke-$1" "ATLAS_DATA_DIR=$WORK/$1" "ATLAS_BACKUP_DIR=$WORK/backups/$1" \
       "ATLAS_SERVER_ENV=$WORK/no-server.env"
}
as() { local surface="$1"; shift; env $(settings "$surface") "$@"; }
dc() { local surface="$1"; shift; as "$surface" docker compose --env-file "deploy/$surface.env" \
       -p "macro-atlas-smoke-$surface" -f deploy/compose.yaml "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

cleanup() {
  docker rm -f "$CADDY" "$CADDY-unset" >/dev/null 2>&1 || true
  for surface in production staging; do
    dc "$surface" down --remove-orphans >/dev/null 2>&1 || true
  done
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=macro-atlas-smoke-drill"); do
    docker rm -f "$id" >/dev/null 2>&1 || true
  done
  # The writer's container made these files as its own user; remove them the same way.
  docker run --rm --user 0 --entrypoint sh -v "$WORK:/work" macro-atlas-production-ingest \
    -c 'rm -rf /work/* /work/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

echo "== build the writer's image and make invented data for both surfaces"
dc production build ingest
mkdir -p "$WORK/production" "$WORK/staging" "$WORK/drill" "$WORK/backups/production"
chmod -R a+rwX "$WORK"
for surface in production staging; do
  docker run --rm --read-only --tmpfs /tmp -v "$PWD/fixtures:/app/fixtures:ro" -v "$WORK/$surface:/data" \
    --entrypoint python macro-atlas-production-ingest fixtures/release/demo.py --quiet --out /data >/dev/null
  [ -s "$WORK/$surface/public/CURRENT" ] || fail "no release was written for $surface"
done
FIRST="$(cat "$WORK/production/public/CURRENT")"

echo "== the preflight stops a deploy of this root, and nothing starts"
if as production bash deploy/deploy.sh production --yes > "$WORK/deploy.out" 2>&1; then
  cat "$WORK/deploy.out"; fail "deploy.sh deployed a root of invented values"
fi
grep -q "the root holds invented values" "$WORK/deploy.out" || { cat "$WORK/deploy.out"; fail "the preflight refused for another reason"; }
grep -q "STOPPED: the preflight refused" "$WORK/deploy.out" || fail "deploy.sh did not say it stopped"
[ -z "$(dc production ps -aq web)" ] || fail "a web container exists after a refused deploy"
echo "ok  refused before anything was built for the web app or started"

echo "== build and start both web apps (as deploy.sh would after a preflight that passes)"
for surface in production staging; do dc "$surface" up -d --build --wait --no-deps web; done

echo "== loopback only, healthy, non-root, the root read-only, no key in the web app"
for surface in production staging; do
  id="$(dc "$surface" ps -q web)"
  bindings="$(docker inspect -f '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIp}} {{end}}{{end}}' "$id")"
  [ -n "$bindings" ] || fail "$surface publishes no port"
  for ip in $bindings; do [ "$ip" = "127.0.0.1" ] || fail "$surface is published on $ip"; done
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] || fail "$surface is not healthy"
  [ "$(docker exec "$id" id -u)" != 0 ] || fail "$surface runs as root"
  if docker exec "$id" sh -c 'touch /releases/x 2>/dev/null'; then fail "$surface: /releases is writable"; fi
  if docker exec "$id" env | grep -q "API_KEY"; then fail "$surface: an API key is in the web app's environment"; fi
  [ "$(docker inspect -f '{{index .Config.Labels "co.mydashboards.macro-atlas.surface"}}' "$id")" = "$surface" ] \
    || fail "$surface runs an image built for another surface"
  echo "ok  $surface: 127.0.0.1 only, healthy, non-root, /releases read-only"
done
PRODUCTION_ID="$(dc production ps -q web)"
STAGING_ID="$(dc staging ps -q web)"

echo "== a throwaway Caddy that loads deploy/Caddyfile.snippet"
HASH="$(docker run --rm "$CADDY_IMAGE" caddy hash-password --plaintext "$PASSWORD")"
docker create --name "$CADDY" --network macro-atlas-smoke-production_default -p 127.0.0.1::8080 \
  -e "ATLAS_PRODUCTION_UPSTREAM=macro-atlas-smoke-production-web-1:3000" \
  -e "ATLAS_STAGING_UPSTREAM=macro-atlas-smoke-staging-web-1:3000" \
  -e "ATLAS_STAGING_USER=$USER_NAME" -e "ATLAS_STAGING_PASSWORD_HASH=$HASH" \
  -v "$PWD/deploy/Caddyfile.snippet:/etc/caddy/macro-atlas.snippet:ro" \
  -v "$PWD/deploy/smoke/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
docker network connect macro-atlas-smoke-staging_default "$CADDY"
docker start "$CADDY" >/dev/null
ADDRESS="$(docker port "$CADDY" 8080/tcp | head -1)"
case "$ADDRESS" in 127.0.0.1:*) ;; *) fail "the throwaway Caddy is published on $ADDRESS" ;; esac
EDGE="http://$ADDRESS"
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$EDGE/")" = 404 ] && break
  sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$EDGE/")" = 404 ] || { docker logs "$CADDY" 2>&1 | tail -20; fail "Caddy did not start with the snippet"; }

with_password() { printf 'user = "%s:%s"\n' "$USER_NAME" "$PASSWORD" | curl -K - -s "$@"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Without the two variables there is no account: staging must answer 401 to everyone, the
# right password included, and never come up open.
docker create --name "$CADDY-unset" --network macro-atlas-smoke-staging_default -p 127.0.0.1::8080 \
  -e "ATLAS_STAGING_UPSTREAM=macro-atlas-smoke-staging-web-1:3000" \
  -v "$PWD/deploy/Caddyfile.snippet:/etc/caddy/macro-atlas.snippet:ro" \
  -v "$PWD/deploy/smoke/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
docker start "$CADDY-unset" >/dev/null
UNSET="http://$(docker port "$CADDY-unset" 8080/tcp | head -1)"
for _ in $(seq 1 30); do [ "$(status "$UNSET/")" = 404 ] && break; sleep 1; done
[ "$(status "$UNSET/macro-atlas-staging/api/health")" = 401 ] || fail "staging is open when no user and password are set"
[ "$(with_password -o /dev/null -w '%{http_code}' "$UNSET/macro-atlas-staging/api/health")" = 401 ] \
  || fail "staging lets a password in when none is set"
docker rm -f "$CADDY-unset" >/dev/null
echo "ok  with no staging user and password set, staging answers 401 to everyone"

echo "== both paths together, each from its own build"
health="$(curl -fsS "$EDGE/macro-atlas/api/health")"
case "$health" in *'"status":"ok","surface":"production"'*"\"release_id\":\"$FIRST\""*) ;; *) fail "production health: $health" ;; esac
curl -fsS "$EDGE/macro-atlas/" | grep -q '>Overview</h1>' || fail "/macro-atlas/ is not the Overview"
[ "$(status "$EDGE/macro-atlas")" != 404 ] || fail "/macro-atlas (no slash) is not routed"
if curl -sI "$EDGE/macro-atlas/" | grep -qi '^x-robots-tag'; then fail "production says noindex"; fi
health="$(with_password "$EDGE/macro-atlas-staging/api/health")"
case "$health" in *'"status":"ok","surface":"staging"'*) ;; *) fail "staging health: $health" ;; esac
with_password "$EDGE/macro-atlas-staging/" | grep -q '>Overview</h1>' || fail "/macro-atlas-staging/ is not the Overview"
echo "ok  /macro-atlas is the production build and /macro-atlas-staging the staging build"

echo "== staging asks for the password on every path, and lets it in"
ATLAS_STAGING_USER="$USER_NAME" ATLAS_STAGING_PASSWORD="$PASSWORD" bash deploy/check-staging-auth.sh "$EDGE/macro-atlas-staging"
for path in /macro-atlas-staging/ /macro-atlas-staging/api/health; do
  [ "$(curl -sI "$EDGE$path" | grep -ci '^x-robots-tag: noindex')" = 1 ] || fail "a 401 on $path does not say noindex once"
done
[ "$(with_password -I "$EDGE/macro-atlas-staging/" | grep -ci '^x-robots-tag: noindex')" = 1 ] || fail "staging does not say noindex exactly once"
# The check must be able to fail: against production, which asks for no password, it does.
if bash deploy/check-staging-auth.sh "$EDGE/macro-atlas" >/dev/null 2>&1; then fail "the password check passed a path with no password"; fi
echo "ok  the password check fails on a path that asks for none"

echo "== a path that only looks like one of them reaches neither build"
for path in / /macro-atlasx/ /macro-atlas-stagingx/ /macro-atlas-staging2/api/health /explore; do
  [ "$(status "$EDGE$path")" = 404 ] || fail "$path was routed"
  curl -s "$EDGE$path" | grep -q "not Macro Atlas" || fail "$path was answered by a build"
done
[ "$(status "http://127.0.0.1:3101/macro-atlas-staging/explore")" = 404 ] || fail "the production container serves the staging path"
[ "$(status "http://127.0.0.1:3102/macro-atlas/explore")" = 404 ] || fail "the staging container serves the production path"
echo "ok  only the two exact prefixes are routed"

echo "== the writer promotes a Release; both web apps serve it with no restart"
for surface in production staging; do
  docker run --rm --read-only --tmpfs /tmp -v "$WORK/$surface:/data" macro-atlas-production-ingest \
    release --profile public --out /data/public --store /data/store \
    --register /data/register-prices-only.json --series /data/series.json >/dev/null \
    || fail "the writer could not promote a second release for $surface"
done
SECOND="$(cat "$WORK/production/public/CURRENT")"
[ "$SECOND" != "$FIRST" ] || fail "CURRENT did not move"
curl -fsS "$EDGE/macro-atlas/api/health" | grep -q "\"release_id\":\"$SECOND\"" || fail "production still serves $FIRST"
with_password "$EDGE/macro-atlas-staging/api/health" | grep -q "\"release_id\":\"$(cat "$WORK/staging/public/CURRENT")\"" \
  || fail "staging did not follow CURRENT"
[ "$(dc production ps -q web)" = "$PRODUCTION_ID" ] && [ "$(dc staging ps -q web)" = "$STAGING_ID" ] || fail "a container was replaced"
[ "$(docker inspect -f '{{.RestartCount}}' "$PRODUCTION_ID")" = 0 ] || fail "the production container restarted"
echo "ok  $FIRST -> $SECOND, same containers"

echo "== backup, then restore somewhere else, through the two scripts"
as production bash deploy/backup.sh production | tee "$WORK/backup.out"
ARCHIVE="$(ls "$WORK/backups/production"/macro-atlas-*.tar.gz)"
[ -s "$ARCHIVE.sha256" ] || fail "the backup has no checksum beside it"
if as production bash deploy/restore.sh production "$ARCHIVE" > "$WORK/restore-refused.out" 2>&1; then
  fail "restore.sh restored under a running web app"
fi
grep -q "is running" "$WORK/restore-refused.out" || fail "restore.sh refused for another reason"
env $(settings production) ATLAS_PROJECT=macro-atlas-smoke-drill ATLAS_DATA_DIR="$WORK/drill" \
  bash deploy/restore.sh production "$ARCHIVE" | tee "$WORK/restore.out"
grep -q "doctor: nothing wrong" "$WORK/restore.out" || fail "the restored root does not pass doctor"
for part in store public; do
  diff -r -x LOCK -x REFRESH.LOCK -x trash -x .staging "$WORK/production/$part" "$WORK/drill/$part" \
    || fail "the restored $part is not what was backed up"
done
[ "$(cat "$WORK/drill/public/CURRENT")" = "$SECOND" ] || fail "the restored root names another release"
echo "ok  the restored store and root are the ones backed up, and doctor passes them"

echo "== what the two web apps use (for deploy/headroom.sh's budget)"
docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}' "$PRODUCTION_ID" "$STAGING_ID" || true

echo "SMOKE OK"
