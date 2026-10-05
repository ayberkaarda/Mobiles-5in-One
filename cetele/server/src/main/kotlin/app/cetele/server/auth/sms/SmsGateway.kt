package app.cetele.server.auth.sms

import app.cetele.server.config.LocalOnlyAdapterGuard
import app.cetele.server.config.logging.Masking
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import java.time.Instant

/** Delivers a text message. Implementations never log the message text or the full number. */
interface SmsGateway {
    fun send(
        phoneE164: String,
        text: String,
    )
}

/** One message kept by [FakeSmsGateway]. */
data class SmsMessage(
    val phoneE164: String,
    val text: String,
    val at: Instant,
)

/**
 * Sends nothing: keeps the last [CAPACITY] messages in memory so tests can read the code they
 * asked for. Allowed only in the local and test profiles.
 */
class FakeSmsGateway : SmsGateway {
    private val log = LoggerFactory.getLogger(FakeSmsGateway::class.java)
    private val messages = ArrayDeque<SmsMessage>()

    override fun send(
        phoneE164: String,
        text: String,
    ) {
        synchronized(messages) {
            if (messages.size == CAPACITY) messages.removeFirst()
            messages.addLast(SmsMessage(phoneE164, text, Instant.now()))
        }
        log.info("SMS kept by the fake gateway, not sent: to={}", Masking.phone(phoneE164))
    }

    /** The newest message sent to [phoneE164], if it is still among the last [CAPACITY]. */
    fun lastMessageTo(phoneE164: String): SmsMessage? = synchronized(messages) { messages.lastOrNull { it.phoneE164 == phoneE164 } }

    fun messagesTo(phoneE164: String): List<SmsMessage> = synchronized(messages) { messages.filter { it.phoneE164 == phoneE164 } }

    fun size(): Int = synchronized(messages) { messages.size }

    companion object {
        const val ADAPTER_NAME = "fake-sms-gateway"
        const val CAPACITY = 100
    }
}

/**
 * Selects the SMS adapter from `CETELE_SMS_PROVIDER` (`cetele.sms.provider`). `fake` is allowed
 * only in local and test; the Netgsm client arrives in Phase 2, so until then no other profile can
 * start. An empty provider means `fake` in local/test.
 */
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
