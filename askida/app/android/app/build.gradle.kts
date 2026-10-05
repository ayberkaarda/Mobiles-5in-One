plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "app.askida.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "app.askida.mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            manifestPlaceholders["appName"] = "Askıda (dev)"
        }
        create("prod") {
            dimension = "environment"
            manifestPlaceholders["appName"] = "Askıda"
        }
    }

    buildTypes {
        release {
            // Release signing is configured outside the repository (Phase 6).
            // Until then release builds reuse the local debug key so that
            // `flutter run --release` works on a developer machine.
            signingConfig = signingConfigs.getByName("debug")
            // Stated here rather than left to the Flutter Gradle plugin's
            // defaults: no debuggable release, R8 code and resource shrinking on.
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Device attestation for the anonymous recipient identity
    // (AttestChannel.kt, classic request API). No key ships with the app.
    implementation("com.google.android.play:integrity:1.4.0")
}
