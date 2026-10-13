#!/usr/bin/env bash
# Behaviour checks of the local Caddy sites (ops/Caddyfile, ADR-0055, ADR-0057, phase 6 review
# F10) against a running compose `caddy` service:
#   1. the plain http listeners redirect to the fixed canonical host, never to a client-supplied
#      Host header
#   2. an unknown /.well-known/ path without an extension answers 404, not the app shell
#   3. the two association files carry `Cache-Control: public, max-age=3600` (needs an upstream on
#      INECEKVAR_WEB_UPSTREAM that answers them; any answer will do)
#   4. an app route without an extension still gets the app shell (200)
#
# Usage: inecekvar/ops/security/caddy-check.sh
# Environment (defaults are the compose host ports):
#   IV_CADDY_WEB_HTTP_PORT=57080  IV_CADDY_APP_HTTP_PORT=57081  IV_CADDY_APP_TLS_PORT=58444
#   IV_CADDY_WEB_CANONICAL_HOST=localhost  IV_CADDY_APP_CANONICAL_HOST=localhost  (what the caddy
#   container got as INECEKVAR_WEB_CANONICAL_HOST and INECEKVAR_APP_CANONICAL_HOST)
# Exit codes: 0 every check holds, 1 a check failed.
set -euo pipefail

web_http="${IV_CADDY_WEB_HTTP_PORT:-57080}"
app_http="${IV_CADDY_APP_HTTP_PORT:-57081}"
app_tls="${IV_CADDY_APP_TLS_PORT:-58444}"
web_host="${IV_CADDY_WEB_CANONICAL_HOST:-localhost}"
app_host="${IV_CADDY_APP_CANONICAL_HOST:-localhost}"
failed=0

check() {
  if [ "$2" = "$3" ]; then
    echo "ok   $1 ($2)"
  else
    echo "FAIL $1: got '$2', expected '$3'"
    failed=1
  fi
}

location() {
  curl -s -o /dev/null -w '%{redirect_url}' -H "Host: $2" "http://127.0.0.1:$1/some/path?q=1"
}

check "web http redirect ignores a foreign Host" "$(location "${web_http}" evil.example)" \
  "https://${web_host}:${IV_CADDY_WEB_TLS_PORT:-58443}/some/path?q=1"
check "app http redirect ignores a foreign Host" "$(location "${app_http}" evil.example)" \
  "https://${app_host}:${app_tls}/some/path?q=1"

status() {
  curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:${app_tls}$1"
}
check "unknown extension-less .well-known path is 404" "$(status /.well-known/change-password)" "404"
check "app route still gets the shell" "$(status /giris/baglanti)" "200"

for file in assetlinks.json apple-app-site-association; do
  cache="$(curl -sk -D - -o /dev/null "https://127.0.0.1:${app_tls}/.well-known/${file}" |
    tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: *//p' | head -n 1)"
  check "Cache-Control of /.well-known/${file}" "${cache}" "public, max-age=3600"
done

[ "${failed}" -eq 0 ] && echo "caddy checks passed" || echo "caddy checks failed"
exit "${failed}"
