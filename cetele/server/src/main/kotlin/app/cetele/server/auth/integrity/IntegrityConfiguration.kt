package app.cetele.server.auth.integrity

import app.cetele.server.billing.play.GoogleServiceAccountTokens
import app.cetele.server.billing.play.ServiceAccountKey
import app.cetele.server.config.LocalOnlyAdapterGuard
import org.springframework.beans.factory.ObjectProvider
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.json.JsonMapper
import java.time.Clock
import java.time.Duration

/**
 * Selects the integrity verifier from `CETELE_INTEGRITY_MODE` (`cetele.integrity.mode`):
 * `fake` is allowed only in the local and test profiles; `play` is [PlayIntegrityVerifier] on the
 * service account of `CETELE_PLAY_SERVICE_ACCOUNT_JSON` (the same key billing uses) and fails at
 * startup without it. An empty mode means `fake` in local/test and is a startup error anywhere else.
 */
@Configuration(proxyBeanMethods = false)
class IntegrityConfiguration {
    @Bean
    fun integrityPolicy(environment: Environment): IntegrityPolicy = IntegrityPolicy(packageName(environment))

    @Bean
    fun integrityVerifier(
        environment: Environment,
        mapper: ObjectProvider<ObjectMapper>,
        clock: ObjectProvider<Clock>,
    ): IntegrityVerifier {
        val mode = environment.getProperty(MODE_PROPERTY).orEmpty().trim()
        return when {
            mode == MODE_FAKE || (mode.isEmpty() && LocalOnlyAdapterGuard.isAllowed(environment)) -> {
                LocalOnlyAdapterGuard.check(FakeIntegrityVerifier.ADAPTER_NAME, environment)
                FakeIntegrityVerifier(packageName(environment))
            }

            mode == MODE_PLAY -> {
                val json = environment.getProperty(SERVICE_ACCOUNT_PROPERTY).orEmpty().trim()
                check(json.isNotEmpty()) { PLAY_MODE_MESSAGE }
                val objectMapper = mapper.getIfAvailable { JsonMapper.builder().build() }
                val time = clock.getIfAvailable { Clock.systemUTC() }
                val key = ServiceAccountKey.parse(json, objectMapper)
                val tokens = GoogleServiceAccountTokens(key, HttpPlayIntegrityApi.SCOPE, restClient(null), objectMapper, time)
                val api = HttpPlayIntegrityApi(restClient(HttpPlayIntegrityApi.BASE_URL), packageName(environment), tokens, objectMapper)
                PlayIntegrityVerifier(api, time)
            }

            mode.isEmpty() -> {
                error("CETELE_INTEGRITY_MODE must be set")
            }

            else -> {
                error("unknown CETELE_INTEGRITY_MODE")
            }
        }
    }

    private fun restClient(baseUrl: String?): RestClient {
        val factory = SimpleClientHttpRequestFactory()
        factory.setConnectTimeout(CONNECT_TIMEOUT)
        factory.setReadTimeout(READ_TIMEOUT)
        val builder = RestClient.builder().requestFactory(factory)
        if (baseUrl != null) builder.baseUrl(baseUrl)
        return builder.build()
    }

    private fun packageName(environment: Environment): String =
        environment
            .getProperty(PACKAGE_PROPERTY)
            .orEmpty()
            .trim()
            .ifEmpty { DEFAULT_PACKAGE }

    companion object {
        /** Bound from `CETELE_INTEGRITY_MODE`. */
        const val MODE_PROPERTY = "cetele.integrity.mode"

        /** Bound from `CETELE_PLAY_PACKAGE_NAME`. */
        const val PACKAGE_PROPERTY = "cetele.play.package-name"

        /** Bound from `CETELE_PLAY_SERVICE_ACCOUNT_JSON`, shared with billing. */
        const val SERVICE_ACCOUNT_PROPERTY = "cetele.play.service-account-json"
        const val MODE_FAKE = "fake"
        const val MODE_PLAY = "play"
        const val DEFAULT_PACKAGE = "app.cetele.android"
        const val PLAY_MODE_MESSAGE = "CETELE_INTEGRITY_MODE=play needs CETELE_PLAY_SERVICE_ACCOUNT_JSON"
        private val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(5)
        private val READ_TIMEOUT: Duration = Duration.ofSeconds(10)
    }
}
