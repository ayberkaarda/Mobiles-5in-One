// Plugin versions come from gradle/libs.versions.toml; modules apply them through build-logic.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.room) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.detekt) apply false
    alias(libs.plugins.dependency.check)
    alias(libs.plugins.versions.report)
    alias(libs.plugins.cyclonedx)
}

// Dependency scanning and reporting (spec items 19 and 23). None of these tasks is part of the
// regular gates: the vulnerability database download is slow and needs the network, so CI runs
// them in the "Cetele security" workflow (.github/workflows/cetele-security.yml).
//   ./gradlew dependencyCheckAnalyze     fails on any finding with CVSS 7.0 or higher (one analysis per
//                                        module; the root "aggregate" task is not used: it resolves
//                                        AGP configurations without a lock and is refused by Gradle 9.7)
//   ./gradlew dependencyUpdates          newer versions report (build/dependencyUpdates)
//   ./gradlew cyclonedxBom               CycloneDX SBOM (build/reports/cyclonedx)
// The NVD API key is read from the environment (NVD_API_KEY; the CI workflow sets it from the
// repository secret). Every dependencyCheckAnalyze task reads the "dependencyCheck" extension of
// its own project, not the root one, so the settings are applied to every project further down.
// Before, only the root had the key, the threshold and the suppression file: the module analyses
// failed with "Invalid API Key, length of 0" or ran without a threshold.
val nvdApiKey: String? = System.getenv("NVD_API_KEY")
val suppressions: String = file("../ops/dependency-check/suppressions-android.xml").path

tasks.dependencyUpdates {
    revision = "release"
    gradleReleaseChannel = "current"
    outputFormatter = "json,plain"
    rejectVersionIf {
        val unstable = Regex("(?i).*(alpha|beta|rc|cr|m|preview|snapshot|dev)[.-]?[0-9]*$")
        unstable.matches(candidate.version) && !unstable.matches(currentVersion)
    }
}

// Scope of the dependency scan: only what ships in the APK.
//   Android modules (the app and every library module it includes): releaseRuntimeClasspath.
//   JVM library modules (core:domain): runtimeClasspath.
//   Not scanned: debug, test, androidTest, lint, Kotlin compiler, kapt/ksp, annotation processor,
//   detekt and ktlint classpaths, and the build script and plugin classpaths (scanBuildEnv off).
//   Skipped projects: the root and the ":core" and ":feature" folders (no dependencies of their
//   own) and ":detekt-rules" (a detekt rule set loaded by the build, never packaged into the APK).
// The configuration names are set when the plugin is applied, without a configurations.names
// filter: AGP creates the variant configurations in its own afterEvaluate, so the old filter saw
// none, the list stayed empty, and an empty list means "every configuration" to the plugin (which
// is how the Kotlin compiler, ksp and lint classpaths ended up in the scan).
val notShipped = setOf(":", ":core", ":feature", ":detekt-rules")

allprojects {
    apply(plugin = "org.owasp.dependencycheck")
    val dependencyCheckSettings = extensions.getByType<org.owasp.dependencycheck.gradle.extension.DependencyCheckExtension>()
    dependencyCheckSettings.apply {
        failBuildOnCVSS = 7.0f
        suppressionFile = suppressions
        formats = listOf("HTML", "JSON")
        scanBuildEnv = false
        skipTestGroups = true
        skip = path in notShipped
        nvd {
            // Set only when present: an empty key is rejected by the client.
            if (!nvdApiKey.isNullOrBlank()) apiKey = nvdApiKey
        }
    }
    plugins.withId("com.android.application") {
        dependencyCheckSettings.scanConfigurations = listOf("releaseRuntimeClasspath")
    }
    plugins.withId("com.android.library") {
        dependencyCheckSettings.scanConfigurations = listOf("releaseRuntimeClasspath")
    }
    plugins.withId("org.jetbrains.kotlin.jvm") {
        dependencyCheckSettings.scanConfigurations = listOf("runtimeClasspath")
    }
}

subprojects {
    apply(plugin = "org.cyclonedx.bom")
}
