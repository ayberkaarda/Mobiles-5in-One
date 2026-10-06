package app.cetele.server.auth

import app.cetele.server.auth.integrity.AppRecognition
import app.cetele.server.auth.integrity.FakeIntegrityVerifier
import app.cetele.server.auth.integrity.IntegrityConfiguration
import app.cetele.server.auth.integrity.IntegrityNonce
import app.cetele.server.auth.integrity.IntegrityPolicy
import app.cetele.server.auth.integrity.IntegrityRejection
import app.cetele.server.auth.integrity.IntegrityVerifier
import app.cetele.server.auth.otp.OtpConfiguration
import app.cetele.server.auth.otp.OtpHasher
import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.reminders.sms.SmsConfiguration
import app.cetele.server.reminders.sms.SmsGateway
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.assertj.AssertableApplicationContext
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.ConfigurableApplicationContext
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Every stand-in of the sign-in flow is refused outside the local and test profiles. */
class IntegrityGuardTest {
    @Test
    fun `the guard function refuses the fake verifier outside local and test`() {
        val failure =
            assertFailsWith<IllegalStateException> {
                LocalOnlyAdapterGuard.check(FakeIntegrityVerifier.ADAPTER_NAME, listOf("staging"))
            }
        assertEquals("fake adapter fake-integrity-verifier is not allowed in profiles [staging]", failure.message)
        LocalOnlyAdapterGuard.check(FakeIntegrityVerifier.ADAPTER_NAME, listOf("test"))
        LocalOnlyAdapterGuard.check(FakeIntegrityVerifier.ADAPTER_NAME, listOf("local", "debug"))
    }

    @Test
    fun `the integrity configuration fails to start with the fake mode in profile staging`() {
        runner(IntegrityConfiguration::class.java, "staging", "cetele.integrity.mode=fake").run { context ->
            assertFailedWith(context, "fake adapter fake-integrity-verifier is not allowed in profiles [staging]")
        }
    }

    @Test
    fun `the integrity configuration needs an explicit mode outside local and test`() {
        runner(IntegrityConfiguration::class.java, "prod").run { context ->
            assertFailedWith(context, "CETELE_INTEGRITY_MODE must be set")
        }
        runner(IntegrityConfiguration::class.java, "prod", "cetele.integrity.mode=play").run { context ->
            assertTrue(context.startupFailure != null)
        }
    }

    @Test
    fun `the fake verifier starts in local and test, also without an explicit mode`() {
        runner(IntegrityConfiguration::class.java, "local").run { context ->
            assertNull(context.startupFailure)
            assertTrue(context.getBean(IntegrityVerifier::class.java) is FakeIntegrityVerifier)
        }
        runner(IntegrityConfiguration::class.java, "test", "cetele.integrity.mode=fake").run { context ->
            assertNull(context.startupFailure)
        }
    }

    @Test
    fun `the fake SMS gateway, random pepper and local echo are refused outside local and test`() {
        runner(SmsConfiguration::class.java, "staging", "cetele.sms.provider=fake").run { context ->
            assertFailedWith(context, "fake adapter fake-sms-gateway is not allowed in profiles [staging]")
        }
        runner(SmsConfiguration::class.java, "staging", "cetele.sms.provider=netgsm").run { context ->
            assertTrue(context.startupFailure != null)
        }
        runner(OtpConfiguration::class.java, "staging").run { context ->
            assertFailedWith(context, "fake adapter random-otp-pepper is not allowed in profiles [staging]")
        }
        val pepper = "p".repeat(OtpHasher.MIN_PEPPER_BYTES)
        runner(OtpConfiguration::class.java, "staging", "cetele.otp.pepper=$pepper", "cetele.otp.local-echo=true").run { context ->
            assertFailedWith(context, "fake adapter otp-local-echo is not allowed in profiles [staging]")
        }
        runner(OtpConfiguration::class.java, "staging", "cetele.otp.pepper=short").run { context ->
            assertTrue(context.startupFailure != null)
        }
        runner(OtpConfiguration::class.java, "staging", "cetele.otp.pepper=$pepper").run { context ->
            assertNull(context.startupFailure)
        }
        runner(SmsConfiguration::class.java, "local").run { context ->
            assertNull(context.startupFailure)
            assertNotNull(context.getBean(SmsGateway::class.java))
        }
    }

    @Test
    fun `the policy accepts only a recognised app on a genuine device bound to the request`() {
        val policy = IntegrityPolicy("app.cetele.android")
        val verifier = FakeIntegrityVerifier("app.cetele.android")
        val nonce = IntegrityNonce.of("+905550000000", UUID.randomUUID())
        assertNull(policy.rejection(verifier.decode(FakeIntegrityVerifier.OK, nonce)!!, nonce))
        assertEquals(
            IntegrityRejection.APP_NOT_RECOGNIZED,
            policy.rejection(verifier.decode(FakeIntegrityVerifier.UNRECOGNIZED_APP, nonce)!!, nonce),
        )
        assertEquals(
            IntegrityRejection.NO_DEVICE_INTEGRITY,
            policy.rejection(verifier.decode(FakeIntegrityVerifier.NO_DEVICE_INTEGRITY, nonce)!!, nonce),
        )
        assertEquals(
            IntegrityRejection.PACKAGE_MISMATCH,
            policy.rejection(verifier.decode(FakeIntegrityVerifier.PACKAGE_MISMATCH, nonce)!!, nonce),
        )
        val otherRequest = IntegrityNonce.of("+905550000001", UUID.randomUUID())
        assertEquals(IntegrityRejection.NONCE_MISMATCH, policy.rejection(verifier.decode(FakeIntegrityVerifier.OK, otherRequest)!!, nonce))
        val unevaluated = verifier.decode(FakeIntegrityVerifier.OK, nonce)!!.copy(appRecognition = AppRecognition.UNEVALUATED)
        assertEquals(IntegrityRejection.APP_NOT_RECOGNIZED, policy.rejection(unevaluated, nonce))
        assertNull(verifier.decode("fake.anything-else", nonce))
    }

    private fun runner(
        configuration: Class<*>,
        profile: String,
        vararg properties: String,
    ): ApplicationContextRunner =
        ApplicationContextRunner()
            .withInitializer { context: ConfigurableApplicationContext -> context.environment.setActiveProfiles(profile) }
            .withUserConfiguration(configuration)
            .withPropertyValues(*properties)

    private fun assertFailedWith(
        context: AssertableApplicationContext,
        message: String,
    ) {
        assertThat(context).hasFailed()
        val messages = generateSequence(context.startupFailure) { it.cause }.mapNotNull { it.message }.toList()
        assertTrue(messages.any { it == message }, "startup failure does not carry the guard message: $messages")
    }
}
