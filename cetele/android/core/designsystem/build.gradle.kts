plugins {
    alias(libs.plugins.cetele.android.library)
    alias(libs.plugins.cetele.android.compose)
}

dependencies {
    testImplementation(libs.kotlinx.serialization.json)
}

// The token tests compare the Kotlin theme with the brand source of truth.
val brandTokens = rootProject.layout.projectDirectory.file("../brand/tokens.json")
tasks.withType<Test>().configureEach {
    inputs.file(brandTokens).withPathSensitivity(PathSensitivity.NONE)
    systemProperty("cetele.brandTokens", brandTokens.asFile.absolutePath)
}
