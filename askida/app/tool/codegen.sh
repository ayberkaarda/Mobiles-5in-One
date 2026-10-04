#!/usr/bin/env bash
# Builds the freezed, json_serializable and drift sources. They are not
# committed; run this after every checkout and before analyze or test.
set -euo pipefail
cd "$(dirname "$0")/.."
flutter pub get
dart run build_runner build --delete-conflicting-outputs
