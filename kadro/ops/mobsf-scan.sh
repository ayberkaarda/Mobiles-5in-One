#!/usr/bin/env bash
# MobSF static analysis of a locally built Android APK.
#
#   1. start a uniquely named MobSF container, published on 127.0.0.1 only
#   2. upload the APK through the REST API with a random API key created for this run
#   3. run the static scan and write the JSON report and scorecard to the output directory
#   4. remove the container by exact name (also on failure or interrupt)
#
# Only the container created by this script is touched, and only with `docker rm -f <exact name>`.
# No volumes are created, no compose, no prune. The API key lives only in this process.
#
# Usage: ops/mobsf-scan.sh <path/to/app.apk> [output-dir]
#
# Optional environment:
#   MOBSF_IMAGE  image to use (default: opensecurity/mobile-security-framework-mobsf:latest)
#   MOBSF_PORT   host port bound on 127.0.0.1 (default: 18000)
set -euo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

APK="${1:?usage: mobsf-scan.sh <apk> [output-dir]}"
OUT="${2:-./mobsf-output}"
IMAGE="${MOBSF_IMAGE:-opensecurity/mobile-security-framework-mobsf:latest}"
PORT="${MOBSF_PORT:-18000}"
NAME="kadro-mobsf-$(date +%s)"
BASE="http://127.0.0.1:${PORT}"
API_KEY="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"

[[ -f "$APK" ]] || { echo "APK not found: $APK" >&2; exit 1; }
mkdir -p "$OUT"
# Native Windows curl does not understand MSYS paths; hand it mixed-style paths there.
if command -v cygpath >/dev/null 2>&1; then
  APK="$(cygpath -m "$APK")"
  OUT="$(cygpath -m "$OUT")"
fi

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

echo "starting $NAME ($IMAGE)"
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8000" -e "MOBSF_API_KEY=${API_KEY}" "$IMAGE" >/dev/null

echo "waiting for MobSF"
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "$BASE/api/v1/scans" -H "Authorization: ${API_KEY}" 2>/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS -o /dev/null "$BASE/api/v1/scans" -H "Authorization: ${API_KEY}"

echo "uploading $(basename "$APK")"
UPLOAD="$(curl -fsS -X POST "$BASE/api/v1/upload" -H "Authorization: ${API_KEY}" -F "file=@${APK}")"
HASH="$(printf '%s' "$UPLOAD" | sed -n 's/.*"hash": *"\([0-9a-f]*\)".*/\1/p')"
[[ -n "$HASH" ]] || { echo "upload failed: $UPLOAD" >&2; exit 1; }

echo "scanning $HASH"
curl -fsS -X POST "$BASE/api/v1/scan" -H "Authorization: ${API_KEY}" --data "hash=${HASH}" \
  --max-time 1800 -o /dev/null
curl -fsS -X POST "$BASE/api/v1/report_json" -H "Authorization: ${API_KEY}" --data "hash=${HASH}" \
  -o "$OUT/mobsf-report.json"
curl -fsS -X POST "$BASE/api/v1/scorecard" -H "Authorization: ${API_KEY}" --data "hash=${HASH}" \
  -o "$OUT/mobsf-scorecard.json"
docker exec "$NAME" sh -c 'cat /home/mobsf/Mobile-Security-Framework-MobSF/mobsf/MobSF/init.py 2>/dev/null | grep -m1 "^VERSION"' \
  >"$OUT/mobsf-version.txt" || true

echo "report: $OUT/mobsf-report.json"
echo "scorecard: $OUT/mobsf-scorecard.json"
