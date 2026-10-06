package app.cetele.server.reminders.sms

import app.cetele.server.config.LocalOnlyAdapterGuard
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment

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
                error("SMS provider netgsm needs the Netgsm client, which is not part of this build")
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
