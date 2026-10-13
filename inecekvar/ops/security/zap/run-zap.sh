#!/usr/bin/env bash
# OWASP ZAP scans of Inecek Var through the local Caddy stack over https (spec item 23, ADR-0055).
#
# Usage: inecekvar/ops/security/zap/run-zap.sh [web|pwa|api|all]   (default all)
#   web  zap-baseline.py on the Angular SSR site   https://host.docker.internal:58443/
#   pwa  zap-baseline.py on the PWA site            https://host.docker.internal:58444/
#   api  zap-api-scan.py with docs/api/openapi.json  https://host.docker.internal:58445 (API site)
#
# Needs a running stack (the script does not start host processes):
#   - compose services postgres, redis, minio, mailpit and caddy (docker-compose.yml), with
#     INECEKVAR_API_UPSTREAM naming the API below and the PWA build in dist/apps/mobile/browser;
#   - the API (uvicorn) with INECEKVAR_REQUIRE_HTTPS=true, migrated and seeded;
#   - the SSR server (`node dist/apps/web/server/server.mjs`, INECEKVAR_ENV=production) on the
#     INECEKVAR_WEB_UPSTREAM port with IV_WEB_CANONICAL_ORIGIN=https://host.docker.internal:58443.
# docs/security/scan-reports/zap-scans.md records the exact commands of the recorded run.
#
# Environment (all optional):
#   IV_ZAP_IMAGE        ZAP image, pinned by digest       (default below)
#   IV_ZAP_WEB_PORT     host https port of the web site   (default 58443)
#   IV_ZAP_APP_PORT     host https port of the PWA site   (default 58444)
#   IV_ZAP_API_PORT     host https port of the API site   (default 58445)
#   IV_ZAP_MAIL         Mailpit web origin for the scan account's sign-in link
#                       (default http://127.0.0.1:57825)
#   IV_ZAP_MAX_MINUTES  active scan cap of the API scan   (default 12: the access token lives 15)
#   IV_ZAP_FAIL         1 fails the run on FAIL and WARN  (default: informational, -I)
#   IV_ZAP_GENERATE     1 also writes the full rule list of each scan (-g) next to the reports,
#                       the starting point of baseline.conf and api-scan.conf
#   IV_ZAP_HOST_NETWORK 1 runs ZAP in the host network (Linux engines, where host-gateway is the
#                       bridge address and the 127.0.0.1-bound ports are not reachable)
# Output: docs/security/scan-reports/zap/ (HTML, JSON, Markdown; ignored by git). The numbers are
# copied by hand into docs/security/scan-reports/zap-scans.md.
#
# The API scan signs in as a throw-away account of the scan stack: registration in bearer mode,
# the sign-in link read from Mailpit, verification. The access token goes to ZAP through the
# environment only (-e ZAP_AUTH_HEADER_VALUE without a value on the command line) and is never
# written to a file.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$here/../../.." && pwd)"
mode="${1:-all}"
image="${IV_ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef}"
web_port="${IV_ZAP_WEB_PORT:-58443}"
app_port="${IV_ZAP_APP_PORT:-58444}"
api_port="${IV_ZAP_API_PORT:-58445}"
mail="${IV_ZAP_MAIL:-http://127.0.0.1:57825}"
max_minutes="${IV_ZAP_MAX_MINUTES:-12}"
reports="$project_dir/docs/security/scan-reports/zap"
scan_host="host.docker.internal"

case "$mode" in
  web | pwa | api | all) ;;
  *) echo "usage: run-zap.sh [web|pwa|api|all]" >&2; exit 2 ;;
esac

net_args=(--add-host="${scan_host}:host-gateway")
if [ "${IV_ZAP_HOST_NETWORK:-0}" = "1" ]; then
  net_args=(--network host --add-host="${scan_host}:127.0.0.1")
fi
fail_flag="-I"
[ "${IV_ZAP_FAIL:-0}" != "1" ] || fail_flag=""

mkdir -p "$reports"
# Inside the repository tree (ignored by git): a temporary directory outside it is not mountable
# on every Docker Desktop setup.
work="$reports/work"
rm -rf "$work"
mkdir -p "$work/reports"
cp "$here/baseline.conf" "$here/api-scan.conf" "$here/api-context.xml" "$work/"
chmod -R 0777 "$work"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

reachable() {
  if ! docker run --rm "${net_args[@]}" --entrypoint curl "$image" -fsSk -o /dev/null "$1"; then
    echo "The ZAP container cannot reach $1 (see IV_ZAP_HOST_NETWORK and the stack notes)." >&2
    exit 1
  fi
}

zap() {
  # MSYS_NO_PATHCONV: Git Bash on Windows would rewrite the /zap/wrk container paths.
  MSYS_NO_PATHCONV=1 docker run --rm "${net_args[@]}" "$@"
}

overall=0
gen() { [ "${IV_ZAP_GENERATE:-0}" != "1" ] || printf -- '-g reports/full-rules-%s.conf' "$1"; }
baseline() {
  local name="$1" url="$2"
  reachable "$url"
  set +e
  # shellcheck disable=SC2086
  zap -v "$work:/zap/wrk:rw" "$image" zap-baseline.py -t "$url" $fail_flag -c baseline.conf $(gen "$name") \
    -m 3 -r "reports/zap-$name.html" -J "reports/zap-$name.json" -w "reports/zap-$name.md"
  local status=$?
  set -e
  echo "ZAP baseline $name exit status: $status"
  [ "$status" -eq 0 ] || overall="$status"
}

api_token() {
  local base="https://127.0.0.1:${api_port}/v1" hex email password token="" id link response
  hex="$(od -An -N8 -tx1 /dev/urandom | tr -d '[:space:]')"
  email="zapscan-${hex}@example.com"
  password="zap-scan-${hex}-Aa1!"
  curl -fsSk -X POST "$base/auth/register" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"mode\":\"bearer\"}" >/dev/null
  for _ in $(seq 1 30); do
    id="$(curl -fsS "$mail/api/v1/search?query=to:%22${email}%22" |
      sed -n 's/.*"ID":"\([^"]*\)".*/\1/p' | head -n 1)"
    if [ -n "$id" ]; then
      link="$(curl -fsS "$mail/api/v1/message/$id" |
        sed -n 's/.*#token=\([A-Za-z0-9_-]*\).*/\1/p' | head -n 1)"
      [ -z "$link" ] || break
    fi
    sleep 1
  done
  [ -n "${link:-}" ] || { echo "No sign-in link for the scan account in Mailpit ($mail)." >&2; exit 1; }
  response="$(curl -fsSk -X POST "$base/auth/magic-link/verify" -H 'content-type: application/json' \
    -d "{\"token\":\"$link\",\"password\":\"$password\",\"mode\":\"bearer\"}")"
  token="$(printf '%s' "$response" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$token" ] || { echo "Verification returned no access token." >&2; exit 1; }
  [ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$token"
  printf '%s' "$token"
}

api_scan() {
  reachable "https://${scan_host}:${api_port}/v1/health"
  local token
  token="$(api_token)"
  export ZAP_AUTH_HEADER_VALUE="Bearer $token"
  set +e
  # shellcheck disable=SC2086
  zap -e ZAP_AUTH_HEADER_VALUE -e ZAP_AUTH_HEADER=Authorization -e ZAP_AUTH_HEADER_SITE="$scan_host" \
    -v "$work:/zap/wrk:rw" -v "$project_dir/docs/api:/zap/api:ro" "$image" \
    zap-api-scan.py -t /zap/api/openapi.json -f openapi $fail_flag \
    -O "https://${scan_host}:${api_port}" -n api-context.xml -c api-scan.conf $(gen api) \
    -r reports/zap-api.html -J reports/zap-api.json -w reports/zap-api.md \
    -z "-config scanner.threadPerHost=4 -config scanner.maxScanDurationInMins=${max_minutes}"
  local status=$?
  set -e
  unset ZAP_AUTH_HEADER_VALUE
  echo "ZAP API scan exit status: $status"
  [ "$status" -eq 0 ] || overall="$status"
}

if [ "$mode" = web ] || [ "$mode" = all ]; then baseline web "https://${scan_host}:${web_port}/"; fi
if [ "$mode" = pwa ] || [ "$mode" = all ]; then baseline pwa "https://${scan_host}:${app_port}/"; fi
if [ "$mode" = api ] || [ "$mode" = all ]; then api_scan; fi

cp "$work"/reports/* "$reports"/ 2>/dev/null || true
echo "Reports in $reports; overall status $overall"
exit "$overall"
