# ADR-0001: Stack and resolved versions

- Status: Accepted
- Date: 2026-10-03
- Deciders: Ayberk (owner)

## Context

The specification fixes the stack (Flutter app, Laravel server, PostgreSQL with PostGIS, Redis) and
sets version floors: Flutter 3 and Dart 3, Laravel 11, PHP 8.3, Filament 3, PostgreSQL 16. It asks
for the latest stable version at scaffold time and for the resolved versions to be recorded here.
Versions are pinned by `pubspec.lock` and `composer.lock`. The values below were read from the
Phase 0 scaffolds and local runs on 2026-10-03 and 2026-10-04.

## Decision

Use the latest stable releases that satisfy the floors, pinned as listed. Choices that deviate from
a default or that need explanation:

1. PHP runs only inside Docker. The host PHP is 8.2 while the specification asks for 8.3 or newer,
   so every PHP, Composer and Artisan command runs in the compose services.
2. Laravel 13.34.0 with Filament 3.3.55 (Livewire 3.8.10). Filament 3.3 supports Laravel 13; a
   newer Filament major exists but the specification says Filament 3.
3. `postgis/postgis:16-3.5` ships PostgreSQL 16.9 and PostGIS 3.5.2. A `16-3.6` tag does not exist.
4. MinIO. The official `minio/minio` and `minio/mc` images (Docker Hub) and the `quay.io/minio/*`
   images could not be pulled. Local compose therefore uses the community fork images
   `pgsty/minio` and `pgsty/mc` (AGPLv3), for local development only. Production object storage is
   Cloudflare R2 (S3-compatible). Switching the image back is a one-line change in
   `docker-compose.yml`; another S3-compatible service could also replace it.
5. The Flutter SDK location is a developer machine detail and is not recorded; only the version is.
6. iOS flavors and the iOS build are not exercised (no macOS). The iOS folder comes from the
   Flutter tool, and the Swift attestation channel file was never compiled.
7. `pubspec.lock` starts with the standard header line that pub writes. It is committed exactly as
   pub writes it, because removing the line is undone by the next `pub get`.
8. The Android build needed NDK 28.2.13676358 installed outside the repository. Android Gradle
   Plugin 9 turns `resValue` off, so the flavor app name is set through manifest placeholders.
9. `composer.json` declares the license `proprietary` (see Open points).
10. Packages deferred, with the phase that adds them:
    - Phase 4 (Flutter): `riverpod_annotation`, `riverpod_generator`, `build_runner`,
      `go_router_builder`, `freezed` (with `freezed_annotation`), `json_serializable` (with
      `json_annotation`), `drift` (with `drift_dev`, `sqlite3_flutter_libs`), `dio`,
      `flutter_secure_storage`, `mobile_scanner`, `qr_flutter`, `flutter_map` (and
      `flutter_map_pmtiles` if ADR-0003 needs it), `geolocator`, `webview_flutter`. They are
      either code generators or runtime features without a Phase 0 screen.
    - Later server phases: `league/flysystem-aws-s3-v3` (the S3 disks are configured but the
      adapter is not installed; needed for documents in Phase 2) and `sentry/sentry-laravel`
      (only the config key exists).
11. Tests and checks: Pest with `failOnSkipped`, `failOnRisky` and `failOnWarning` enabled in
    phpunit, so a skipped test fails the run; Larastan at level 8; Pint (`--test`); for the app
    `flutter analyze`, `flutter test` and `dart format --set-exit-if-changed`.

### Server and infrastructure

| Component                  | Version or image                             | Note                                                                             |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| PHP                        | 8.3.35 (`php:8.3-fpm-bookworm`)              | extensions: pdo_pgsql, pgsql, redis, intl, gd, exif, zip, bcmath, pcntl, opcache |
| Composer                   | 2.10.3 (`composer:2`)                        |                                                                                  |
| nginx                      | 1.22.1 (Debian package)                      | same container as php-fpm                                                        |
| Laravel framework          | 13.34.0                                      |                                                                                  |
| Filament                   | 3.3.55                                       | Livewire 3.8.10                                                                  |
| Horizon                    | 5.50.0                                       |                                                                                  |
| Sanctum                    | 4.3.3                                        |                                                                                  |
| spatie/laravel-permission  | 8.3.0                                        |                                                                                  |
| spatie/laravel-activitylog | 4.12.3                                       |                                                                                  |
| spatie/laravel-backup      | 10.3.3                                       |                                                                                  |
| bepsvpt/secure-headers     | 9.1.1                                        | default configuration only                                                       |
| Pest                       | 4.7.8                                        | pest-plugin-laravel 4.1.0, PHPUnit 12.5.33                                       |
| Larastan                   | 3.12.2                                       | PHPStan 2.2.16, level 8                                                          |
| Pint                       | 1.32.1                                       |                                                                                  |
| PostgreSQL                 | 16.9 (`postgis/postgis:16-3.5`)              | image base is Debian bullseye                                                    |
| PostGIS                    | 3.5.2                                        |                                                                                  |
| Redis                      | 7.4.11 (`redis:7.4.11-alpine`)               |                                                                                  |
| MinIO server               | RELEASE.2026-08-04T00-00-00Z (`pgsty/minio`) | community fork, AGPLv3, local only                                               |
| MinIO client               | RELEASE.2026-09-16T00-00-00Z (`pgsty/mc`)    | bucket init job                                                                  |
| Mailpit                    | 1.31.4 (`axllent/mailpit:v1.31.4`)           |                                                                                  |
| Docker Engine (host)       | 29.7.2                                       |                                                                                  |

### Flutter app and Android toolchain

| Item                                | Version                 |
| ----------------------------------- | ----------------------- |
| Flutter                             | 3.47.6 stable           |
| Dart                                | 3.13.5 (`sdk: ^3.13.5`) |
| flutter_riverpod / riverpod         | 3.4.3 / 3.4.3           |
| go_router                           | 18.0.2                  |
| intl                                | 0.20.3                  |
| flutter_localizations, flutter_test | from the SDK            |
| very_good_analysis (dev)            | 11.0.0                  |
| Gradle wrapper                      | 9.3.1                   |
| Android Gradle Plugin               | 9.1.0                   |
| Kotlin Gradle plugin                | 2.4.0                   |
| compileSdk / targetSdk / minSdk     | 36 / 36 / 24            |
| NDK                                 | 28.2.13676358           |
| Java and Kotlin target              | 17                      |

### Brand and fonts

Superseded by ADR-0007 (the font rows below describe the earlier direction).

| Item                 | Value                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| Display font         | Fraunces, weights 600 and 700, static TTF instances, SIL OFL              |
| Body font            | Nunito Sans, weights 400 and 600, static TTF instances, SIL OFL           |
| Font source          | the `google/fonts` repository (`ofl/fraunces`, `ofl/nunitosans`)          |
| Instancing tool      | fontTools 4.66.1                                                          |
| Turkish glyph check  | the Turkish letters and the lira sign are present in all four font files  |
| Tokens and validator | `brand/tokens.json`, `node brand/scripts/validate-tokens.mjs` (Node only) |
| Web font format      | WOFF2 not produced yet; the TTF files ship as they are                    |
| Icon set             | Lucide (ISC), recorded in the brand README                                |

## Consequences

- A clean machine needs Docker for the server and the Flutter SDK 3.47.6 for the app; no host PHP.
- Local compose depends on a community MinIO fork. Local object-storage behaviour is proven against
  the fork, not against R2 (see ADR-0006, gate G8).
- The Android debug build is verified; iOS is not (ADR-0006, gate G11).
- CI needs the NDK version above; if the runner image lacks it, the job installs it explicitly.
- Upgrades happen by changing the lock files and amending this record or superseding it.

## Open points for the owner

- Confirm the `composer.json` license value `proprietary` (the Laravel skeleton default was MIT).
- Decide whether to keep the community MinIO fork for local use or move to another S3-compatible
  service.
- Pinning `composer:2` and `mlocati/php-extension-installer:2` to exact tags or digests is planned
  for Phase 6.
