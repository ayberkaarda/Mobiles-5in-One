#!/usr/bin/env bash
# OWASP ZAP baseline (passive scan + spider) against the Web public pages and the admin sign-in, on the compose
# stack in Staging. Fails on any alert that is not accepted in zap-rules.conf (reasons in
# docs/security/scans/zap.md). Needs Docker and openssl; reports land in $ZAP_OUT (default ./zap-out).
# Usage: bash ops/ci/zap/zap-baseline.sh   (from patika/; uses its own compose project and removes it after)
set -euo pipefail
cd "$(dirname "$0")/../../.."
here=ops/ci/zap
project="${ZAP_PROJECT:-patika-zap}"
out="${ZAP_OUT:-$PWD/zap-out}"
# ghcr.io/zaproxy/zaproxy:stable as of 2026-10-16, pinned by digest.
image="ghcr.io/zaproxy/zaproxy@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6"
curl_image="curlimages/curl:8.10.1"
created_env=false
if [ ! -f .env ]; then
  cp .env.example .env
  created_env=true
fi
compose=(docker compose -p "$project" -f docker-compose.yml -f "$here/compose.zap.yml")
# shellcheck disable=SC2329 # invoked through the EXIT trap
cleanup() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ "$created_env" = true ]; then rm -f .env; fi
}
trap cleanup EXIT

# A throwaway ES256 key: Staging refuses the ephemeral development key.
ZAP_JWT_SIGNING_KEY="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 2>/dev/null \
  | openssl pkcs8 -topk8 -nocrypt -outform DER | base64 | tr -d '\n')"
export ZAP_JWT_SIGNING_KEY

"${compose[@]}" up --build --detach --wait api web
network="${project}_default"
ready=false
for _ in $(seq 1 60); do
  if docker run --rm --network "$network" "$curl_image" -fsS -o /dev/null http://web:8080/; then ready=true; break; fi
  sleep 2
done
if [ "$ready" != true ]; then
  "${compose[@]}" logs web api | tail -n 80
  echo "web did not answer on / within 120 s"
  exit 1
fi

mkdir -p "$out"
chmod 777 "$out"
cp "$here/zap-rules.conf" "$out/zap-rules.conf"
status=0
for target in public:/ admin:/admin/giris; do
  name="${target%%:*}"
  path="${target#*:}"
  set +e
  MSYS_NO_PATHCONV=1 docker run --rm --network "$network" -v "$out:/zap/wrk:rw" "$image" \
    zap-baseline.py -t "http://web:8080$path" -c zap-rules.conf -m 3 \
    -r "zap-$name.html" -w "zap-$name.md" -J "zap-$name.json"
  code=$?
  set -e
  echo "zap-baseline $name ($path): exit $code"
  if [ "$code" -ne 0 ]; then status=1; fi
done
exit "$status"
