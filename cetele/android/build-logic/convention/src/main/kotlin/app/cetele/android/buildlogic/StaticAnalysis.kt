package app.cetele.android.buildlogic

import io.gitlab.arturbosch.detekt.extensions.DetektExtension
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.jlleitschuh.gradle.ktlint.KtlintExtension

/**
 * ktlint and detekt for every module. detekt 1.23.x embeds its own Kotlin compiler, so the
 * `detekt` configuration keeps the Kotlin version that detekt was built with.
 */
internal fun Project.configureStaticAnalysis() {
    pluginManager.apply("org.jlleitschuh.gradle.ktlint")
    pluginManager.apply("io.gitlab.arturbosch.detekt")
    dependencies {
        add("detektPlugins", project(":detekt-rules"))
    }

    extensions.configure<KtlintExtension> {
        version.set(libs.findVersion("ktlint").get().requiredVersion)
        android.set(true)
        ignoreFailures.set(false)
        filter {
            exclude { element -> element.file.path.contains("${java.io.File.separator}build${java.io.File.separator}") }
        }
    }

    extensions.configure<DetektExtension> {
        buildUponDefaultConfig = true
        allRules = false
        parallel = true
        config.setFrom(rootProject.file("config/detekt/detekt.yml"))
        source.setFrom(
            "src/main/kotlin",
            "src/test/kotlin",
            "src/debug/kotlin",
            "src/release/kotlin",
        )
    }

    configurations.matching { it.name == "detekt" }.configureEach {
        resolutionStrategy.eachDependency {
            if (requested.group == "org.jetbrains.kotlin") {
                useVersion(DETEKT_KOTLIN_VERSION)
            }
        }
    }
}

/** Kotlin version detekt 1.23.8 is compiled against. */
private const val DETEKT_KOTLIN_VERSION = "2.0.21"
