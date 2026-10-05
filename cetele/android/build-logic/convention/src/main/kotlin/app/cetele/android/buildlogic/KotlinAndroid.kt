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
    }
    configureKotlin(JvmTarget.JVM_17)
    configureJUnitPlatform()
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
    }
    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }
}
