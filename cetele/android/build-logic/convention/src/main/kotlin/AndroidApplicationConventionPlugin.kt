import app.cetele.android.buildlogic.TARGET_SDK
import app.cetele.android.buildlogic.configureAndroidCommon
import app.cetele.android.buildlogic.configureStaticAnalysis
import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/** Application module: SDK levels, Kotlin toolchain, JUnit Platform, ktlint, detekt. */
class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.android.application")
            extensions.configure<ApplicationExtension> {
                configureAndroidCommon(this)
                defaultConfig.targetSdk = TARGET_SDK
            }
            configureStaticAnalysis()
        }
    }
}
