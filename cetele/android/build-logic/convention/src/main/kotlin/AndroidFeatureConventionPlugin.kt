import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

/** Feature module: Android library with Compose and access to the core modules. */
class AndroidFeatureConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("cetele.android.library")
            pluginManager.apply("cetele.android.compose")
            dependencies {
                add("implementation", project(":core:domain"))
                add("implementation", project(":core:designsystem"))
            }
        }
    }
}
