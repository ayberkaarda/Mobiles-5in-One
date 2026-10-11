package app.cetele.server.billing

import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.billing.play.HttpPlayDeveloperApi
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.webhook.LocalRtdnSigner
import app.cetele.server.billing.webhook.RemoteRtdnKeySource
import app.cetele.server.billing.webhook.RtdnExpectations
import app.cetele.server.billing.webhook.RtdnKeySource
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.assertj.AssertableApplicationContext
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.json.JsonMapper
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BillingConfigurationTest {
    private fun runner(
        profile: String,
        vararg properties: String,
    ): ApplicationContextRunner =
        ApplicationContextRunner()
            .withInitializer { it.environment.setActiveProfiles(profile) }
            .withBean(Clock::class.java, { Clock.systemUTC() })
            .withBean(ObjectMapper::class.java, { JsonMapper.builder().build() })
            .withUserConfiguration(BillingConfiguration::class.java)
            .withPropertyValues(*properties)

    private fun AssertableApplicationContext.failureMessages(): List<String> {
        assertNotNull(startupFailure)
        return generateSequence(startupFailure) { it.cause }.mapNotNull { it.message }.toList()
    }

    private val tokenKey = Base64.getEncoder().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))

    private val serviceAccount: String by lazy {
        val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val pem =
            "-----BEGIN PRIVATE KEY-----\\n" + Base64.getEncoder().encodeToString(keys.private.encoded) + "\\n-----END PRIVATE KEY-----\\n"
        """{"client_email":"billing@cetele-test.iam.gserviceaccount.com","private_key":"$pem","token_uri":"https://oauth2.googleapis.com/token"}"""
    }

    private fun playProperties(): List<String> =
        listOf(
            "cetele.play.service-account-json=$serviceAccount",
            "cetele.billing.token-key=$tokenKey",
            "cetele.play.rtdn.audience=https://cetele.app/v1/webhooks/play-rtdn",
            "cetele.play.rtdn.service-account-email=rtdn-push@cetele-test.iam.gserviceaccount.com",
        )

    @Test
    fun `play mode requires every value with the contract startup message`() {
        val all = playProperties()
        for (missing in all.indices) {
            runner(
                "staging",
                "cetele.billing.mode=play",
                *all
                    .filterIndexed {
                        index,
                        _,
                        ->
                        index != missing
                    }.toTypedArray(),
            ).run { context ->
                assertTrue(context.failureMessages().any { it == BillingConfiguration.PLAY_MODE_MESSAGE })
            }
        }
    }

    @Test
    fun `play mode builds the real adapters without contacting google`() {
        runner("staging", "cetele.billing.mode=play", *playProperties().toTypedArray()).run { context ->
            assertNull(context.startupFailure)
            assertIs<HttpPlayDeveloperApi>(context.getBean(PlayDeveloperApi::class.java))
            assertIs<RemoteRtdnKeySource>(context.getBean(RtdnKeySource::class.java))
            assertEquals(BillingMode.PLAY, context.getBean(BillingSettings::class.java).mode)
            assertEquals(
                RtdnExpectations("https://cetele.app/v1/webhooks/play-rtdn", "rtdn-push@cetele-test.iam.gserviceaccount.com"),
                context.getBean(RtdnExpectations::class.java),
            )
        }
    }

    @Test
    fun `fake is refused outside local and test`() {
        runner("staging", "cetele.billing.mode=fake").run { context ->
            assertTrue(context.failureMessages().any { it == "fake adapter fake-play-developer-api is not allowed in profiles [staging]" })
        }
    }

    @Test
    fun `an empty mode is fake locally and a startup error elsewhere`() {
        runner("staging").run { context ->
            assertTrue(context.failureMessages().any { it == "CETELE_BILLING_MODE must be set" })
        }
        runner("staging", "cetele.billing.mode=google").run { context ->
            assertTrue(context.failureMessages().any { it == "unknown CETELE_BILLING_MODE" })
        }
        runner("local", "cetele.public-base-url=http://localhost:8080").run { context ->
            assertNull(context.startupFailure)
            val settings = context.getBean(BillingSettings::class.java)
            assertEquals(BillingSettings(BillingMode.FAKE, "cetele_pro", "app.cetele.android"), settings)
            assertIs<FakePlayDeveloperApi>(context.getBean(PlayDeveloperApi::class.java))
            assertIs<LocalRtdnSigner>(context.getBean(RtdnKeySource::class.java))
            assertEquals(
                RtdnExpectations("http://localhost:8080/v1/webhooks/play-rtdn", LocalRtdnSigner.EMAIL),
                context.getBean(RtdnExpectations::class.java),
            )
        }
    }

    @Test
    fun `the token key must be base64 of exactly 32 bytes and is ephemeral only locally`() {
        val short = Base64.getEncoder().encodeToString(ByteArray(16))
        listOf("not base64!", short).forEach { key ->
            runner("local", "cetele.billing.token-key=$key").run { context ->
                val messages = context.failureMessages()
                assertTrue(messages.any { it == "CETELE_BILLING_TOKEN_KEY must be standard Base64 of exactly 32 bytes" })
                assertTrue(messages.none { it.contains(key) })
            }
        }
        runner("local", "cetele.billing.token-key=$tokenKey").run { context -> assertNull(context.startupFailure) }
    }

    @Test
    fun `the product id and package name follow their properties`() {
        runner("test", "cetele.billing.product-id=cetele_pro_v2", "cetele.play.package-name=app.cetele.beta").run { context ->
            assertEquals(
                BillingSettings(BillingMode.FAKE, "cetele_pro_v2", "app.cetele.beta"),
                context.getBean(BillingSettings::class.java),
            )
        }
        runner("test", "cetele.billing.product-id=Cetele Pro").run { context ->
            assertTrue(context.failureMessages().any { it == "CETELE_PLAY_PRO_PRODUCT_ID is not a product id" })
        }
    }

    @Test
    fun `a broken service account or jwks url fails startup without echoing it`() {
        val broken =
            playProperties().map {
                if (it.startsWith("cetele.play.service-account-json=")) "cetele.play.service-account-json={\"x\":1}" else it
            }
        runner("staging", "cetele.billing.mode=play", *broken.toTypedArray()).run { context ->
            assertTrue(context.failureMessages().any { it == "CETELE_PLAY_SERVICE_ACCOUNT_JSON is not a service account key" })
        }
        runner(
            "staging",
            "cetele.billing.mode=play",
            "cetele.play.rtdn.jwks-url=http://keys.example/certs",
            *playProperties().toTypedArray(),
        ).run { context ->
            assertTrue(context.failureMessages().any { it == "CETELE_PLAY_RTDN_JWKS_URL must be an HTTPS URL" })
        }
    }
}
