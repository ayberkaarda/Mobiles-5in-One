# Askıda app

Flutter app for donors, merchants and anonymous recipients (flavors `dev` and `prod`; Turkish first, English second).

Setup: `bash tool/codegen.sh` (pub get + build_runner; freezed/json/drift sources are built locally, never committed), then copy `env/example.json` to `env/dev.json` (only key: `API_BASE_URL`).
Checks (after codegen): `flutter analyze` · `flutter test` · `dart format --set-exit-if-changed .`
Android build: `flutter build apk --debug --flavor dev --dart-define-from-file=env/example.json` (iOS needs macOS and is not built here).
