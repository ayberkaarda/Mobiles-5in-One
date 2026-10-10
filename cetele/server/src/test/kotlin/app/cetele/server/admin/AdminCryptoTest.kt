package app.cetele.server.admin

import app.cetele.server.admin.audit.AuditIpHasher
import app.cetele.server.admin.totp.TotpCipher
import app.cetele.server.admin.totp.TotpService
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** TOTP, the secret encryption, the ip hash, passwords and the session lifetimes, without Spring. */
class AdminCryptoTest {
    private val key = Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() })
    private val prod = MockEnvironment().apply { setActiveProfiles("prod") }
    private val test = MockEnvironment().apply { setActiveProfiles("test") }

    // RFC 6238 appendix B, SHA-1 seed "12345678901234567890" in Base32.
    private val rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    private fun totpAt(epochSecond: Long) = TotpService(Clock.fixed(Instant.ofEpochSecond(epochSecond), ZoneOffset.UTC))

    @Test
    fun `totp matches the rfc 6238 vectors and reports the step`() {
        // T = 59 s is step 1, code 94287082 (8 digits) -> 287082; T = 1111111109 is step 37037036, code 07081804 -> 081804.
        assertEquals(1L, totpAt(59).matchStep(rfcSecret, "287082"))
        assertEquals(37037036L, totpAt(1111111109).matchStep(rfcSecret, "081804"))
    }

    @Test
    fun `totp accepts one step of drift and refuses stale or malformed codes`() {
        assertEquals(1L, totpAt(59 + 30).matchStep(rfcSecret, "287082"), "one step late")
        assertEquals(1L, totpAt(59 - 30).matchStep(rfcSecret, "287082"), "one step early")
        assertNull(totpAt(59 + 60).matchStep(rfcSecret, "287082"), "two steps late")
        assertNull(totpAt(59).matchStep(rfcSecret, "28708"))
        assertNull(totpAt(59).matchStep(rfcSecret, "2870822"))
        assertNull(totpAt(59).matchStep(rfcSecret, "28708a"))
    }

    @Test
    fun `secrets are 160 random bits and the enrollment carries the otpauth uri and a png`() {
        val service = totpAt(59)
        val secret = service.newSecret()
        assertEquals(32, secret.length)
        assertTrue(Regex("^[A-Z2-7]{32}$").matches(secret))
        assertNotEquals(secret, service.newSecret())
        val enrollment = service.enrollment(secret, "ops@cetele.test")
        assertTrue(enrollment.uri.startsWith("otpauth://totp/"))
        assertTrue(enrollment.uri.contains("secret=$secret"))
        assertTrue(enrollment.uri.contains("digits=6") && enrollment.uri.contains("period=30") && enrollment.uri.contains("algorithm=SHA1"))
        assertTrue(enrollment.qrDataUri.startsWith("data:image/png;base64,"))
    }

    @Test
    fun `the totp secret is sealed with aes-256-gcm in the documented layout`() {
        val cipher = TotpCipher(AdminProperties(totpKey = key), prod)
        val sealed = cipher.encrypt(rfcSecret)
        assertEquals(1 + 12 + rfcSecret.length + 16, sealed.size)
        assertEquals(0x01, sealed[0].toInt())
        assertEquals(rfcSecret, cipher.decrypt(sealed))
        assertFalse(cipher.encrypt(rfcSecret).contentEquals(sealed), "fresh nonce per encryption")

        val tampered = sealed.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        assertNull(cipher.decrypt(tampered))
        val otherKey = Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        assertNull(TotpCipher(AdminProperties(totpKey = otherKey), prod).decrypt(sealed))
        assertNull(cipher.decrypt(byteArrayOf(0x02) + sealed.copyOfRange(1, sealed.size)))
    }

    @Test
    fun `stand-in keys are local only and configured keys are validated`() {
        assertFailsWith<IllegalStateException> { TotpCipher(AdminProperties(), prod) }
        assertFailsWith<IllegalStateException> { AuditIpHasher(AuditProperties(), prod) }
        TotpCipher(AdminProperties(), test)
        AuditIpHasher(AuditProperties(), test)
        assertFailsWith<IllegalStateException> { TotpCipher(AdminProperties(totpKey = "kisa"), prod) }
        assertFailsWith<IllegalStateException> {
            TotpCipher(
                AdminProperties(totpKey = Base64.getEncoder().encodeToString(ByteArray(16))),
                prod,
            )
        }
        assertFailsWith<IllegalStateException> {
            AuditIpHasher(
                AuditProperties(ipKey = Base64.getEncoder().encodeToString(ByteArray(16))),
                prod,
            )
        }
        assertFalse(AdminProperties(totpKey = key).toString().contains(key))
    }

    @Test
    fun `the ip hash is lowercase hex hmac-sha256`() {
        val hasher = AuditIpHasher(AuditProperties(ipKey = key), prod)
        val expected =
            javax.crypto.Mac
                .getInstance("HmacSHA256")
                .apply { init(javax.crypto.spec.SecretKeySpec(Base64.getDecoder().decode(key), "HmacSHA256")) }
                .doFinal("203.0.113.7".toByteArray())
        assertEquals(
            java.util.HexFormat
                .of()
                .formatHex(expected),
            hasher.hash("203.0.113.7"),
        )
        assertTrue(Regex("^[0-9a-f]{64}$").matches(hasher.hash("2001:db8::1")))
        assertNotEquals(hasher.hash("203.0.113.7"), hasher.hash("203.0.113.8"))
    }

    @Test
    fun `passwords use argon2id with the spec parameters and bounded length`() {
        val passwords = AdminPasswords()
        val hash = passwords.hash("[ÖRNEK] uzun parola")
        assertTrue(hash.startsWith("\$argon2id\$v=19\$m=65536,t=3,p=1\$"), hash)
        assertTrue(passwords.matches("[ÖRNEK] uzun parola", hash))
        assertFalse(passwords.matches("[ÖRNEK] uzun parolA", hash))
        assertFalse(passwords.matches("[ÖRNEK] uzun parola", null), "the dummy hash never matches")
        assertFalse(passwords.isAcceptable("a".repeat(11)))
        assertTrue(passwords.isAcceptable("a".repeat(12)))
        assertTrue(passwords.isAcceptable("a".repeat(128)))
        assertFalse(passwords.isAcceptable("a".repeat(129)))
        assertFailsWith<IllegalArgumentException> { passwords.hash("kisa") }
        val oneTime = passwords.oneTimePassword()
        assertEquals(20, oneTime.length)
        assertTrue(passwords.isAcceptable(oneTime))
    }

    @Test
    fun `sessions end after thirty idle minutes or twelve hours`() {
        val start = Instant.parse("2026-10-11T08:00:00Z")
        assertFalse(AdminSessionPolicy.isExpired(start, start, start.plus(Duration.ofMinutes(29))))
        assertTrue(AdminSessionPolicy.isExpired(start, start, start.plus(Duration.ofMinutes(30))))
        val active = start.plus(Duration.ofHours(11)).plus(Duration.ofMinutes(50))
        assertFalse(AdminSessionPolicy.isExpired(start, active, active.plus(Duration.ofMinutes(5))))
        assertTrue(AdminSessionPolicy.isExpired(start, active, start.plus(Duration.ofHours(12))))
        assertTrue(AdminSessionPolicy.isExpired(null, start, start))
        assertContentEquals(listOf("ADMIN", "SUPPORT"), AdminRole.entries.map { it.name })
    }
}
