package app.cetele.server.monitoring

import app.cetele.server.config.HttpsEndpoints
import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.reminders.sms.NetgsmProperties
import app.cetele.server.reminders.sms.SmsConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * Selects the adapters of the cost monitoring. The balance provider follows `CETELE_SMS_PROVIDER`;
 * the alert mailer is `CETELE_ALERT_MAILER`. The fakes are allowed in local and test only (ADR-0006),
 * and an empty selection outside those profiles fails the start.
 */
@Configuration(proxyBeanMethods = false)
class MonitoringConfiguration {
    @Bean
    fun smsBalanceProvider(
        environment: Environment,
        netgsm: NetgsmProperties,
    ): SmsBalanceProvider {
        val provider = environment.getProperty(SmsConfiguration.PROVIDER_PROPERTY).orEmpty().trim()
        return when {
            provider == SmsConfiguration.PROVIDER_FAKE || (provider.isEmpty() && LocalOnlyAdapterGuard.isAllowed(environment)) -> {
                LocalOnlyAdapterGuard.check(FakeSmsBalanceProvider.ADAPTER_NAME, environment)
                FakeSmsBalanceProvider()
            }

            provider == SmsConfiguration.PROVIDER_NETGSM -> {
                check(netgsm.username.isNotBlank() && netgsm.password.isNotBlank()) {
                    "CETELE_SMS_PROVIDER=netgsm needs CETELE_NETGSM_USERNAME and _PASSWORD"
                }
                if (!LocalOnlyAdapterGuard.isAllowed(environment)) HttpsEndpoints.require("Netgsm endpoint", netgsm.endpoint())
                NetgsmSmsBalanceProvider(client(netgsm.endpoint(), netgsm.connectTimeout, netgsm.readTimeout), netgsm)
            }

            provider.isEmpty() -> {
                error("CETELE_SMS_PROVIDER must be set")
            }

            else -> {
                error("unknown CETELE_SMS_PROVIDER")
            }
        }
    }

    @Bean
    fun alertMailer(
        environment: Environment,
        properties: AlertProperties,
    ): AlertMailer {
        val mailer = properties.mailer.trim()
        return when {
            mailer == MAILER_FAKE || (mailer.isEmpty() && LocalOnlyAdapterGuard.isAllowed(environment)) -> {
                LocalOnlyAdapterGuard.check(FakeAlertMailer.ADAPTER_NAME, environment)
                FakeAlertMailer()
            }

            mailer == MAILER_RESEND -> {
                val resend = properties.resend
                if (!LocalOnlyAdapterGuard.isAllowed(environment)) HttpsEndpoints.require("Resend endpoint", resend.endpoint())
                check(resend.apiKey.isNotBlank() && properties.from.isNotBlank() && properties.recipients().isNotEmpty()) {
                    "CETELE_ALERT_MAILER=resend needs CETELE_RESEND_API_KEY, CETELE_MAIL_FROM and CETELE_ALERT_EMAIL_TO"
                }
                ResendAlertMailer(
                    client(resend.endpoint(), resend.connectTimeout, resend.readTimeout),
                    resend.apiKey,
                    properties.from.trim(),
                    properties.recipients(),
                )
            }

            mailer.isEmpty() -> {
                error("CETELE_ALERT_MAILER must be set")
            }

            else -> {
                error("unknown CETELE_ALERT_MAILER")
            }
        }
    }

    private fun client(
        baseUrl: String,
        connectTimeout: Duration,
        readTimeout: Duration,
    ): RestClient {
        val factory = SimpleClientHttpRequestFactory()
        factory.setConnectTimeout(connectTimeout)
        factory.setReadTimeout(readTimeout)
        return RestClient
            .builder()
            .baseUrl(baseUrl)
            .requestFactory(factory)
            .build()
    }

    companion object {
        const val MAILER_FAKE = "fake"
        const val MAILER_RESEND = "resend"
    }
}
