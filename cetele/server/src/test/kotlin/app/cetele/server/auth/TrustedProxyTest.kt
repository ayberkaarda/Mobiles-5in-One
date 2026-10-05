package app.cetele.server.auth

import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.support.PostgresTestConfiguration
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.test.context.ActiveProfiles
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Client addresses come from Tomcat's RemoteIpValve, which MockMvc does not run, so this test
 * talks to a real server port over raw sockets. Only `127.0.0.2` is a trusted proxy here: its
 * `X-Forwarded-For` decides the bucket key, while the same header from the untrusted peer
 * `127.0.0.1` is ignored. Both cases share one application context.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["CETELE_TRUSTED_PROXIES=127\\.0\\.0\\.2"],
)
@ActiveProfiles("test")
@Import(PostgresTestConfiguration::class)
class TrustedProxyTest(
    @Value("\${local.server.port}") private val port: Int,
) {
    @Test
    fun `a spoofed X-Forwarded-For from an untrusted peer does not change the bucket key`() {
        repeat(10) { index ->
            val response = requestOtp(from = UNTRUSTED_PEER, forwardedFor = "203.0.113.${index + 1}")
            assertEquals(202, response.status, "request ${index + 1}")
        }
        val limited = requestOtp(from = UNTRUSTED_PEER, forwardedFor = "198.51.100.77")
        assertEquals(429, limited.status)
        assertTrue(limited.headers.containsKey("retry-after"))
    }

    @Test
    fun `X-Forwarded-For from a trusted proxy decides the bucket key`() {
        val client = "192.0.2.10"
        repeat(10) { assertEquals(202, requestOtp(from = TRUSTED_PROXY, forwardedFor = client).status) }
        assertEquals(429, requestOtp(from = TRUSTED_PROXY, forwardedFor = client).status, "same forwarded client shares one bucket")
        assertEquals(
            202,
            requestOtp(from = TRUSTED_PROXY, forwardedFor = "192.0.2.11").status,
            "another forwarded client has its own bucket",
        )
    }

    private data class RawResponse(
        val status: Int,
        val headers: Map<String, String>,
    )

    private fun requestOtp(
        from: String,
        forwardedFor: String,
    ): RawResponse {
        val body = """{"phone":"${TestUsers.phone()}","deviceId":"${UUID.randomUUID()}","integrityToken":"${FakeIntegrityVerifier.OK}"}"""
        val bytes = body.toByteArray(Charsets.UTF_8)
        val head =
            "POST /v1/auth/otp/request HTTP/1.1\r\n" +
                "Host: 127.0.0.1:$port\r\n" +
                "Content-Type: application/json\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                "X-Forwarded-For: $forwardedFor\r\n" +
                "Connection: close\r\n\r\n"
        Socket().use { socket ->
            socket.bind(InetSocketAddress(InetAddress.getByName(from), 0))
            socket.connect(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), TIMEOUT_MS)
            socket.soTimeout = TIMEOUT_MS
            socket.getOutputStream().apply {
                write(head.toByteArray(Charsets.US_ASCII))
                write(bytes)
                flush()
            }
            val lines =
                socket
                    .getInputStream()
                    .readBytes()
                    .toString(Charsets.UTF_8)
                    .substringBefore("\r\n\r\n")
                    .split("\r\n")
            val status = lines.first().split(" ")[1].toInt()
            val headers = lines.drop(1).associate { it.substringBefore(":").lowercase() to it.substringAfter(":").trim() }
            return RawResponse(status, headers)
        }
    }

    companion object {
        private const val UNTRUSTED_PEER = "127.0.0.1"
        private const val TRUSTED_PROXY = "127.0.0.2"
        private const val TIMEOUT_MS = 10_000
    }
}
