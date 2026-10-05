package app.cetele.server.auth

import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.support.PostgresTestConfiguration
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.ActiveProfiles
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Client addresses come from Tomcat's RemoteIpValve, which MockMvc does not run, so this test
 * talks to a real server port. With no trusted proxy configured (the default), a spoofed
 * `X-Forwarded-For` must not change the per-IP bucket: the eleventh OTP request from the same
 * peer is limited however many different addresses it claims.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import(PostgresTestConfiguration::class)
class TrustedProxyTest(
    @Value("\${local.server.port}") private val port: Int,
) {
    private val http = HttpClient.newHttpClient()

    @Test
    fun `a spoofed X-Forwarded-For from an untrusted peer does not change the bucket key`() {
        repeat(10) { index ->
            val response = requestOtp(spoofedFor = "203.0.113.${index + 1}")
            assertEquals(202, response.statusCode(), "request ${index + 1}")
        }
        val limited = requestOtp(spoofedFor = "198.51.100.77")
        assertEquals(429, limited.statusCode())
        assertNotNull(limited.headers().firstValue("Retry-After").orElse(null))
    }

    private fun requestOtp(spoofedFor: String): HttpResponse<String> {
        val body = """{"phone":"${TestUsers.phone()}","deviceId":"${UUID.randomUUID()}","integrityToken":"${FakeIntegrityVerifier.OK}"}"""
        val request =
            HttpRequest
                .newBuilder(URI.create("http://127.0.0.1:$port/v1/auth/otp/request"))
                .header("Content-Type", "application/json")
                .header("X-Forwarded-For", spoofedFor)
                .header("X-Real-IP", spoofedFor)
                .header("Forwarded", "for=$spoofedFor")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build()
        return http.send(request, HttpResponse.BodyHandlers.ofString())
    }
}
