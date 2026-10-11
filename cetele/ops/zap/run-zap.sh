#!/usr/bin/env bash
# OWASP ZAP API scan of the Cetele server against the local compose stack (spec item 23).
#
# Usage (from anywhere): cetele/ops/zap/run-zap.sh
# Needs: Docker, the server image (cd cetele/server && ./gradlew jibDockerBuild), curl, sed.
# Environment (all optional):
#   CETELE_ZAP_PROJECT       compose project name         (default cetele-zap)
#   CETELE_ZAP_SERVER_IMAGE  server image tag             (default cetele-server:local)
#   CETELE_SERVER_PORT       host port of the server      (default 60080, as docker-compose.yml)
#   CETELE_ZAP_IMAGE         ZAP image, pinned by digest  (default below)
#   CETELE_ZAP_MAX_MINUTES   active scan cap in minutes   (default 30)
#   CETELE_ZAP_KEEP_STACK    1 leaves the stack running   (default: stack is removed with volumes)
#   CETELE_ZAP_NO_STACK      1 scans an already running server on CETELE_SERVER_PORT
#   CETELE_ZAP_FAIL          1 fails the run on FAIL-NEW and WARN-NEW (default: informational, -I)
#   CETELE_ZAP_HOST_NETWORK  1 runs ZAP in the host network (Linux runners, see below)
# Output: cetele/docs/security/scan-reports/zap/ (HTML, JSON, Markdown; gitignored by the
# scan-reports/.gitignore), the numbers are copied into zap-api-scan.md by hand.
#
# The token belongs to a throw-away user of the scan stack. It is minted at run time through the
# real sign-in flow (OTP with the local echo of the log), masked in CI logs and handed to ZAP
# through the environment only (-e ZAP_AUTH_HEADER_VALUE without a value on the command line).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cetele_dir="$(cd "$here/../.." && pwd)"
project="${CETELE_ZAP_PROJECT:-cetele-zap}"
port="${CETELE_SERVER_PORT:-60080}"
image="${CETELE_ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef}"
max_minutes="${CETELE_ZAP_MAX_MINUTES:-30}"
reports="$cetele_dir/docs/security/scan-reports/zap"
base="http://127.0.0.1:${port}"
export CETELE_SERVER_PORT="$port"
export CETELE_ZAP_SERVER_IMAGE="${CETELE_ZAP_SERVER_IMAGE:-cetele-server:local}"

compose() {
  docker compose -p "$project" -f "$cetele_dir/docker-compose.yml" \
    -f "$here/docker-compose.zap.yml" "$@"
}

cleanup() {
  if [ "${CETELE_ZAP_NO_STACK:-0}" != "1" ] && [ "${CETELE_ZAP_KEEP_STACK:-0}" != "1" ]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "${CETELE_ZAP_NO_STACK:-0}" != "1" ]; then
  compose up -d --wait postgres minio minio-init server
fi

# Sign in as a scan user: OTP request (fake integrity token, accepted only by the local
# profile), read the code from the local echo, verify.
hex="$(od -An -N16 -tx1 /dev/urandom | tr -d '[:space:]')"
device="${hex:0:8}-${hex:8:4}-4${hex:13:3}-8${hex:17:3}-${hex:20:12}"
phone="+905550000042"
curl -fsS -X POST "$base/v1/auth/otp/request" -H 'content-type: application/json' \
  -d "{\"deviceId\":\"$device\",\"phone\":\"$phone\",\"integrityToken\":\"fake.ok\"}" >/dev/null
code=""
for _ in $(seq 1 20); do
  code="$(compose logs --no-color --tail 50 server | sed -n 's/.*LOCAL_ECHO.*giriş kodunuz: \([0-9]\{6\}\)\..*/\1/p' | tail -n 1)"
  [ -n "$code" ] && break
  sleep 1
done
[ -n "$code" ] || { echo "No OTP code found in the server log (CETELE_OTP_LOCAL_ECHO must be true)." >&2; exit 1; }
response="$(curl -fsS -X POST "$base/v1/auth/otp/verify" -H 'content-type: application/json' \
  -d "{\"deviceId\":\"$device\",\"phone\":\"$phone\",\"code\":\"$code\",\"appVersion\":\"zap\",\"model\":\"zap\"}")"
token="$(printf '%s' "$response" | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$token" ] || { echo "Sign-in did not return an access token." >&2; exit 1; }
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$token"
export ZAP_AUTH_HEADER_VALUE="Bearer $token"

mkdir -p "$reports"
chmod 0777 "$reports"
# Inside the repository tree (ignored by git): a temp dir outside it is not mountable on every
# Docker Desktop setup.
work="$reports/work"
rm -rf "$work"
mkdir -p "$work"
cp "$here/api-context.xml" "$here/api-scan.conf" "$work/"
mkdir -p "$work/reports"
chmod -R 0777 "$work"

fail_flag="-I"
[ "${CETELE_ZAP_FAIL:-0}" != "1" ] || fail_flag=""

# The server port is published on 127.0.0.1 only. Docker Desktop forwards host.docker.internal to
# the host loopback, a Linux engine does not: host-gateway is the bridge address, where nothing
# listens, and every request of the scan was refused (CI run 38128569625). On Linux the ZAP
# container therefore shares the host network and host.docker.internal names 127.0.0.1, so the
# scan context and the 127.0.0.1 binding stay as they are.
net_args=(--add-host=host.docker.internal:host-gateway)
if [ "${CETELE_ZAP_HOST_NETWORK:-0}" = "1" ]; then
  net_args=(--network host --add-host=host.docker.internal:127.0.0.1)
fi
# Fail fast and readably when the scan container cannot reach the server: otherwise ZAP imports
# no URL and ends with "NoUrlsException", exit 3.
if ! docker run --rm "${net_args[@]}" --entrypoint curl "$image" -fsS -o /dev/null \
  "http://host.docker.internal:${port}/actuator/health"; then
  echo "The ZAP container cannot reach http://host.docker.internal:${port} (see CETELE_ZAP_HOST_NETWORK)." >&2
  exit 1
fi

set +e
# shellcheck disable=SC2086
# MSYS_NO_PATHCONV: Git Bash on Windows would rewrite the "/zap/wrk" container paths.
MSYS_NO_PATHCONV=1 docker run --rm "${net_args[@]}" \
  -e ZAP_AUTH_HEADER_VALUE -e ZAP_AUTH_HEADER=Authorization \
  -e ZAP_AUTH_HEADER_SITE=host.docker.internal \
  -v "$work:/zap/wrk:rw" -v "$cetele_dir/docs/api:/zap/api:ro" "$image" \
  zap-api-scan.py -t /zap/api/openapi.json -f openapi $fail_flag \
  -O "http://host.docker.internal:${port}" -n api-context.xml -c api-scan.conf \
  -r reports/zap-api.html -J reports/zap-api.json -w reports/zap-api.md \
  -z "-config scanner.threadPerHost=4 -config scanner.maxScanDurationInMins=${max_minutes}"
status=$?
set -e

cp "$work"/reports/* "$reports"/ 2>/dev/null || true
rm -rf "$work"
echo "ZAP exit status: $status; reports in $reports"
exit "$status"
