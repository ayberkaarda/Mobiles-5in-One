import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.getByType

/** Feature module: Android library with Compose and access to the core modules. */
class AndroidFeatureConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("cetele.android.library")
            pluginManager.apply("cetele.android.compose")
            pluginManager.apply("com.google.devtools.ksp")
            pluginManager.apply("com.google.dagger.hilt.android")
            pluginManager.apply("org.jetbrains.kotlin.plugin.serialization")
            val catalog = extensions.getByType<org.gradle.api.artifacts.VersionCatalogsExtension>().named("libs")
            dependencies {
                add("implementation", project(":core:domain"))
                add("implementation", project(":core:designsystem"))
                add("implementation", project(":core:data"))
                add("implementation", project(":core:network"))
                add("implementation", catalog.findLibrary("hilt-android").get())
                add("ksp", catalog.findLibrary("hilt-compiler").get())
                add("implementation", catalog.findLibrary("androidx-hilt-lifecycle-viewmodel-compose").get())
                add("implementation", catalog.findLibrary("androidx-lifecycle-viewmodel-compose").get())
                add("implementation", catalog.findLibrary("androidx-lifecycle-runtime-compose").get())
                add("implementation", catalog.findLibrary("androidx-activity-compose").get())
                add("implementation", catalog.findLibrary("coil-compose").get())
                add("implementation", catalog.findLibrary("androidx-navigation-compose").get())
                add("implementation", catalog.findLibrary("kotlinx-serialization-json").get())
                add("implementation", catalog.findLibrary("androidx-biometric").get())
                add("testImplementation", catalog.findLibrary("ktor-client-mock").get())
                add("testImplementation", catalog.findLibrary("mockk").get())
                add("testImplementation", catalog.findLibrary("turbine").get())
            }
        }
    }
}
