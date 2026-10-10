import java.util.Properties

plugins {
    alias(libs.plugins.cetele.android.feature)
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

// Debug builds default to the fake gateway (no Play account, ADR-0004 G1); release is always Play.
val debugBillingMode = configurationValue("cetele.billingMode") ?: "fake"
if (debugBillingMode !in setOf("fake", "play")) {
    throw GradleException("cetele.billingMode must be fake or play.")
}
val fakeBillingState = configurationValue("cetele.fakeBillingState") ?: "active"
if (!Regex("^[a-z]{1,16}$").matches(fakeBillingState)) {
    throw GradleException("cetele.fakeBillingState must be a lowercase word such as active or pending.")
}

android {
    buildFeatures.buildConfig = true
    buildTypes {
        debug {
            buildConfigField("String", "BILLING_MODE", "\"$debugBillingMode\"")
            buildConfigField("String", "FAKE_BILLING_STATE", "\"$fakeBillingState\"")
        }
        release {
            buildConfigField("String", "BILLING_MODE", "\"play\"")
        }
    }
}

dependencies {
    implementation(libs.play.billing.ktx)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    testImplementation(libs.androidx.work.testing)
}
