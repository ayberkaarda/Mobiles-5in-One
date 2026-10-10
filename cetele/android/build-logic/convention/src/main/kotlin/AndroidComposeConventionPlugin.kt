import com.android.build.api.dsl.CommonExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.getByType

/** Jetpack Compose for an Android module (apply after the application or library plugin). */
class AndroidComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
            extensions.getByType<CommonExtension>().buildFeatures.compose = true
            val catalog = extensions.getByType<org.gradle.api.artifacts.VersionCatalogsExtension>().named("libs")
            dependencies {
                val bom = platform(catalog.findLibrary("androidx-compose-bom").get())
                add("implementation", bom)
                add("implementation", catalog.findLibrary("androidx-compose-ui").get())
                add("implementation", catalog.findLibrary("androidx-compose-ui-graphics").get())
                add("implementation", catalog.findLibrary("androidx-compose-foundation").get())
                add("implementation", catalog.findLibrary("androidx-compose-material3").get())
                add("implementation", catalog.findLibrary("androidx-compose-ui-tooling-preview").get())
                add("debugImplementation", catalog.findLibrary("androidx-compose-ui-tooling").get())
                add("implementation", catalog.findLibrary("androidx-compose-material-icons-core").get())
                add("testImplementation", bom)
                add("testImplementation", catalog.findLibrary("androidx-compose-ui-test-junit4").get())
                add("debugImplementation", catalog.findLibrary("androidx-compose-ui-test-manifest").get())
            }
        }
    }
}
