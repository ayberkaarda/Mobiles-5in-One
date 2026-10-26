#!/usr/bin/env bash
# Self-test for check-vulnerable-packages.py: every fixtures/fail-*.json must be rejected and every
# fixtures/pass-*.json accepted (each fixture describes a two-project solution).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
status=0
for fixture in "$here"/fixtures/*.json; do
  name="$(basename "$fixture")"
  if python3 "$here/check-vulnerable-packages.py" "$fixture" 2 >/dev/null 2>&1; then outcome=pass; else outcome=fail; fi
  case "$name" in
    pass-*) expected=pass ;;
    *) expected=fail ;;
  esac
  if [ "$outcome" = "$expected" ]; then
    echo "ok   $name ($outcome)"
  else
    echo "FAIL $name: expected $expected, got $outcome"
    status=1
  fi
done
exit "$status"
