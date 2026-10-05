#!/usr/bin/env bash
# Captures the release screenshots (askida/docs/release/screenshots) from
# integration_test/screenshots_test.dart on an Android emulator, against the
# same local stack as run_e2e.sh (see its header for the stack and .env).
# Raw `adb exec-out screencap -p` frames, light scheme, no frames or edits.
set -euo pipefail
cd "$(dirname "$0")/.."

device="${E2E_DEVICE:-emulator-5554}"
out="../docs/release/screenshots"
log="${E2E_LOG:-$(mktemp)}"
mkdir -p "$out"

adb -s "$device" shell cmd uimode night no >/dev/null
# Clean status bar (Android demo mode): fixed clock, full battery and signal.
adb -s "$device" shell settings put global sysui_demo_allowed 1
demo() { adb -s "$device" shell am broadcast -a com.android.systemui.demo "$@" >/dev/null; }
demo -e command enter
demo -e command clock -e hhmm 0941
demo -e command battery -e level 100 -e plugged false
demo -e command network -e wifi show -e level 4
demo -e command notifications -e visible false

cleanup() {
  demo -e command exit || true
  [ -n "${runner:-}" ] && kill "$runner" 2>/dev/null || true
}
trap cleanup EXIT

E2E_APPROVE_LIKE='%Meydan%' E2E_TEST=integration_test/screenshots_test.dart \
  bash integration_test/run_e2e.sh >"$log" 2>&1 &
runner=$!

taken=0
declare -A seen=()
while kill -0 "$runner" 2>/dev/null; do
  for slug in $(tr '\r' '\n' <"$log" | sed -n 's/.*E2E-STEP SHOT \([0-9a-z-]*\).*/\1/p'); do
    if [ -z "${seen[$slug]:-}" ]; then
      adb -s "$device" exec-out screencap -p >"$out/$slug.png"
      seen[$slug]=1
      echo "captured $slug $(date -u +%H:%M:%SZ)"
      taken=$((taken + 1))
    fi
  done
  sleep 1
done
wait "$runner" && status=0 || status=$?
tr '\r' '\n' <"$log" | grep -E 'E2E-STEP|All tests passed|Some tests failed|Timed out' || true
echo "screenshots: $taken, test exit: $status"
exit "$status"
