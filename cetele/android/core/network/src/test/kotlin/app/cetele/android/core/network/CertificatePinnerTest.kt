@file:Suppress("DEPRECATION")

package app.cetele.android.core.network

import app.cetele.android.core.network.pinning.CertificatePins
import app.cetele.android.core.network.pinning.PinnedEngineFactory
import okhttp3.CertificatePinner
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import javax.net.ssl.SSLPeerUnverifiedException

class CertificatePinnerTest {
    private fun dummyPin(label: String): String =
        "sha256/" + Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(label.toByteArray()))

    @Test
    fun `trusted server passes matching pins and rejects wrong pins`() {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        MockWebServer().use { server ->
            server.useHttps(serverTls.sslSocketFactory(), false)
            server.start()
            val url = server.url("/")
            val config = ApiConfig(url.toString())

            fun client(pins: CertificatePins) =
                PinnedEngineFactory
                    .client(config, pins)
                    .newBuilder()
                    .sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
                    .build()
            val correct =
                CertificatePins(true, listOf(CertificatePinner.pin(certificate.certificate), dummyPin("backup")))
            server.enqueue(MockResponse().setBody("accepted"))
            client(correct).newCall(Request.Builder().url(url).build()).execute().use { response ->
                assertEquals("accepted", response.body.string())
            }
            val wrong = CertificatePins(true, listOf(dummyPin("wrong"), dummyPin("backup")))
            server.enqueue(MockResponse().setBody("refused"))
            val failure =
                assertThrows<IOException> {
                    client(wrong).newCall(Request.Builder().url(url).build()).execute().close()
                }
            assertTrue(failure.causes().any { it is SSLPeerUnverifiedException }, "pin mismatch expected")
            val debug = client(CertificatePins(false))
            assertTrue(debug.certificatePinner.pins.isEmpty())
            server.enqueue(MockResponse().setBody("debug"))
            debug.newCall(Request.Builder().url(url).build()).execute().use { response ->
                assertTrue(response.isSuccessful)
            }
        }
    }

    // `localhost` resolves to IPv4 and IPv6; the pin failure may be attached to the other route's error.
    private fun Throwable.causes(): Sequence<Throwable> =
        sequence {
            yield(this@causes)
            suppressed.forEach { yieldAll(it.causes()) }
            cause?.let { yieldAll(it.causes()) }
        }

    @Test
    fun `enabled pinning rejects a missing backup and malformed digests`() {
        assertThrows<IllegalArgumentException> { CertificatePins(true, listOf(dummyPin("one"))) }
        assertThrows<IllegalArgumentException> { CertificatePins(true, listOf(dummyPin("one"), dummyPin("one"))) }
        assertThrows<IllegalArgumentException> { CertificatePins(false, listOf("sha256/invalid")) }
    }
}
