package app.cetele.server.billing

import app.cetele.server.auth.integrity.IntegrityConfiguration
import app.cetele.server.billing.play.FakePlayDeveloperApi
import app.cetele.server.billing.play.GoogleServiceAccountTokens
import app.cetele.server.billing.play.HttpPlayDeveloperApi
import app.cetele.server.billing.play.PlayDeveloperApi
import app.cetele.server.billing.play.ServiceAccountKey
import app.cetele.server.billing.webhook.LocalRtdnSigner
import app.cetele.server.billing.webhook.RemoteRtdnKeySource
import app.cetele.server.billing.webhook.RtdnExpectations
import app.cetele.server.billing.webhook.RtdnKeySource
import app.cetele.server.config.LocalOnlyAdapterGuard
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.time.Clock
import java.time.Duration

enum class BillingMode {
    FAKE,
    PLAY,
}

/** The resolved billing configuration (ADR-0031 `CETELE_BILLING_MODE`, product and package). */
data class BillingSettings(
    val mode: BillingMode,
    val productId: String,
    val packageName: String,
)

/**
 * Selects the Play adapters from `CETELE_BILLING_MODE`: `fake` (local and test only, through
 * `LocalOnlyAdapterGuard`) or `play`, which needs the service account, the token key and both RTDN
 * values. Empty means `fake` in `local` and `test` and a startup error elsewhere.
 */
@Configuration(proxyBeanMethods = false)
class BillingConfiguration {
    private val log = LoggerFactory.getLogger(BillingConfiguration::class.java)

    @Bean
    fun billingSettings(environment: Environment): BillingSettings {
        val mode = property(environment, MODE_PROPERTY)
        val resolved =
            when {
                mode == MODE_FAKE || (mode.isEmpty() && LocalOnlyAdapterGuard.isAllowed(environment)) -> BillingMode.FAKE
                mode == MODE_PLAY -> BillingMode.PLAY
                mode.isEmpty() -> error("CETELE_BILLING_MODE must be set")
                else -> error("unknown CETELE_BILLING_MODE")
            }
        if (resolved == BillingMode.PLAY) {
            val required =
                listOf(SERVICE_ACCOUNT_PROPERTY, TOKEN_KEY_PROPERTY, RTDN_AUDIENCE_PROPERTY, RTDN_EMAIL_PROPERTY)
            check(required.all { property(environment, it).isNotEmpty() }) { PLAY_MODE_MESSAGE }
        } else {
            LocalOnlyAdapterGuard.check(FakePlayDeveloperApi.ADAPTER_NAME, environment)
        }
        val productId = property(environment, PRODUCT_PROPERTY).ifEmpty { DEFAULT_PRODUCT }
        check(productId.length <= Subscription.MAX_ID && PRODUCT_ID.matches(productId)) { "CETELE_PLAY_PRO_PRODUCT_ID is not a product id" }
        val packageName = property(environment, IntegrityConfiguration.PACKAGE_PROPERTY).ifEmpty { IntegrityConfiguration.DEFAULT_PACKAGE }
        return BillingSettings(resolved, productId, packageName)
    }

    @Bean
    fun purchaseTokenCipher(
        settings: BillingSettings,
        environment: Environment,
    ): PurchaseTokenCipher {
        val key = property(environment, TOKEN_KEY_PROPERTY)
        if (key.isEmpty()) {
            LocalOnlyAdapterGuard.check(EPHEMERAL_TOKEN_KEY_ADAPTER, environment)
            log.warn("Using an ephemeral billing token key; stored purchase tokens do not survive a restart")
            return PurchaseTokenCipher.ephemeral()
        }
        return PurchaseTokenCipher.fromBase64(key)
    }

    @Bean
    fun playDeveloperApi(
        settings: BillingSettings,
        environment: Environment,
        mapper: ObjectMapper,
        clock: Clock,
    ): PlayDeveloperApi =
        when (settings.mode) {
            BillingMode.FAKE -> {
                FakePlayDeveloperApi(settings.productId, clock)
            }

            BillingMode.PLAY -> {
                val key = ServiceAccountKey.parse(property(environment, SERVICE_ACCOUNT_PROPERTY), mapper)
                val tokens =
                    GoogleServiceAccountTokens(key, GoogleServiceAccountTokens.ANDROID_PUBLISHER_SCOPE, restClient(null), mapper, clock)
                HttpPlayDeveloperApi(restClient(HttpPlayDeveloperApi.BASE_URL), settings.packageName, tokens, mapper)
            }
        }

    @Bean
    fun rtdnKeySource(
        settings: BillingSettings,
        environment: Environment,
        clock: Clock,
    ): RtdnKeySource =
        when (settings.mode) {
            BillingMode.FAKE -> {
                LocalOnlyAdapterGuard.check(LocalRtdnSigner.ADAPTER_NAME, environment)
                LocalRtdnSigner(clock)
            }

            BillingMode.PLAY -> {
                val url = property(environment, RTDN_JWKS_URL_PROPERTY).ifEmpty { DEFAULT_JWKS_URL }
                val uri = runCatching { URI.create(url) }.getOrNull()
                check(
                    uri != null && uri.scheme == "https" && !uri.host.isNullOrBlank(),
                ) { "CETELE_PLAY_RTDN_JWKS_URL must be an HTTPS URL" }
                RemoteRtdnKeySource(uri.toURL())
            }
        }

    @Bean
    fun rtdnExpectations(
        settings: BillingSettings,
        environment: Environment,
    ): RtdnExpectations {
        val audience =
            property(environment, RTDN_AUDIENCE_PROPERTY).ifEmpty {
                property(environment, PUBLIC_BASE_URL_PROPERTY).trimEnd('/') + RtdnExpectations.PATH
            }
        val email =
            property(environment, RTDN_EMAIL_PROPERTY).ifEmpty {
                check(settings.mode == BillingMode.FAKE) { PLAY_MODE_MESSAGE }
                LocalRtdnSigner.EMAIL
            }
        return RtdnExpectations(audience, email)
    }

    private fun restClient(baseUrl: String?): RestClient {
        val factory = SimpleClientHttpRequestFactory()
        factory.setConnectTimeout(CONNECT_TIMEOUT)
        factory.setReadTimeout(READ_TIMEOUT)
        val builder = RestClient.builder().requestFactory(factory)
        if (baseUrl != null) builder.baseUrl(baseUrl)
        return builder.build()
    }

    private fun property(
        environment: Environment,
        name: String,
    ): String = environment.getProperty(name).orEmpty().trim()

    companion object {
        const val MODE_PROPERTY = "cetele.billing.mode"
        const val TOKEN_KEY_PROPERTY = "cetele.billing.token-key"
        const val PRODUCT_PROPERTY = "cetele.billing.product-id"
        const val SERVICE_ACCOUNT_PROPERTY = "cetele.play.service-account-json"
        const val RTDN_AUDIENCE_PROPERTY = "cetele.play.rtdn.audience"
        const val RTDN_EMAIL_PROPERTY = "cetele.play.rtdn.service-account-email"
        const val RTDN_JWKS_URL_PROPERTY = "cetele.play.rtdn.jwks-url"
        const val PUBLIC_BASE_URL_PROPERTY = "cetele.public-base-url"
        const val MODE_FAKE = "fake"
        const val MODE_PLAY = "play"
        const val DEFAULT_PRODUCT = "cetele_pro"
        const val DEFAULT_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
        const val EPHEMERAL_TOKEN_KEY_ADAPTER = "ephemeral-billing-token-key"
        const val PLAY_MODE_MESSAGE =
            "CETELE_BILLING_MODE=play needs CETELE_PLAY_SERVICE_ACCOUNT_JSON, CETELE_BILLING_TOKEN_KEY, " +
                "CETELE_PLAY_RTDN_AUDIENCE and CETELE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL"
        val PRODUCT_ID = Regex("^[a-z0-9][a-z0-9._]*$")
        private val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(5)
        private val READ_TIMEOUT: Duration = Duration.ofSeconds(10)
    }
}
