#!/usr/bin/env bash
# MobSF static analysis of the Inecek Var Android APK (spec item 23, mobile part; ADR-0055).
#
# Usage: inecekvar/ops/security/mobsf/run-mobsf.sh [path/to/app.apk]
# Build the APK first (JDK 21, ADR-0036; the APK is never committed):
#   pnpm nx build mobile && (cd apps/mobile && npx cap sync android)
#   cd apps/mobile/android && JAVA_HOME=<jdk-21> ./gradlew --offline assembleDebug
# Needs Docker, curl and sed. The container listens on 127.0.0.1 only and is removed at the end;
# the API key is random per run and never written to a file. Reports go to
# docs/security/scan-reports/mobsf<suffix>/ (ignored by git); the numbers are copied by hand into
# docs/security/scan-reports/mobsf-static.md.
# Environment: IV_MOBSF_PORT (default 58800), IV_MOBSF_IMAGE (digest pinned below),
# IV_MOBSF_SUFFIX (report directory suffix, for example -before).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$here/../../.." && pwd)"
apk="${1:-$project_dir/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk}"
port="${IV_MOBSF_PORT:-58800}"
image="${IV_MOBSF_IMAGE:-opensecurity/mobile-security-framework-mobsf@sha256:83bc8aaf940d66344b7c10ebc12e921086bec43369a8259582e6dc258f2924b0}"
out="$project_dir/docs/security/scan-reports/mobsf${IV_MOBSF_SUFFIX:-}"
name="inecekvar-mobsf-$$"
key="$(od -An -N24 -tx1 /dev/urandom | tr -d '[:space:]')"
base="http://127.0.0.1:${port}"

[ -f "$apk" ] || { echo "APK not found: $apk" >&2; exit 1; }
mkdir -p "$out"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" -p "127.0.0.1:${port}:8000" -e MOBSF_API_KEY="$key" "$image" >/dev/null
ready=0
for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null "$base/" 2>/dev/null; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "MobSF did not start on $base" >&2; exit 1; }

upload="$(curl -fsS -F "file=@${apk}" -H "Authorization: $key" "$base/api/v1/upload")"
hash="$(printf '%s' "$upload" | sed -n 's/.*"hash"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p')"
[ -n "$hash" ] || { echo "Upload failed: $upload" >&2; exit 1; }

curl -fsS -X POST -H "Authorization: $key" --data "hash=$hash" "$base/api/v1/scan" > "$out/scan.json"
curl -fsS -X POST -H "Authorization: $key" --data "hash=$hash" "$base/api/v1/report_json" > "$out/report.json"
curl -fsS -X POST -H "Authorization: $key" --data "hash=$hash" "$base/api/v1/scorecard" > "$out/scorecard.json"
echo "MobSF hash: $hash; reports in $out"
