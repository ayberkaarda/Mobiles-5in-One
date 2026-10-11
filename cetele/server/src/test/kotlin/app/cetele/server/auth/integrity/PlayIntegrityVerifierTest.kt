package app.cetele.server.auth.integrity

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * [PlayIntegrityVerifier] against the fake adapter of the [PlayIntegrityApi] port, with the real
 * [IntegrityPolicy] and [IntegrityGate]: the nonce binding of the Phase 2 handoff, every verdict
 * field, and failing closed. No verdict here comes from Google (`not exercised: no Play Console
 * account`).
 */
class PlayIntegrityVerifierTest {
    private val now = Instant.parse("2026-10-11T09:30:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)
    private val api = FakePlayIntegrityApi()
    private val verifier = PlayIntegrityVerifier(api, clock)
    private val policy = IntegrityPolicy(PACKAGE)
    private val gate = IntegrityGate(verifier, policy)
    private val phone = "+905551234567"
    private val deviceId: UUID = UUID.fromString("0192f1a4-7c3e-7b2a-9d1e-5f6a7b8c9d0e")
    private val nonce = IntegrityNonce.of(phone, deviceId)

    private fun genuine(
        nonce: String? = this.nonce,
        requestHash: String? = null,
        requestedAt: Instant? = now.minusSeconds(5),
        requestPackage: String? = PACKAGE,
        appPackage: String? = PACKAGE,
        app: String? = "PLAY_RECOGNIZED",
        device: Set<String> = setOf("MEETS_DEVICE_INTEGRITY"),
    ) = IntegrityTokenPayload(requestPackage, nonce, requestHash, requestedAt?.toEpochMilli(), app, appPackage, device)

    private fun verdictFor(payload: IntegrityTokenPayload): IntegrityVerdict? {
        val token = "play-token-" + UUID.randomUUID()
        api.put(token, IntegrityDecodeResult.Decoded(payload))
        return verifier.decode(token, nonce)
    }

    private fun rejection(payload: IntegrityTokenPayload): IntegrityRejection? = policy.rejection(assertNotNull(verdictFor(payload)), nonce)

    @Test
    fun `the nonce is the request hash of the phase 2 handoff`() {
        // base64url_nopad(SHA-256(UTF-8(phone_e164 + deviceId))), spelled out here from the handoff text.
        val digest =
            java.security.MessageDigest
                .getInstance("SHA-256")
                .digest("$phone$deviceId".toByteArray(Charsets.UTF_8))
        assertEquals(
            java.util.Base64
                .getUrlEncoder()
                .withoutPadding()
                .encodeToString(digest),
            nonce,
        )
        assertEquals(43, nonce.length)
    }

    @Test
    fun `a recognised app on a genuine device bound to this request passes the gate`() {
        assertNull(rejection(genuine()))
        // A standard request would carry the same value as requestHash.
        assertNull(rejection(genuine(nonce = null, requestHash = nonce)))
        // Stronger device verdicts come with MEETS_DEVICE_INTEGRITY and do not hurt.
        assertNull(rejection(genuine(device = setOf("MEETS_BASIC_INTEGRITY", "MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"))))
        api.put("gate-ok", IntegrityDecodeResult.Decoded(genuine()))
        gate.require("gate-ok", phone, deviceId)
    }

    @Test
    fun `a token bound to another phone, device or nothing is refused`() {
        listOf(
            IntegrityNonce.of("+905551234568", deviceId),
            IntegrityNonce.of(phone, UUID.randomUUID()),
            IntegrityNonce.of(phone, deviceId).dropLast(1),
            IntegrityNonce.of(phone.removePrefix("+"), deviceId),
            // The device id in upper case is a different text, so a different hash.
            java.util.Base64
                .getUrlEncoder()
                .withoutPadding()
                .encodeToString(
                    java.security.MessageDigest
                        .getInstance("SHA-256")
                        .digest((phone + deviceId.toString().uppercase()).toByteArray(Charsets.UTF_8)),
                ),
        ).forEach { other ->
            assertEquals(IntegrityRejection.NONCE_MISMATCH, rejection(genuine(nonce = other)))
        }
        assertEquals(IntegrityRejection.NONCE_MISMATCH, rejection(genuine(nonce = null, requestHash = null)))
        val token = "bound-elsewhere"
        api.put(token, IntegrityDecodeResult.Decoded(genuine(nonce = IntegrityNonce.of(phone, UUID.randomUUID()))))
        assertInvalid { gate.require(token, phone, deviceId) }
    }

    @Test
    fun `app, device and package verdicts are checked`() {
        assertEquals(IntegrityRejection.APP_NOT_RECOGNIZED, rejection(genuine(app = "UNRECOGNIZED_VERSION")))
        assertEquals(IntegrityRejection.APP_NOT_RECOGNIZED, rejection(genuine(app = "UNEVALUATED", appPackage = null)))
        assertEquals(IntegrityRejection.APP_NOT_RECOGNIZED, rejection(genuine(app = "SOMETHING_NEW")))
        assertEquals(IntegrityRejection.APP_NOT_RECOGNIZED, rejection(genuine(app = null)))
        assertEquals(IntegrityRejection.NO_DEVICE_INTEGRITY, rejection(genuine(device = setOf("MEETS_BASIC_INTEGRITY"))))
        assertEquals(IntegrityRejection.NO_DEVICE_INTEGRITY, rejection(genuine(device = setOf("MEETS_VIRTUAL_INTEGRITY"))))
        assertEquals(IntegrityRejection.NO_DEVICE_INTEGRITY, rejection(genuine(device = emptySet())))
        assertEquals(
            IntegrityRejection.PACKAGE_MISMATCH,
            rejection(genuine(requestPackage = "$PACKAGE.repackaged", appPackage = "$PACKAGE.repackaged")),
        )
        // Requested for this package but evaluated as another app: never accepted.
        assertEquals(IntegrityRejection.PACKAGE_MISMATCH, rejection(genuine(appPackage = "$PACKAGE.repackaged")))
        assertEquals(IntegrityRejection.PACKAGE_MISMATCH, rejection(genuine(requestPackage = "$PACKAGE.repackaged")))
    }

    @Test
    fun `stale, future and undated tokens are refused`() {
        assertNotNull(verdictFor(genuine(requestedAt = now.minus(PlayIntegrityVerifier.MAX_AGE))))
        assertNotNull(verdictFor(genuine(requestedAt = now.plus(PlayIntegrityVerifier.MAX_CLOCK_SKEW))))
        assertNull(verdictFor(genuine(requestedAt = now.minus(PlayIntegrityVerifier.MAX_AGE).minusMillis(1))))
        assertNull(verdictFor(genuine(requestedAt = now.minus(Duration.ofDays(2)))))
        assertNull(verdictFor(genuine(requestedAt = now.plus(PlayIntegrityVerifier.MAX_CLOCK_SKEW).plusMillis(1))))
        assertNull(verdictFor(genuine(requestedAt = null)))
        assertNull(verdictFor(genuine(requestPackage = null)))
    }

    @Test
    fun `refused, unknown and unreachable decodes fail closed`() {
        api.put("refused", IntegrityDecodeResult.Invalid)
        api.put("down", IntegrityDecodeResult.Unavailable("http_503"))
        api.put("no-token", IntegrityDecodeResult.Unavailable("token_transport"))
        listOf("refused", "down", "no-token", "never-issued").forEach { token ->
            assertNull(verifier.decode(token, nonce), token)
            assertInvalid { gate.require(token, phone, deviceId) }
        }
        // Missing and oversized tokens never reach Google.
        val before = api.calls
        assertEquals(ProblemCode.AUTH_INTEGRITY_REQUIRED, assertFailsWith<ProblemException> { gate.require(" ", phone, deviceId) }.code)
        assertInvalid { gate.require("a".repeat(IntegrityGate.MAX_TOKEN_LENGTH + 1), phone, deviceId) }
        assertEquals(before, api.calls)
    }

    private fun assertInvalid(block: () -> Unit) {
        assertEquals(ProblemCode.AUTH_INTEGRITY_INVALID, assertFailsWith<ProblemException> { block() }.code)
    }

    companion object {
        const val PACKAGE = "app.cetele.android"
    }
}
