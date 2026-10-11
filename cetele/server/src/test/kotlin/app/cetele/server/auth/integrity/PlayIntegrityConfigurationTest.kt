package app.cetele.server.auth.integrity

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.assertj.AssertableApplicationContext
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.ConfigurableApplicationContext
import java.security.KeyPairGenerator
import java.util.Base64
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `CETELE_INTEGRITY_MODE=play` selects [PlayIntegrityVerifier] on the shared service account and
 * fails at startup without a usable one. Starting it makes no network call (the access token is
 * fetched on the first decode).
 */
class PlayIntegrityConfigurationTest {
    @Test
    fun `play mode selects the play verifier in a production profile`() {
        runner("prod", "cetele.integrity.mode=play", "cetele.play.service-account-json=${serviceAccountJson()}").run { context ->
            assertNull(context.startupFailure)
            assertTrue(context.getBean(IntegrityVerifier::class.java) is PlayIntegrityVerifier)
        }
    }

    @Test
    fun `play mode without a service account or with a broken one fails at startup without echoing it`() {
        runner("prod", "cetele.integrity.mode=play").run { context ->
            assertFailedWith(context, IntegrityConfiguration.PLAY_MODE_MESSAGE)
        }
        val broken = """{"client_email":"x@y.z","private_key":"GIZLI-ANAHTAR","token_uri":"https://oauth2.googleapis.com/token"}"""
        runner("prod", "cetele.integrity.mode=play", "cetele.play.service-account-json=$broken").run { context ->
            assertFailedWith(context, "CETELE_PLAY_SERVICE_ACCOUNT_JSON is not a service account key")
            val messages = generateSequence(context.startupFailure) { it.cause }.mapNotNull { it.message }.toList()
            assertTrue(messages.none { it.contains("GIZLI-ANAHTAR") })
        }
    }

    private fun serviceAccountJson(): String {
        val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val body = Base64.getEncoder().encodeToString(keys.private.encoded)
        return """{"type":"service_account","client_email":"play-integrity@cetele-test.iam.gserviceaccount.com",""" +
            """"private_key":"-----BEGIN PRIVATE KEY-----\n$body\n-----END PRIVATE KEY-----\n","token_uri":"https://oauth2.googleapis.com/token"}"""
    }

    private fun runner(
        profile: String,
        vararg properties: String,
    ): ApplicationContextRunner =
        ApplicationContextRunner()
            .withInitializer { context: ConfigurableApplicationContext -> context.environment.setActiveProfiles(profile) }
            .withUserConfiguration(IntegrityConfiguration::class.java)
            .withPropertyValues(*properties)

    private fun assertFailedWith(
        context: AssertableApplicationContext,
        message: String,
    ) {
        assertThat(context).hasFailed()
        val messages = generateSequence(context.startupFailure) { it.cause }.mapNotNull { it.message }.toList()
        assertTrue(messages.any { it.contains(message) }, messages.toString())
    }
}
