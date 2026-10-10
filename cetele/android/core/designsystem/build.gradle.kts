plugins {
    alias(libs.plugins.cetele.android.library)
    alias(libs.plugins.cetele.android.compose)
}

dependencies {
    implementation(project(":core:domain"))
    implementation(project(":core:data"))
    implementation(project(":core:network"))
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.kotlinx.serialization.json)
}

// The token tests compare the Kotlin theme with the brand source of truth.
val brandTokens = rootProject.layout.projectDirectory.file("../brand/tokens.json")
tasks.withType<Test>().configureEach {
    inputs.file(brandTokens).withPathSensitivity(PathSensitivity.NONE)
    systemProperty("cetele.brandTokens", brandTokens.asFile.absolutePath)
}
