# ADR-0001: Stack and resolved versions

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec rule 0.8 requires the latest stable versions at scaffold time, pinned through the Gradle
version catalogs and the Spring BOM, with the resolved versions recorded here. The versions below
were resolved on 2026-10-05 from the published compatibility pages, Maven Central, Google Maven,
the Gradle Plugin Portal and Docker Hub, and were then built and tested in the Phase 0 scaffolds of
`cetele/android` and `cetele/server`. Where a number was not checked against a registry it is not
listed.

The development machine has Temurin 21 and Temurin 26 installed. The default `JAVA_HOME` is
Temurin 26, which is outside the tested window of the Kotlin Gradle plugin and of the Android
Gradle Plugin; the Gradle daemon must not run on it.

## Decision

### Toolchain (both Gradle roots)

| Item                  | Version / setting                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JDK                   | Toolchain 21 in both roots (`kotlin { jvmToolchain(21) }`), resolved by `foojay-resolver-convention` 1.0.0; Temurin 21.0.12 locally |
| Gradle                | 9.7.0 wrapper in each root, `distributionSha256Sum` `84fbba45c7f4c64abc77460e1c00f541e9f960e3c7ed2538f1ede19eacd873ae`              |
| Kotlin                | 2.4.20 (current; its plugin is tested with Gradle up to 9.7.0 and AGP up to 9.3.1)                                                  |
| Android Gradle Plugin | 9.3.3 (AGP 9.4 needs Gradle 9.6 or newer and lies outside the Kotlin 2.4.20 tested window)                                          |
| Android bytecode      | `jvmTarget` and `compileOptions` 17; the toolchain 21 compiles it                                                                   |
| Android SDK levels    | `minSdk` 26, `targetSdk` 36, `compileSdk` 37 (see "Deviation")                                                                      |
| ktlint                | Gradle plugin 14.2.0, ktlint 1.8.0 in both roots                                                                                    |
| detekt (android)      | 1.23.8, latest stable (2.0 is alpha); its own Kotlin is pinned to 2.0.21 on the `detekt` configuration                              |

### Server (`cetele/server`)

| Item                    | Version / setting                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spring Boot             | 4.1.1, the latest GA (4.2.0-M2 is a milestone and is not used)                                                                                                                     |
| Starters                | `spring-boot-starter-` webmvc, security, data-jpa, flyway, validation, actuator, thymeleaf; tests: starter-test, webmvc-test, security-test, `spring-boot-testcontainers`          |
| Flyway                  | 12.4.0 with `flyway-database-postgresql` 12.4.0, as managed by Boot 4.1 (Central has 13.9.0, not used)                                                                             |
| Testcontainers          | 2.0.5 (`testcontainers-postgresql`, `testcontainers-junit-jupiter`)                                                                                                                |
| Hibernate / Jackson     | 7.4.5.Final / 3.1.5 (`tools.jackson.module:jackson-module-kotlin`)                                                                                                                 |
| PostgreSQL JDBC / JUnit | 42.7.13 / 6.0.3                                                                                                                                                                    |
| Kotlin BOM              | `kotlin-bom` 2.4.20 as a platform; the Boot BOM pins Kotlin 2.3.21 and is overridden upward                                                                                        |
| Jib Gradle plugin       | 3.5.4; base image `eclipse-temurin:21-jre-noble@sha256:000fd431958bc81a24abe1e8e5f0f0fd3ae365a594bd50aadb20696805f9408c`, user 65532:65532, port 8080, image `cetele-server:local` |

### Android (`cetele/android`)

| Item                              | Version                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| KSP / Hilt / androidx.hilt        | 2.3.12 / 2.60.1 / 1.4.0                                                                                    |
| Compose BOM                       | 2026.09.00 (Compose 1.12.1); activity-compose 1.13.0                                                       |
| AndroidX                          | core-ktx 1.19.1, lifecycle 2.11.0, navigation 2.10.2, DataStore 1.2.1, WorkManager 2.12.0, biometric 1.1.0 |
| Room / androidx.sqlite            | 2.8.5 / 2.7.1                                                                                              |
| SQLCipher                         | `net.zetetic:sqlcipher-android` 4.19.1                                                                     |
| Ktor / serialization / coroutines | 3.6.0 (OkHttp engine, OkHttp 5.5.0) / 1.11.0 / 1.11.0                                                      |
| Coil                              | 3.6.3 (catalog only in Phase 0)                                                                            |
| Test libraries                    | JUnit BOM 6.1.3, MockK 1.14.11, Turbine 1.2.1                                                              |

Biometric and Coil are in the catalog only; no Phase 0 class needs them.

### Local images (`cetele/docker-compose.yml`)

| Service      | Image                                      | Note                                                                    |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| `postgres`   | `postgres:16.15-alpine`                    | Latest 16.x on Docker Hub; init SQL creates `cetele_test`.              |
| `minio`      | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | See "MinIO images".                                                     |
| `minio-init` | `pgsty/mc:RELEASE.2026-09-16T00-00-00Z`    | Creates the private bucket `cetele-media` and sets no anonymous policy. |
| `mailpit`    | `axllent/mailpit:v1.31.4`                  | Latest tag; optional for Phase 4 and Phase 6 alert mail.                |
| `server`     | `cetele-server:local`                      | Built by `./gradlew jibDockerBuild`.                                    |

### Brand fonts

Google Fonts ships only variable files, so static instances were cut with fontTools 4.66.1
(`varLib.instancer`) from pinned commits of `google/fonts`:

- Manrope: `ofl/manrope/Manrope[wght].ttf` at commit `b31870aff700ab7a1d74fa0c6887d95beb9e0037`
  (2026-09-14), instanced at weight 700.
- Inter: `ofl/inter/Inter[opsz,wght].ttf` at commit `0b58fb370093f9a9f4ff785d94405710b79de67c`
  (2026-03-03), instanced at weights 400, 500 and 600 with `opsz` 14.
- Licence: SIL Open Font License 1.1 for both families. The copyright lines show no Reserved Font
  Name. The licence texts are in `cetele/brand/fonts/`; the file checksums are in
  `cetele/brand/tokens.json` and checked by `validate-tokens.mjs`.

### CI actions

`gradle/actions/setup-gradle` and `gradle/actions/wrapper-validation` v6.4.0, an annotated tag
dereferenced to commit `3f5f9adaf7d9fecd50b5935e54106014257a94e6`. Other action commits and
gitleaks 8.30.1 are reused from the Askida workflow. Details are in `.github/workflows/cetele-ci.yml`.

### Decisions inside the stack

1. **Spring Boot 4.1 supersedes "Spring Boot 3".** The spec text says Spring Boot 3, but spec rule
   0.8 asks for the latest stable. Open-source support for Spring Boot 3.5 ended on 2026-06-30, so a
   new project would start on an unsupported line. Boot 4 renamed several starters
   (`spring-boot-starter-webmvc`, `-flyway`, `-webmvc-test`, ...); each name was checked against the
   4.1.1 BOM, not taken from memory.
2. **The Boot BOM is applied as a Gradle platform**, `platform(SpringBootPlugin.BOM_COORDINATES)`,
   and not through the `io.spring.dependency-management` plugin. With that plugin the BOM property
   `kotlin.version` rewrote the Kotlin compiler of the ktlint configuration and ktlint crashed
   (`Extensions storage is not registered`). A platform only affects the configurations it is added
   to.
3. **Gradle 9.7.0 rather than the newest 9.8.0.** Kotlin 2.4.20 is tested only up to Gradle 9.7.0.
   If a newer Kotlin plugin widens the window, the wrappers and AGP may move up inside the new
   published window and the change is recorded in a later ADR.
4. **JDK 21 toolchain in both roots**, with Android modules compiled to bytecode 17. Machine default
   JDK 26 is outside the plugin windows.
5. **Room needs one table.** Room rejects a database with no entity, so `CeteleDatabase` holds a
   single table, `sync_cursor` (schema exported to `core/data/schemas`), which also belongs to the
   sync engine of Phase 3. Key management for SQLCipher is Phase 3.
6. **The Android Proto DataStore** (`UserSettings`) is encoded with kotlinx-serialization-protobuf,
   so no `protoc` code generation is needed.
7. **The server health endpoint** exposes only `{"status":"UP"}` with probes and details disabled;
   every other path is denied by default. Authentication and authorization arrive in Phase 1.
8. **The `gradlew` scripts** are the stock Gradle wrapper scripts and contain the tool header
   "generated by Gradle". This is a tool file header, not authored text; scans for such wording
   exclude `gradlew`, `gradlew.bat` and the wrapper jar, like lockfile tool headers.

## Deviation: `compileSdk` 37

The spec and the contract planned `compileSdk` 36. The first gate run failed at
`:app:checkDebugAarMetadata` because 17 current stable dependencies declare `minCompileSdk` 37
(Compose 1.12.1 through the BOM, core-ktx 1.19.1, lifecycle 2.11.0, navigation 2.10.2 and OkHttp
5.5.0 through Ktor 3.6.0). Options were `compileSdk` 37 with `targetSdk` 36, or `compileSdk` 36 with
older pinned libraries, which would break rule 0.8. The first was chosen: AGP 9.3.3 builds it with
no warning and the SDK has `android-37.0`. `targetSdk` stays 36 and `minSdk` stays 26. The value is
one constant, `COMPILE_SDK` in the convention plugin `KotlinAndroid.kt`.

## MinIO images

The compose file uses the community images `pgsty/minio` and `pgsty/mc`, the pullable images that
the Askida project resolved, at the latest release tags found on Docker Hub on 2026-10-05. The
status of the upstream `minio/minio` and `minio/mc` images was not re-checked for this project.
MinIO is a local stand-in for Cloudflare R2 only; production uses R2 (see
[ADR-0002](0002-hosting.md)). The images were not compared against R2 behaviour.

## Consequences

- The build is reproducible: wrappers carry a checksum, catalogs pin versions and the Jib base
  image is pinned by digest.
- Staying one Gradle minor below the newest means a later bump is a conscious change.
- Jib 3.5.4 prints a Gradle 10 deprecation (`Task.project` at execution time) and is incompatible
  with the configuration cache. Revisit when a newer Jib is released.
- detekt 1.23.8 has no official Kotlin 2.4 support; it runs without type resolution. The Phase 3
  rule that bans `Double` for amounts needs detekt 2.x when it is stable.
- Evidence: the Phase 0 reports record `./gradlew check` in `cetele/server` (65 tests, 0 failed),
  and `./gradlew ktlintCheck detekt :app:testDebugUnitTest :app:assembleDebug` in `cetele/android`
  (build successful). The docs worker re-ran only the permission test (see the verification matrix).
