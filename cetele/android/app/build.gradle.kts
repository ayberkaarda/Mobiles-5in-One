import com.android.build.api.variant.BuildConfigField
import java.util.Properties

plugins {
    alias(libs.plugins.cetele.android.application)
    alias(libs.plugins.cetele.android.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// API base URL: `cetele.apiBaseUrl` in local.properties (gitignored) or as a Gradle property (CI).
// Debug falls back to the local Docker Compose server seen from the emulator; release requires a value.
val apiBaseUrlKey = "cetele.apiBaseUrl"
val debugApiBaseUrl = "http://10.0.2.2:60080"
val localProperties =
    Properties().apply {
        providers
            .fileContents(rootProject.layout.projectDirectory.file("local.properties"))
            .asText
            .orNull
            ?.let { load(it.reader()) }
    }
val configuredApiBaseUrl: String? =
    (localProperties.getProperty(apiBaseUrlKey) ?: providers.gradleProperty(apiBaseUrlKey).orNull)
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

android {
    namespace = "app.cetele.android"

    defaultConfig {
        applicationId = "app.cetele.android"
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1,INDEX.LIST,DEPENDENCIES}"
    }
}

androidComponents {
    onVariants { variant ->
        val url =
            when (variant.buildType) {
                "debug" -> configuredApiBaseUrl ?: debugApiBaseUrl
                else -> configuredApiBaseUrl.orEmpty()
            }
        variant.buildConfigFields?.put(
            "API_BASE_URL",
            BuildConfigField("String", "\"$url\"", "API base URL"),
        )
    }
}

val verifyReleaseApiBaseUrl =
    tasks.register("verifyReleaseApiBaseUrl") {
        description = "Fails a release build when $apiBaseUrlKey is missing or not HTTPS."
        val url = configuredApiBaseUrl
        doLast {
            if (url == null || !url.startsWith("https://")) {
                throw GradleException("Release builds need $apiBaseUrlKey set to an https:// URL in local.properties.")
            }
        }
    }

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
    dependsOn(verifyReleaseApiBaseUrl)
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
    implementation(libs.androidx.navigation.compose)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.work.runtime)
}
