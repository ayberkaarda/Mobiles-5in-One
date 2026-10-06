import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.springframework.boot.gradle.plugin.SpringBootPlugin

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.jib)
    alias(libs.plugins.ktlint)
}

group = "app.cetele"
version = "0.1.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

// JPA entities must stay open for Hibernate proxies.
allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("jakarta.persistence.MappedSuperclass")
    annotation("jakarta.persistence.Embeddable")
}

dependencies {
    // Gradle platforms instead of the dependency-management plugin, so the Spring Boot BOM only
    // governs the application classpaths and never rewrites tool classpaths such as ktlint's.
    implementation(platform(SpringBootPlugin.BOM_COORDINATES))
    // The Boot BOM pins an older Kotlin; align every Kotlin artifact with the compiler plugin.
    implementation(platform(libs.kotlin.bom))
    implementation(libs.spring.boot.starter.actuator)
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.flyway)
    implementation(libs.spring.boot.starter.security)
    implementation(libs.spring.boot.starter.thymeleaf)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.boot.starter.webmvc)
    implementation(libs.flyway.database.postgresql)
    implementation(libs.jackson.module.kotlin)
    implementation(libs.kotlin.reflect)
    implementation(libs.nimbus.jose.jwt)
    implementation(libs.bucket4j.core)
    implementation(libs.bucket4j.caffeine)
    implementation(libs.caffeine)
    implementation(libs.springdoc.openapi.webmvc.api)
    implementation(platform(libs.aws.bom))
    implementation(libs.aws.s3)
    implementation(libs.aws.url.connection.client)
    implementation(libs.tika.core)
    implementation(libs.thumbnailator)
    implementation(libs.imageio.webp)
    implementation(libs.pdfbox)
    runtimeOnly(libs.postgresql)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.spring.boot.starter.webmvc.test)
    testImplementation(libs.spring.boot.starter.security.test)
    testImplementation(libs.spring.boot.testcontainers)
    testImplementation(libs.testcontainers.junit.jupiter)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.testcontainers.minio)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.archunit.junit5)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.register("openApiContractCheck") {
    group = "verification"
    description = "Compares the canonical OpenAPI document with the committed contract."
    dependsOn(tasks.test)
    val actual = layout.buildDirectory.file("openapi/openapi.json")
    val expected = layout.projectDirectory.file("../docs/api/openapi.json")
    inputs.file(actual)
    inputs.file(expected)
    doLast {
        fun normalise(text: String) = text.replace("\r\n", "\n").replace("\r", "\n")
        val actualText = normalise(actual.get().asFile.readText(Charsets.UTF_8))
        val expectedText = normalise(expected.asFile.readText(Charsets.UTF_8))
        if (actualText != expectedText) {
            val actualLines = actualText.split('\n')
            val expectedLines = expectedText.split('\n')
            val index =
                (0 until maxOf(actualLines.size, expectedLines.size))
                    .first { actualLines.getOrNull(it) != expectedLines.getOrNull(it) }
            throw GradleException(
                "OpenAPI differs at line ${index + 1}\n" +
                    "Expected: ${expectedLines.getOrNull(index) ?: "<end of file>"}\n" +
                    "Actual: ${actualLines.getOrNull(index) ?: "<end of file>"}",
            )
        }
    }
}

ktlint {
    version = libs.versions.ktlint.cli
}

jib {
    from {
        // eclipse-temurin:21-jre-noble, pinned by digest (resolved 2026-10-05); ships curl for the compose healthcheck.
        image = "eclipse-temurin:21-jre-noble@sha256:000fd431958bc81a24abe1e8e5f0f0fd3ae365a594bd50aadb20696805f9408c"
    }
    to {
        image = "cetele-server:local"
    }
    container {
        ports = listOf("8080")
        user = "65532:65532"
        jvmFlags = listOf("-XX:MaxRAMPercentage=75")
    }
}
