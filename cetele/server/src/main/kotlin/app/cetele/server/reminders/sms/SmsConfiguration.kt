package app.cetele.server.reminders.sms

import app.cetele.server.config.LocalOnlyAdapterGuard
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient

@Configuration(proxyBeanMethods = false)
class SmsConfiguration {
    @Bean
    fun smsGateway(environment: Environment): SmsGateway {
        val provider = environment.getProperty(PROVIDER_PROPERTY).orEmpty().trim()
        return when {
            provider == PROVIDER_FAKE || (provider.isEmpty() && LocalOnlyAdapterGuard.isAllowed(environment)) -> {
                LocalOnlyAdapterGuard.check(FakeSmsGateway.ADAPTER_NAME, environment)
                FakeSmsGateway()
            }

            provider == PROVIDER_NETGSM -> {
                val properties =
                    Binder
                        .get(
                            environment,
                        ).bind("cetele.sms.netgsm", NetgsmProperties::class.java)
                        .orElseGet { NetgsmProperties() }
                check(properties.username.isNotBlank() && properties.password.isNotBlank() && properties.msgheader.isNotBlank()) {
                    "CETELE_SMS_PROVIDER=netgsm needs CETELE_NETGSM_USERNAME, _PASSWORD and _MSGHEADER"
                }
                val factory = SimpleClientHttpRequestFactory()
                factory.setConnectTimeout(properties.connectTimeout)
                factory.setReadTimeout(properties.readTimeout)
                val client =
                    RestClient
                        .builder()
                        .baseUrl(properties.endpoint())
                        .requestFactory(factory)
                        .build()
                NetgsmSmsGateway(client, properties)
            }

            provider.isEmpty() -> {
                error("CETELE_SMS_PROVIDER must be set")
            }

            else -> {
                error("unknown CETELE_SMS_PROVIDER")
            }
        }
    }

    companion object {
        /** Bound from `CETELE_SMS_PROVIDER`. */
        const val PROVIDER_PROPERTY = "cetele.sms.provider"
        const val PROVIDER_FAKE = "fake"
        const val PROVIDER_NETGSM = "netgsm"
    }
}
