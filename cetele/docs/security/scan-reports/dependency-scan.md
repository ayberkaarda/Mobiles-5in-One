# Cetele: dependency scanning, versions report and SBOM

| | |
|---|---|
| Spec item | 19. |
| Status | Dependency-Check ran on GitHub Actions on 2026-10-11 with the NVD data of that day. **Android** (run 38127260714, green, repeated in run 38129509783): 0 findings left in the release runtime classpaths, two CPE false positives suppressed with reasons (section 2.3). **Server** (run 38129509783, green): 199 dependencies of `runtimeClasspath` analysed, 0 findings left, no suppression; the nine CVSS 7 or higher Tomcat findings of run 38128569625 were fixed by a patch bump (section 2.4). The versions report and the SBOM ran and their real output is below. |
| Plugins | `org.owasp.dependencycheck` 13.0.0, `io.github.ben-manes.versions` 0.65.0, `org.cyclonedx.bom` 3.5.1, pinned in `server/gradle/libs.versions.toml` and `android/gradle/libs.versions.toml` (resolved on the Gradle Plugin Portal 2026-10-11). |
| CI | `.github/workflows/cetele-security.yml`: `dependency-check` (failing, both roots) and `sbom` (failing, uploaded) are in the gate; `versions` and `zap` are informational. GitHub runs: run 38127260714 on pull request 113 (Android result), runs 38128569625 and 38129509783 on branch `fix/cetele-depcheck-server` (pull request 114, server result). |
| Renovate | `renovate.json` now covers `cetele/**`: Gradle minor and patch groups for the server and the Android app, major updates and the Gradle wrappers one pull request each, the compose images in one group; `github-actions` already existed (grouped, digest pinned). |

## 1. Configuration

| Item | Server (`cetele/server`) | Android (`cetele/android`) |
|---|---|---|
| Vulnerability scan | `./gradlew dependencyCheckAnalyze` (`runtimeClasspath`, scope in section 2.4) | `./gradlew dependencyCheckAnalyze` (`releaseRuntimeClasspath` of the app and of every library module it includes, `runtimeClasspath` of `:core:domain`, scope in section 2.2; the root `dependencyCheckAggregate` is refused by Gradle 9.7 with AGP: "Resolution of the configuration ':app:_agp_internal_debug_kspClasspath' was attempted without an exclusive lock") |
| Threshold | `failBuildOnCVSS = 7.0` | same |
| NVD API key | from `NVD_API_KEY` in the environment (CI: repository secret), set only when present | same, applied to every project |
| Suppressions | `ops/dependency-check/suppressions-server.xml` | `ops/dependency-check/suppressions-android.xml` |
| Versions report | `./gradlew dependencyUpdates` (`build/dependencyUpdates/report.json` and `.txt`; pre-release candidates ignored unless the current version is one) | same |
| SBOM | `./gradlew cyclonedxBom`: `build/reports/cyclonedx/application.cdx.json` | `./gradlew cyclonedxBom`: `build/reports/cyclonedx/bom.json` and `bom.xml` |

None of these tasks is part of `check`: the database download needs the network and is slow. The server suppression file is empty (no finding needed one); the Android one has two entries (section 2.3). The header of each file states the rule that every entry carries a reason, the CVE ids, the package URL and an expiry (`until`).

The CycloneDX plugin has one side effect on the server: the Spring Boot plugin embeds the SBOM in the jar as `META-INF/sbom/application.cdx.json`. The actuator exposure is `health` only (`application.yml`), so it is not served.

## 2. Dependency-Check run (GitHub Actions)

### 2.1 Result of the green run

Run [38127260714](https://github.com/ayberkaarda/Mobiles-5in-One/actions/runs/38127260714) on pull request 113 (branch `feat/cetele-p6`, commit `41323d8f`), 2026-10-11, with the repository secret `NVD_API_KEY`. Engine 13.0.0, NVD data last modified 2026-10-11T08:16:33Z. Reports: artifacts `cetele-dependency-check-android` and `cetele-dependency-check-server` (HTML and JSON per module, kept 30 days).

| Root / module | Dependencies analysed (report entries) | Findings left | Suppressed matches |
|---|---|---|---|
| android `:app` | 315 | 0 | 116 |
| android `:core:data` | 254 | 0 | 116 |
| android `:core:designsystem` | 268 | 0 | 116 |
| android `:core:domain` | 2 | 0 | 0 |
| android `:core:network` | 92 | 0 | 0 |
| android `:feature:billing` | 311 | 0 | 116 |
| android `:feature:auth`, `customers`, `export`, `ledger`, `reminders`, `settings`, `shop` | 287 each | 0 | 116 each |
| server (`cetele-server`), run 38129509783 | 199 | 0 | 0 |

Android job: `BUILD SUCCESSFUL`, "Found 0 vulnerabilities" in every scanned module, no NVD key error. The 116 suppressed matches per module are the same two false positives (4 report entries times 28 SQLite CVEs, plus 4 entries times 1 JetBrains Runtime CVE), see 2.3. No finding of any severity is left and nothing was accepted as an open risk. This covers the advisories known to the NVD on the data date above, nothing later.

Server job: `BUILD SUCCESSFUL`, "Found 0 vulnerabilities in project cetele-server" with 199 report entries (run [38129509783](https://github.com/ayberkaarda/Mobiles-5in-One/actions/runs/38129509783), branch `fix/cetele-depcheck-server`, same engine and NVD data date as above). The Android modules gave the same numbers in that run. Section 2.4 has the server scope, the earlier empty result and the fix.

### 2.2 Android scope (what is scanned)

Set in `cetele/android/build.gradle.kts` for every project. The analyze task of a module reads the `dependencyCheck` extension of its own project, so the NVD key, `failBuildOnCVSS = 7.0`, the suppression file and the formats are applied to all projects.

| Projects | Configurations scanned |
|---|---|
| `:app` and every Android library module it includes (`:core:data`, `:core:network`, `:core:designsystem`, the eight `:feature:*` modules) | `releaseRuntimeClasspath` |
| `:core:domain` (Kotlin JVM library) | `runtimeClasspath` |
| root, `:core`, `:feature` (folders without dependencies), `:detekt-rules` (detekt rule set used by the build, not packaged) | not analysed (`skip = true`) |

Not scanned: debug, test, androidTest, lint, Kotlin compiler, ksp and annotation processor classpaths, detekt and ktlint, and the build script and plugin classpaths (`scanBuildEnv = false`, `skipTestGroups = true`). The CI command is `./gradlew dependencyCheckAnalyze --continue`: one analysis per module (the aggregate task stays unused, see section 1); `--continue` lets every module report, and any failing module still fails the job.

Before this change the scan was not truthful in two ways: the modules had no NVD key (`NvdApiException: Invalid API Key, length of 0` in `:core` and `:detekt-rules`, only the root had the key), and the `scanConfigurations` filter ran before AGP created the variant configurations, so the list was empty and the plugin scanned every configuration of `:app` (about 1660 matches, mostly the Kotlin compiler, kotlin-stdlib of old versions, jline inside the Kotlin compiler, grpc, netty, httpclient, commons-lang3 and protobuf from build tool classpaths, none of them in the APK). The scoped run 38126683173 then reported only the two false positives below (116 matches per module) and failed; run 38127260714 with the suppressions is green.

### 2.3 Suppressions (`ops/dependency-check/suppressions-android.xml`)

| Package URL | Matched CPE | CVE ids | Decision and evidence | Until |
|---|---|---|---|---|
| `pkg:maven/androidx.sqlite/sqlite-android@2.7.1`, `pkg:maven/androidx.sqlite/sqlite-framework-android@2.7.1` | `cpe:2.3:a:sqlite:sqlite:2.7.1` (the androidx version read as SQLite 2.7.1) | 28: CVE-2015-3414, CVE-2015-3415, CVE-2015-3416, CVE-2015-3717, CVE-2015-5895, CVE-2015-6607, CVE-2016-6153, CVE-2017-10989, CVE-2018-8740, CVE-2018-20346, CVE-2018-20505, CVE-2018-20506, CVE-2019-19645, CVE-2019-19646, CVE-2020-11655, CVE-2020-11656, CVE-2020-13434, CVE-2020-13435, CVE-2020-13630, CVE-2020-13631, CVE-2020-13632, CVE-2020-15358, CVE-2022-35737, CVE-2023-7104, CVE-2025-6965, CVE-2025-70873, CVE-2026-11822, CVE-2026-11824 | False positive. The two artifacts are Kotlin/Java API layers without SQLite code or a native library. The app database runs on SQLCipher (`net.zetetic:sqlcipher-android` 4.19.1, `SupportOpenHelperFactory` in `CeteleDatabaseFactory`); its `libsqlcipher.so` bundles SQLite 3.53.4 (source id dated 2026-07-24, read from the native library of the AAR). The NVD affected range of every listed CVE ends below 3.53.4 (newest: CVE-2026-11822 and CVE-2026-11824 before 3.53.2, CVE-2025-70873 before 3.51.1, CVE-2025-6965 before 3.50.2). `sqlite-framework` calls the platform SQLite of Android, which ships with the OS, not with the APK. `sqlite-bundled` is a test dependency only. | 2027-04-11 |
| `pkg:maven/org.jetbrains.compose.runtime/runtime-android@1.12.0`, `pkg:maven/org.jetbrains.compose.runtime/runtime-saveable-android@1.12.0` | `cpe:2.3:a:jetbrains:runtime:1.12.0` | CVE-2025-29903 | False positive. The CVE is for JetBrains Runtime, the JDK build of the JetBrains IDEs (before 21.0.6b872.80, macOS dynamic library loading). It is not in the APK and does not run on Android; the Compose runtime library only shares the word "runtime". | 2027-04-11 |

Fixed by a version bump: none needed (no real finding in the shipped scope). Accepted open risks: none.

### 2.4 Server scope, the empty result and the findings

Scope, set in `cetele/server/build.gradle.kts`: `scanConfigurations = listOf("runtimeClasspath")`, which is the classpath jib copies into the image; `scanBuildEnv = false`. Not scanned: the test classpaths, the Kotlin compiler, ktlint and the build script and plugin classpaths.

**Why the server scan analysed 0 dependencies before** (run 38127710210 and earlier: green, empty `dependencies` list). The plugin skips "test configurations" by default (`skipTestGroups = true`) and its check walks the whole hierarchy of a configuration. The Spring Boot plugin makes `runtimeClasspath` extend `developmentOnly`, which extends `testAndDevelopmentOnly`; that name matched the test pattern, so `runtimeClasspath` itself was skipped. The `--info` log showed it: `'runtimeClasspath --> runtimeOnly --> implementation --> api --> developmentOnly --> testAndDevelopmentOnly' is considered a test configuration: true`, and no "Analyzing" line followed. Fix: `skipTestGroups = false`; the scope stays limited by `scanConfigurations`, so no test classpath enters the scan (the log now shows `- Analyzing cetele-server:runtimeClasspath`, and nothing else).

**Evidence of the real scan** (run 38129509783): 199 report entries, among them `spring-boot-4.1.1`, `spring-security-core-7.1.1`, `hibernate-core-7.4.5.Final`, `jackson-databind-2.22.1` and `3.1.5`, `postgresql-42.7.13`, `flyway-core-12.4.0`, `nimbus-jose-jwt-10.10` (and its shaded `gson` and `jcip-annotations`), `tomcat-embed-core-11.0.26`, `commonmark-0.30.1`, `thymeleaf-3.1.5`, `pdfbox-3.0.8`, `bcprov-jdk18on-1.86`, `s3-2.55.11` and the Netty modules of the AWS client. The SBOM lists more components (327) because it also counts BOMs and modules without a jar.

**Lesson and guard.** A gate that analysed nothing looked green for a day (2026-10-10 to 2026-10-11): "Found 0 vulnerabilities" said nothing about an empty report. The job now has the step "Require analysed dependencies", which fails when any `dependency-check-report.json` of the root lists no dependency (it prints the count of every report).

**First real result** (run [38128569625](https://github.com/ayberkaarda/Mobiles-5in-One/actions/runs/38128569625), 198 entries, job failed as it should): 36 matches, all real version matches, no false positive among them.

| Package | CVE ids | CVSS | Decision |
|---|---|---|---|
| `pkg:maven/org.apache.tomcat.embed/tomcat-embed-core@11.0.24`, `tomcat-embed-websocket@11.0.24` | CVE-2026-65637, CVE-2026-65905 (9.8); CVE-2026-65182, CVE-2026-68525 (9.1); CVE-2026-65183, CVE-2026-66422, CVE-2026-68569 (8.1); CVE-2026-65927, CVE-2026-68763 (7.5); below the threshold CVE-2026-73180 (6.8), CVE-2026-66299 (5.3) | 5.3 to 9.8 | Real (Tomcat 11.0.24 is inside every NVD range, all end before 11.0.25). Fixed by a patch bump: Spring Boot 4.1.1 is the newest Boot release and pins 11.0.24, so the catalog sets `tomcat = "11.0.26"` and `build.gradle.kts` adds constraints for `tomcat-embed-core`, `-el` and `-websocket`. |
| `pkg:maven/io.netty/netty-*@4.2.17.Final` (15 modules, from the AWS SDK client) | CVE-2026-89044 | 6.5 | Real, below the threshold. Fixed anyway by a patch bump: `netty = "4.2.19.Final"` through `io.netty:netty-bom` (range ends before 4.2.18). |

The server gate stayed green with the new versions (`./gradlew --offline check openApiContractCheck`: 729 tests, 0 failures). Both overrides are marked in the catalog to be removed when the Boot BOM reaches these versions. Suppressed: none. Accepted open risks: none.

### 2.5 Earlier local attempt

The first local run (2026-10-11, without a key) failed before analysing anything: the unauthenticated NVD API answered `200` with an empty body and the CISA known-exploited feed `403` (`NvdApiException: Invalid API Key, length of 0`). It produced no result; the result above comes from CI.

## 3. Versions report (real output)

| | Server | Android |
|---|---|---|
| Dependencies on the latest release | 46 | 87 |
| Newer release available | 15 | 20 |
| Exceeds the latest release / unresolved | 0 / 0 | 0 / 0 |
| Gradle | 9.7.0, 9.8.1 available | same |

Newer releases that matter to the app (the rest are the Kotlin 2.4.20 to 2.4.21 family and its compiler plugins, and `sarif4k` and `kotlin-logging` on the lint tool classpaths):

| Library | Current | Available | Root |
|---|---|---|---|
| `org.jetbrains.kotlin` (plugins, stdlib, BOM) | 2.4.20 | 2.4.21 | both |
| `software.amazon.awssdk:bom` | 2.55.11 | 2.55.14 | server |
| `com.twelvemonkeys.imageio:imageio-webp` | 3.15.2 | 3.15.3 | server |
| `com.android.application` / `library` (AGP) | 9.3.3 | 9.4.1 | android |
| `com.android.billingclient:billing-ktx` | 8.3.0 | 9.1.0 (major) | android |
| `com.slack.lint.compose:compose-lint-checks` | 1.6.0 | 1.6.1 | android |

No version in this list was changed: Phase 6 does not upgrade libraries, and Gradle, AGP and Kotlin are pinned by ADR-0001. Renovate will propose these. The only changes are the two security patch levels of section 2.4 (Tomcat 11.0.26 and Netty 4.2.19.Final above the Spring Boot BOM), which this report, run before them, does not show.

## 4. SBOM (real output)

| | Server | Android |
|---|---|---|
| File | `application.cdx.json` | `bom.json` (and `bom.xml`) |
| Format | CycloneDX 1.6 JSON | CycloneDX 1.6 JSON |
| Components | 327 | 796 |
| Dependency entries | 328 | 797 |

The CI job `sbom` fails when either file is empty and uploads both as the artifact `cetele-sbom`. The SBOM lists libraries only; it is not signed and no vulnerability data is attached to it.
