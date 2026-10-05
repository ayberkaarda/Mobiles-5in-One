import app.cetele.android.buildlogic.configureJUnitPlatform
import app.cetele.android.buildlogic.configureJvmToolchain
import app.cetele.android.buildlogic.configureKotlin
import app.cetele.android.buildlogic.configureStaticAnalysis
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

/** Pure Kotlin module without Android dependencies (core/domain). */
class JvmLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.jvm")
            pluginManager.apply("java-library")
            configureJvmToolchain()
            configureKotlin(JvmTarget.JVM_17)
            extensions.configure(org.gradle.api.plugins.JavaPluginExtension::class.java) {
                sourceCompatibility = org.gradle.api.JavaVersion.VERSION_17
                targetCompatibility = org.gradle.api.JavaVersion.VERSION_17
            }
            configureJUnitPlatform()
            configureStaticAnalysis()
        }
    }
}
