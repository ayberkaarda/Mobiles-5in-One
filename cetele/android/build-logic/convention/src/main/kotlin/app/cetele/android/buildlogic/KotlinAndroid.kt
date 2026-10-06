package app.cetele.android.buildlogic

import com.android.build.api.dsl.CommonExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.tasks.testing.Test
import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.getByType
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinBaseExtension
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

/** JDK used to run the compilers and tests (ADR-0001). */
internal const val TOOLCHAIN_JDK = 21

/** Bytecode level of Android modules (AGP default). */
internal val ANDROID_BYTECODE = JavaVersion.VERSION_17

internal const val COMPILE_SDK = 37
internal const val TARGET_SDK = 36
internal const val MIN_SDK = 26

internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

internal fun Project.configureAndroidCommon(extension: CommonExtension) {
    extension.apply {
        compileSdk = COMPILE_SDK
        defaultConfig.minSdk = MIN_SDK
        compileOptions.sourceCompatibility = ANDROID_BYTECODE
        compileOptions.targetCompatibility = ANDROID_BYTECODE
        testOptions.unitTests.isIncludeAndroidResources = true
        testOptions.unitTests.isReturnDefaultValues = false
        lint.abortOnError = true
        lint.warningsAsErrors = false
        lint.checkDependencies = true
        lint.disable += "ObsoleteLintCustomCheck"
    }
    configureKotlin(JvmTarget.JVM_17)
    configureJUnitPlatform()
    dependencies {
        add("testImplementation", libs.findLibrary("robolectric").get())
        add("testImplementation", libs.findLibrary("androidx-test-core-ktx").get())
        add("testImplementation", libs.findLibrary("androidx-test-ext-junit").get())
        add("testImplementation", libs.findLibrary("kotlinx-coroutines-test").get())
        add("lintChecks", libs.findLibrary("compose-lint").get())
    }
}

internal fun Project.configureKotlin(target: JvmTarget) {
    extensions.configure<KotlinBaseExtension> {
        jvmToolchain(TOOLCHAIN_JDK)
    }
    tasks.withType<KotlinJvmCompile>().configureEach {
        compilerOptions {
            jvmTarget.set(target)
            allWarningsAsErrors.set(true)
        }
    }
}

internal fun Project.configureJvmToolchain() {
    extensions.configure<JavaPluginExtension> {
        toolchain.languageVersion.set(JavaLanguageVersion.of(TOOLCHAIN_JDK))
    }
}

internal fun Project.configureJUnitPlatform() {
    dependencies {
        add("testImplementation", platform(libs.findLibrary("junit-bom").get()))
        add("testImplementation", libs.findLibrary("junit-jupiter").get())
        add("testRuntimeOnly", libs.findLibrary("junit-platform-launcher").get())
        add("testRuntimeOnly", libs.findLibrary("junit-vintage").get())
    }
    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        // Robolectric's Conscrypt loader lower-cases the OS name with the default locale; under a Turkish
        // locale "Windows" becomes "wındows" and the JNI library is not found. The JDK provider is enough.
        systemProperty("robolectric.conscryptMode", "OFF")
        // Robolectric 4.17 reaches FileDescriptor internals through jdk.internal.access on JDK 17+.
        jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED", "--add-opens=java.base/java.io=ALL-UNNAMED")
        // Modules without a test source set yet (feature shells) still get Hilt and R test classes
        // from the build; the empty-run guard stays on wherever tests are written.
        failOnNoDiscoveredTests.set(file("src/test").exists())
    }
}
