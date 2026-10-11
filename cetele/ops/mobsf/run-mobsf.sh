#!/usr/bin/env bash
# MobSF static analysis of the Cetele debug APK (spec item 23, mobile part).
#
# Usage: cetele/ops/mobsf/run-mobsf.sh [path/to/app-debug.apk]
# Build the APK first (JDK 21):
#   cd cetele/android && ./gradlew --offline :app:assembleDebug
# Needs Docker, curl, sed. The container is local and removed at the end; the API key is random
# per run and is never written to a file. Reports go to docs/security/scan-reports/mobsf/ (ignored
# by git); the numbers are copied by hand into docs/security/scan-reports/mobsf-static.md.
# Environment: CETELE_MOBSF_PORT (default 61800), CETELE_MOBSF_IMAGE (digest pinned below),
# CETELE_MOBSF_SUFFIX (report directory suffix, for example -release).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cetele_dir="$(cd "$here/../.." && pwd)"
apk="${1:-$cetele_dir/android/app/build/outputs/apk/debug/app-debug.apk}"
port="${CETELE_MOBSF_PORT:-61800}"
image="${CETELE_MOBSF_IMAGE:-opensecurity/mobile-security-framework-mobsf@sha256:83bc8aaf940d66344b7c10ebc12e921086bec43369a8259582e6dc258f2924b0}"
out="$cetele_dir/docs/security/scan-reports/mobsf${CETELE_MOBSF_SUFFIX:-}"
name="cetele-mobsf-$$"
key="$(od -An -N24 -tx1 /dev/urandom | tr -d '[:space:]')"
base="http://127.0.0.1:${port}"

[ -f "$apk" ] || { echo "APK not found: $apk" >&2; exit 1; }
mkdir -p "$out"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -p "127.0.0.1:${port}:8000" -e MOBSF_API_KEY="$key" "$image" >/dev/null
for _ in $(seq 1 120); do
  curl -fsS -o /dev/null "$base/" 2>/dev/null && break
  sleep 2
done

upload="$(curl -fsS -F "file=@${apk}" -H "Authorization: $key" "$base/api/v1/upload")"
hash="$(printf '%s' "$upload" | sed -n 's/.*"hash"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')"
[ -n "$hash" ] || { echo "Upload failed: $upload" >&2; exit 1; }

curl -fsS -X POST -H "Authorization: $key" --data "hash=$hash" "$base/api/v1/scan" > "$out/scan.json"
curl -fsS -X POST -H "Authorization: $key" --data "hash=$hash" "$base/api/v1/report_json" > "$out/report.json"
curl -fsS -X POST -H "Authorization: $key" --data "hash=$hash" "$base/api/v1/scorecard" > "$out/scorecard.json"
echo "MobSF hash: $hash; reports in $out"
