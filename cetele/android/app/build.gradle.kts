import java.net.URI
import java.util.Base64
import java.util.Properties

plugins {
    alias(libs.plugins.cetele.android.application)
    alias(libs.plugins.cetele.android.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

val localProperties =
    Properties().apply {
        providers
            .fileContents(rootProject.layout.projectDirectory.file("local.properties"))
            .asText.orNull
            ?.let { load(it.reader()) }
    }

fun configurationValue(key: String): String? =
    (providers.gradleProperty(key).orNull ?: localProperties.getProperty(key))?.trim()?.takeIf(String::isNotEmpty)

fun quoted(value: String): String =
    "\"" +
        value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r") + "\""

val apiBaseUrl = configurationValue("cetele.apiBaseUrl")
val certificatePins = configurationValue("cetele.certPins").orEmpty()
val fakeIntegrityToken = configurationValue("cetele.fakeIntegrityToken") ?: "fake.ok"

android {
    namespace = "app.cetele.android"
    defaultConfig {
        applicationId = "app.cetele.android"
        versionCode = 1
        versionName = "0.3.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures.buildConfig = true
    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", quoted(apiBaseUrl ?: "http://10.0.2.2:60080"))
            buildConfigField("String", "FAKE_INTEGRITY_TOKEN", quoted(fakeIntegrityToken))
            buildConfigField("String", "CERT_PINS", quoted(""))
            buildConfigField("boolean", "PINNING_ENABLED", "false")
        }
        release {
            buildConfigField("String", "API_BASE_URL", quoted(apiBaseUrl.orEmpty()))
            buildConfigField("String", "CERT_PINS", quoted(certificatePins))
            buildConfigField("boolean", "PINNING_ENABLED", "true")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1,INDEX.LIST,DEPENDENCIES}"
        resources.excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        resources.excludes += "META-INF/*.SF"
        resources.excludes += "META-INF/*.DSA"
        resources.excludes += "META-INF/*.RSA"
    }
}

val verifyReleaseConfig =
    tasks.register("verifyReleaseConfig") {
        description = "Checks the HTTPS API address and primary and backup SPKI pins."
        // Plain local values only: the task action must not reference the build script (configuration cache).
        val url = apiBaseUrl.orEmpty()
        val pinList = certificatePins
        inputs.property("apiBaseUrl", url)
        inputs.property("certificatePins", pinList)
        doLast {
            val uri = runCatching { URI(url) }.getOrNull()
            if (uri == null || uri.scheme != "https" || uri.host == null ||
                uri.userInfo != null || uri.query != null || uri.fragment != null
            ) {
                throw GradleException("Release builds require cetele.apiBaseUrl with an HTTPS host.")
            }
            val pins = pinList.split(',').map(String::trim)
            val valid =
                pins.distinct().size >= 2 &&
                    pins.all { pin ->
                        pin.startsWith("sha256/") &&
                            runCatching {
                                val value = pin.removePrefix("sha256/")
                                val bytes = Base64.getDecoder().decode(value)
                                bytes.size == 32 && Base64.getEncoder().encodeToString(bytes) == value
                            }.getOrDefault(false)
                    }
            if (!valid) throw GradleException("Release builds require two distinct SHA-256 pins in cetele.certPins.")
        }
    }

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    dependsOn(verifyReleaseConfig)
}

dependencies {
    implementation(project(":core:domain"))
    implementation(project(":core:data"))
    implementation(project(":core:network"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:shop"))
    implementation(project(":feature:customers"))
    implementation(project(":feature:ledger"))
    implementation(project(":feature:reminders"))
    implementation(project(":feature:export"))
    implementation(project(":feature:settings"))
    implementation(project(":feature:billing"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.work.runtime)
    releaseImplementation(libs.play.integrity)
    releaseImplementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.ktor.client.mock)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.sqlcipher.android)
    androidTestImplementation(libs.androidx.room.runtime)
    androidTestImplementation(libs.androidx.test.core.ktx)
}
