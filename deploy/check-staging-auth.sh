#!/usr/bin/env bash
# Does staging ask for the password on everything? (PLAN 6.1 points 3 and 5; M26, M27.)
#
#   deploy/check-staging-auth.sh https://HOST/macro-atlas-staging
#
# Staging is on the public internet, so without a password it is public. A request with no
# password must get 401 on a page, a twin, a static asset and the API: one path that answers
# otherwise fails the check. Run it from outside the server before a local-profile Release
# is ever pointed at staging, and after every change to Caddy.
#
# With ATLAS_STAGING_USER and ATLAS_STAGING_PASSWORD in the environment it also checks the
# other half: the same paths answer 200 with the password, so a wall that lets nobody in
# does not pass for a working one. The password is given to curl on its standard input and
# is never printed or put on a command line. A password with a line break in it is not
# supported.
set -euo pipefail
base="${1:-}"
case "$base" in
  http://*|https://*) base="${base%/}" ;;
  *) echo "usage: $(basename "$0") https://HOST/macro-atlas-staging" >&2; exit 2 ;;
esac
# The host is read from the address itself, not guessed from how it begins: a user name in
# it ("http://127.0.0.1:80@elsewhere/") is refused, since what follows the @ is the host.
authority="${base#*://}"
authority="${authority%%/*}"
case "$authority" in
  *@*|"") echo "usage: $(basename "$0") https://HOST/macro-atlas-staging   (no user name in the address)" >&2; exit 2 ;;
esac
case "$authority" in
  127.0.0.1|127.0.0.1:*|localhost|localhost:*|"[::1]"|"[::1]:"*) this_machine=1 ;;
  *) this_machine=0 ;;
esac
paths=("/" "/explore" "/data.md" "/llms.txt" "/_next/static/chunks/any.js" "/api/v1/catalog.json" "/api/health")

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" || true; }

open=0
for path in "${paths[@]}"; do
  got="$(code "$base$path")"
  if [ "$got" = 401 ]; then
    echo "ok   401 without the password: $path"
  else
    echo "FAIL $path answered ${got:-nothing} without the password"
    open=$((open + 1))
  fi
done
if [ "$open" != 0 ]; then
  echo "FAILED: $open path(s) answered without the password. Staging is public; serve no local-profile Release there."
  exit 1
fi

if [ -n "${ATLAS_STAGING_USER:-}" ] && [ -n "${ATLAS_STAGING_PASSWORD:-}" ]; then
  # Basic auth sends the password as it is. Over plain HTTP that is only ever done to this
  # machine (the smoke test's throwaway Caddy).
  if [ "${base%%://*}" != https ] && [ "$this_machine" != 1 ]; then
    echo "STOPPED: the password is not sent over plain HTTP to another machine. Use https://, or leave"
    echo "         ATLAS_STAGING_PASSWORD unset to check only that every path asks for one."
    exit 1
  fi
  # curl reads the pair from a quoted value of its configuration syntax, where a backslash
  # and a double quote must be escaped to mean themselves.
  quoted() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
  account="$(quoted "$ATLAS_STAGING_USER")"
  with() { printf 'user = "%s:%s"\n' "$account" "$(quoted "$ATLAS_STAGING_PASSWORD")" | curl -K - -s --max-time 20 "$@"; }
  shut=0
  page="$(with "$base/")"
  asset="$(printf '%s' "$page" | grep -o '/_next/static/[^"]*\.js' | head -1 || true)"
  [ -n "$asset" ] || { echo "FAIL the page names no static asset to try"; shut=1; }
  for path in "/" "/explore" "/data.md" "/llms.txt" "${asset:-/}" "/api/v1/catalog.json" "/api/health"; do
    got="$(with -o /dev/null -w '%{http_code}' "$base$path" || true)"
    if [ "$got" = 200 ]; then
      echo "ok   200 with the password: $path"
    else
      echo "FAIL $path answered ${got:-nothing} with the password"
      shut=$((shut + 1))
    fi
  done
  wrong="$(printf 'user = "%s:not-the-password"\n' "$account" | curl -K - -s -o /dev/null -w '%{http_code}' --max-time 20 "$base/" || true)"
  if [ "$wrong" = 401 ]; then echo "ok   401 with a wrong password"; else echo "FAIL a wrong password got $wrong"; shut=$((shut + 1)); fi
  [ "$shut" = 0 ] || { echo "FAILED: staging does not answer as it should with the password."; exit 1; }
fi
echo "STAGING AUTH OK: every path asks for the password"
