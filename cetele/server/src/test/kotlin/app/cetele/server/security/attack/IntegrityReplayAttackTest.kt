package app.cetele.server.security.attack

import app.cetele.server.auth.integrity.FakePlayIntegrityApi
import app.cetele.server.auth.integrity.IntegrityDecodeResult
import app.cetele.server.auth.integrity.IntegrityNonce
import app.cetele.server.auth.integrity.IntegrityPolicy
import app.cetele.server.auth.integrity.IntegrityTokenPayload
import app.cetele.server.auth.integrity.IntegrityVerifier
import app.cetele.server.auth.integrity.PlayIntegrityVerifier
import app.cetele.server.reminders.sms.FakeSmsGateway
import app.cetele.server.reminders.sms.SmsGateway
import app.cetele.server.security.attack.AttackSupport.Companion.assertProblem
import app.cetele.server.support.MinioTestConfiguration
import app.cetele.server.support.PostgresTestConfiguration
import app.cetele.server.support.TestUsers
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.test.context.ActiveProfiles
import java.time.Clock
import java.time.Duration
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Integrity-token replay and nonce attacks. The fake verifier of profile `test` binds every token
 * to the request by construction, so this class runs the production [PlayIntegrityVerifier] over
 * a stubbed Google port ([FakePlayIntegrityApi]) in its own context: the decoded payload, its
 * nonce and its timestamp are chosen by the test, exactly what a replayed or transplanted genuine
 * token would carry. Google's own decoding is not exercised (ADR-0004 G3).
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["CETELE_TRUSTED_PROXIES=127\\.0\\.0\\.2"],
)
@ActiveProfiles("test")
@Import(PostgresTestConfiguration::class, MinioTestConfiguration::class, IntegrityReplayAttackTest.PlayVerifier::class)
class IntegrityReplayAttackTest {
    @LocalServerPort
    private var port: Int = 0

    @Autowired private lateinit var clock: Clock

    @Autowired private lateinit var gateway: SmsGateway

    private val http by lazy { RawHttp(port) }

    private val sms: FakeSmsGateway get() = gateway as FakeSmsGateway

    @TestConfiguration(proxyBeanMethods = false)
    class PlayVerifier {
        @Bean
        @Primary
        fun playIntegrityVerifier(clock: Clock): IntegrityVerifier = PlayIntegrityVerifier(GOOGLE, clock)
    }

    /** Registers a genuine-looking verdict for a new token, bound to [phone] and [device], requested at [age] ago. */
    private fun token(
        phone: String,
        device: UUID,
        age: Duration = Duration.ofSeconds(5),
        nonce: String? = IntegrityNonce.of(phone, device),
    ): String {
        val token = "play-token-" + UUID.randomUUID()
        val payload =
            IntegrityTokenPayload(
                requestPackageName = PACKAGE,
                nonce = nonce,
                requestHash = null,
                timestampMillis = clock.instant().minus(age).toEpochMilli(),
                appRecognitionVerdict = "PLAY_RECOGNIZED",
                appPackageName = PACKAGE,
                deviceRecognitionVerdict = setOf(IntegrityPolicy.MEETS_DEVICE_INTEGRITY),
            )
        synchronized(GOOGLE) { GOOGLE.put(token, IntegrityDecodeResult.Decoded(payload)) }
        return token
    }

    private fun request(
        phone: String,
        device: UUID,
        token: String,
    ) = http.exchange(
        "POST",
        "/v1/auth/otp/request",
        mapOf("Content-Type" to "application/json"),
        """{"phone":"$phone","deviceId":"$device","integrityToken":"$token"}""".toByteArray(),
    )

    @Test
    fun `control - a fresh token bound to the request is accepted`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        assertEquals(202, request(phone, device, token(phone, device)).status)
        assertEquals(1, sms.messagesTo(phone).size)
    }

    @Test
    fun `a genuine token transplanted to another phone or device is refused`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        val genuine = token(phone, device)
        val victim = TestUsers.phone()
        assertProblem(request(victim, device, genuine), 403, "auth.integrity_invalid", "token of another phone")
        assertProblem(request(phone, UUID.randomUUID(), genuine), 403, "auth.integrity_invalid", "token of another device")
        assertTrue(sms.messagesTo(victim).isEmpty())
        assertTrue(sms.messagesTo(phone).isEmpty())
    }

    @Test
    fun `wrong or missing nonce is refused`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        listOf(null, "", "AAAA", IntegrityNonce.of(phone, device).uppercase(), IntegrityNonce.of(phone + "0", device)).forEach { nonce ->
            assertProblem(request(phone, device, token(phone, device, nonce = nonce)), 403, "auth.integrity_invalid", "nonce '$nonce'")
        }
        assertTrue(sms.messagesTo(phone).isEmpty())
    }

    @Test
    fun `a token replayed after five minutes or dated in the future is refused`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        assertProblem(request(phone, device, token(phone, device, age = Duration.ofMinutes(6))), 403, "auth.integrity_invalid", "stale")
        assertProblem(request(phone, device, token(phone, device, age = Duration.ofMinutes(-5))), 403, "auth.integrity_invalid", "future")
        assertTrue(sms.messagesTo(phone).isEmpty())
    }

    @Test
    fun `a fresh token replayed for the same phone and device is capped by the phone bucket`() {
        val phone = TestUsers.phone()
        val device = UUID.randomUUID()
        val genuine = token(phone, device)
        // Accepted residual (pentest report): the token is not single use inside its five minutes.
        repeat(3) { assertEquals(202, request(phone, device, genuine).status) }
        assertProblem(request(phone, device, genuine), 429, "rate_limited", "fourth replay")
        assertEquals(3, sms.messagesTo(phone).size)
    }

    private companion object {
        const val PACKAGE = "app.cetele.android"
        val GOOGLE = FakePlayIntegrityApi()
    }
}
