# Cetele: dependency scanning, versions report and SBOM

| | |
|---|---|
| Spec item | 19. |
| Status | Tooling added to both Gradle roots and run on 2026-10-11. **Dependency-Check: not exercised: the vulnerability database could not be downloaded from this machine** (section 2). The versions report and the SBOM ran and their real output is below. |
| Plugins | `org.owasp.dependencycheck` 13.0.0, `io.github.ben-manes.versions` 0.65.0, `org.cyclonedx.bom` 3.5.1, pinned in `server/gradle/libs.versions.toml` and `android/gradle/libs.versions.toml` (resolved on the Gradle Plugin Portal 2026-10-11). |
| CI | `.github/workflows/cetele-security.yml`: `dependency-check` (failing, both roots) and `sbom` (failing, uploaded) are in the gate; `versions` and `zap` are informational. GitHub runs: **not exercised yet**. |
| Renovate | `renovate.json` now covers `cetele/**`: Gradle minor and patch groups for the server and the Android app, major updates and the Gradle wrappers one pull request each, the compose images in one group; `github-actions` already existed (grouped, digest pinned). |

## 1. Configuration

| Item | Server (`cetele/server`) | Android (`cetele/android`) |
|---|---|---|
| Vulnerability scan | `./gradlew dependencyCheckAnalyze` (runtime classpath) | `./gradlew dependencyCheckAnalyze` (release runtime classpath of every module; the root `dependencyCheckAggregate` is refused by Gradle 9.7 with AGP: "Resolution of the configuration ':app:_agp_internal_debug_kspClasspath' was attempted without an exclusive lock") |
| Threshold | `failBuildOnCVSS = 7.0` | same |
| NVD API key | optional, from `NVD_API_KEY` in the environment, set only when present | same |
| Suppressions | `ops/dependency-check/suppressions-server.xml` | `ops/dependency-check/suppressions-android.xml` |
| Versions report | `./gradlew dependencyUpdates` (`build/dependencyUpdates/report.json` and `.txt`; pre-release candidates ignored unless the current version is one) | same |
| SBOM | `./gradlew cyclonedxBom`: `build/reports/cyclonedx/application.cdx.json` | `./gradlew cyclonedxBom`: `build/reports/cyclonedx/bom.json` and `bom.xml` |

None of these tasks is part of `check`: the database download needs the network and is slow. Suppression files are empty on purpose; the header of each file states the rule that every entry carries a reason, the advisory, and an expiry (`until`).

The CycloneDX plugin has one side effect on the server: the Spring Boot plugin embeds the SBOM in the jar as `META-INF/sbom/application.cdx.json`. The actuator exposure is `health` only (`application.yml`), so it is not served.

## 2. Dependency-Check run

Command: `./gradlew --no-daemon dependencyCheckAnalyze` in `cetele/server` (and `:app:dependencyCheckAnalyze :core:domain:dependencyCheckAnalyze` in `cetele/android`), without an NVD API key (none exists on this machine).

Real output, both roots:

```
Error updating the NVD Data
Caused by: io.github.jeremylong.openvulnerability.client.nvd.NvdApiException: Invalid API Key, length of 0 too short to provided a masked partial key
org.owasp.dependencycheck.utils.ForbiddenException: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json - Server status: 403 - Server reason: Forbidden
Unable to update 1 or more Cached Web DataSource, using local data instead. Results may not include recent vulnerabilities.
Unable to continue dependency-check analysis.
```

A direct request to `https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1` answered `200` with `Content-Length: 0`, and the CISA known-exploited feed answered `403` from this machine. The task therefore failed before it analysed anything: **no vulnerability result exists, and none is claimed.** To produce one, set `NVD_API_KEY` (a free key from the NVD) and run the command again; in CI add the repository secret `NVD_API_KEY`.

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

No version was changed: Phase 6 does not upgrade libraries, and Gradle, AGP and Kotlin are pinned by ADR-0001. Renovate will propose these.

## 4. SBOM (real output)

| | Server | Android |
|---|---|---|
| File | `application.cdx.json` | `bom.json` (and `bom.xml`) |
| Format | CycloneDX 1.6 JSON | CycloneDX 1.6 JSON |
| Components | 327 | 796 |
| Dependency entries | 328 | 797 |

The CI job `sbom` fails when either file is empty and uploads both as the artifact `cetele-sbom`. The SBOM lists libraries only; it is not signed and no vulnerability data is attached to it.
