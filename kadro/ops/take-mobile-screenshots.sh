#!/usr/bin/env bash
# Takes the Android screenshots in docs/screenshots/mobile (see docs/screenshots/README.md).
#
#   1. create fresh [ÖRNEK] sample data through the API of a running local stack
#   2. for each colour scheme: switch the emulator to light or dark (`cmd uimode night`; the app's
#      Görünüm setting stays on its default, Sistem, so it follows the device), reset the app, set its language to
#      Turkish, freeze the status bar clock
#   3. drive the app with ops/mobile-screenshots/flow.yaml (Maestro takeScreenshot)
#   4. crop the status bar, resize to 540 px wide, write palette PNGs named <step>-<scheme>.png
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
#   KADRO_SHOTS_SCHEMES       colour schemes to capture, in order (default "light dark")
#   PYTHON                    Python interpreter (default python3)
#
# Open calls of earlier runs stay listed on the Eksik Var tab: use a fresh stack for a clean set.
# It clears the app data of app.kadro.mobile on the emulator and restores the emulator's night
# mode on exit; nothing else on the device or the stack is removed. The run's password exists only
# in a temporary file deleted on exit.
set -euo pipefail

KADRO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERE="$KADRO_DIR/ops/mobile-screenshots"
OUT_DIR="${1:-$KADRO_DIR/docs/screenshots/mobile}"
LOCALE="${KADRO_SHOTS_LOCALE:-tr-TR}"
PYTHON="${PYTHON:-python3}"
SCHEMES="${KADRO_SHOTS_SCHEMES:-light dark}"
APP_ID=app.kadro.mobile

for scheme in $SCHEMES; do
  case "$scheme" in
    light | dark) ;;
    *)
      echo "unknown colour scheme: $scheme (use light and/or dark)" >&2
      exit 1
      ;;
  esac
done

# "Night mode: no" / "yes" / "auto" / "custom"; restored on exit.
NIGHT_BEFORE="$(adb shell cmd uimode night | tr -d '\r' | sed -n 's/^Night mode: //p')"

WORK="$(mktemp -d)"
cleanup() {
  adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1 || true
  if [ -n "$NIGHT_BEFORE" ]; then
    adb shell cmd uimode night "$NIGHT_BEFORE" >/dev/null 2>&1 || true
  fi
  rm -f "$WORK/values.env"
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "seeding sample data"
(cd "$KADRO_DIR" && node "$HERE/seed.mjs") >"$WORK/values.env"

maestro_values=()
while IFS='=' read -r key value; do
  [ -n "$key" ] && maestro_values+=(-e "$key=$value")
done <"$WORK/values.env"

demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

for scheme in $SCHEMES; do
  echo "[$scheme] switching the emulator night mode"
  if [ "$scheme" = dark ]; then
    adb shell cmd uimode night yes >/dev/null
  else
    adb shell cmd uimode night no >/dev/null
  fi

  echo "[$scheme] resetting the app and setting locale $LOCALE"
  adb shell pm clear "$APP_ID" >/dev/null
  adb shell cmd locale set-app-locales "$APP_ID" --locales "$LOCALE"

  # Fixed clock, full battery, no notification icons (Android System UI demo mode).
  adb shell settings put global sysui_demo_allowed 1
  demo enter
  demo clock -e hhmm 1200
  demo battery -e level 100 -e plugged false
  demo network -e wifi show -e level 4
  demo notifications -e visible false

  echo "[$scheme] running the screenshot flow"
  maestro test "${maestro_values[@]}" --test-output-dir "$WORK/maestro-$scheme" "$HERE/flow.yaml"

  raw="$(find "$WORK/maestro-$scheme" -type d -name takeScreenshot | head -n 1)"
  if [ -z "$raw" ]; then
    echo "no screenshots were written" >&2
    exit 1
  fi

  status_bar="$(adb shell dumpsys window | grep -m 1 -oE 'type=statusBars frame=\[0,0\]\[[0-9]+,[0-9]+\]' | grep -oE '[0-9]+\]$' | tr -d ']')"
  status_bar="${status_bar:-0}"
  echo "[$scheme] cropping a ${status_bar} px status bar"
  "$PYTHON" "$HERE/postprocess.py" "$raw" "$OUT_DIR" "$status_bar" 540 "-$scheme"
done
