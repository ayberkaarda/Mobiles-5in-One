#!/usr/bin/env bash
# Takes the Android screenshots in docs/screenshots/mobile (see docs/screenshots/README.md).
#
#   1. create fresh [ÖRNEK] sample data through the API of a running local stack
#   2. reset the app on the emulator, set its language to Turkish, freeze the status bar clock
#   3. drive the app with ops/mobile-screenshots/flow.yaml (Maestro takeScreenshot)
#   4. crop the status bar, resize to 540 px wide, write palette PNGs to the output directory
#
# Prerequisites (apps/mobile/e2e/README.md): the local stack is up and seeded (db:migrate,
# db:seed), one emulator is running with the app installed (a build whose EXPO_PUBLIC_API_URL
# reaches the stack, for example http://localhost:3000 with `adb reverse`), `adb`, `maestro`,
# `node` and Python 3 with Pillow are on PATH.
#
# Usage, from kadro/: ops/take-mobile-screenshots.sh [output-dir]   (default docs/screenshots/mobile)
#
# Optional environment:
#   KADRO_SHOTS_API_URL       API base URL seen from this machine (default http://localhost:3000)
#   KADRO_SHOTS_DB_CONTAINER  database container name (default: the compose postgres service)
#   KADRO_SHOTS_LOCALE        app locale (default tr-TR)
#   PYTHON                    Python interpreter (default python3)
#
# Open calls of earlier runs stay listed on the Eksik Var tab: use a fresh stack for a clean set.
# It clears the app data of app.kadro.mobile on the emulator; nothing else on the device or the
# stack is removed. The run's password exists only in a temporary file deleted on exit.
set -euo pipefail

KADRO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERE="$KADRO_DIR/ops/mobile-screenshots"
OUT_DIR="${1:-$KADRO_DIR/docs/screenshots/mobile}"
LOCALE="${KADRO_SHOTS_LOCALE:-tr-TR}"
PYTHON="${PYTHON:-python3}"
APP_ID=app.kadro.mobile

WORK="$(mktemp -d)"
cleanup() {
  adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1 || true
  rm -f "$WORK/values.env"
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "seeding sample data"
(cd "$KADRO_DIR" && node "$HERE/seed.mjs") >"$WORK/values.env"

echo "resetting the app and setting locale $LOCALE"
adb shell pm clear "$APP_ID" >/dev/null
adb shell cmd locale set-app-locales "$APP_ID" --locales "$LOCALE"

# Fixed clock, full battery, no notification icons (Android System UI demo mode).
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
demo enter
demo clock -e hhmm 1200
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4
demo notifications -e visible false

maestro_args=(test)
while IFS='=' read -r key value; do
  [ -n "$key" ] && maestro_args+=(-e "$key=$value")
done <"$WORK/values.env"
maestro_args+=(--test-output-dir "$WORK/maestro" "$HERE/flow.yaml")

echo "running the screenshot flow"
maestro "${maestro_args[@]}"

raw="$(find "$WORK/maestro" -type d -name takeScreenshot | head -n 1)"
if [ -z "$raw" ]; then
  echo "no screenshots were written" >&2
  exit 1
fi

status_bar="$(adb shell dumpsys window | grep -m 1 -oE 'type=statusBars frame=\[0,0\]\[[0-9]+,[0-9]+\]' | grep -oE '[0-9]+\]$' | tr -d ']')"
status_bar="${status_bar:-0}"
echo "cropping a ${status_bar} px status bar"
"$PYTHON" "$HERE/postprocess.py" "$raw" "$OUT_DIR" "$status_bar" 540
