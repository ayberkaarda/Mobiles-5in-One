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
// The NVD API key is optional and read from the environment (NVD_API_KEY).
val nvdApiKey: String? = System.getenv("NVD_API_KEY")
val suppressions: String = file("../ops/dependency-check/suppressions-android.xml").path

dependencyCheck {
    failBuildOnCVSS = 7.0f
    suppressionFile = suppressions
    formats = listOf("HTML", "JSON")
    nvd {
        // Set only when present: an empty key is rejected by the client.
        if (!nvdApiKey.isNullOrBlank()) apiKey = nvdApiKey
    }
}

tasks.dependencyUpdates {
    revision = "release"
    gradleReleaseChannel = "current"
    outputFormatter = "json,plain"
    rejectVersionIf {
        val unstable = Regex("(?i).*(alpha|beta|rc|cr|m|preview|snapshot|dev)[.-]?[0-9]*$")
        unstable.matches(candidate.version) && !unstable.matches(currentVersion)
    }
}

// Every module analyses its own shipped classpath, so every subproject applies the plugins.
// Scanned: what ships (the release runtime classpath of Android modules, the runtime classpath of
// JVM modules); test, debug and tool classpaths are not scanned.
subprojects {
    apply(plugin = "org.owasp.dependencycheck")
    apply(plugin = "org.cyclonedx.bom")
    afterEvaluate {
        extensions.configure<org.owasp.dependencycheck.gradle.extension.DependencyCheckExtension> {
            val shipped = listOf("releaseRuntimeClasspath", "runtimeClasspath")
            scanConfigurations = shipped.filter { it in configurations.names }
        }
    }
}
