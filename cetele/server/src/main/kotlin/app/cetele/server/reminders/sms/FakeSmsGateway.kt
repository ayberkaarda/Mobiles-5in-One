package app.cetele.server.reminders.sms

import app.cetele.server.config.logging.Masking
import org.slf4j.LoggerFactory

/** Keeps the last 100 messages; configuration restricts this adapter to local and test. */
class FakeSmsGateway : SmsGateway {
    private val log = LoggerFactory.getLogger(FakeSmsGateway::class.java)
    private val messages = ArrayDeque<SmsMessage>()
    private var nextFailure: String? = null
    private var sequence = 0L

    override fun send(message: SmsMessage): SmsSendResult =
        synchronized(messages) {
            if (messages.size == CAPACITY) messages.removeFirst()
            messages.addLast(message)
            sequence += 1
            val failure = nextFailure
            nextFailure = null
            val outcome = if (failure == null) "accepted" else "failed"
            log.info("SMS fake outcome={} to={} kind={}", outcome, Masking.phone(message.phoneE164), message.kind)
            if (failure == null) SmsSendResult.Accepted("fake-$sequence") else SmsSendResult.Failed(failure)
        }

    fun failNextSend(reason: String) = synchronized(messages) { nextFailure = reason }

    override fun balance(): SmsBalance = SmsBalance(1000, null)

    fun lastMessageTo(phoneE164: String): SmsMessage? = synchronized(messages) { messages.lastOrNull { it.phoneE164 == phoneE164 } }

    fun messagesTo(phoneE164: String): List<SmsMessage> = synchronized(messages) { messages.filter { it.phoneE164 == phoneE164 } }

    fun size(): Int = synchronized(messages) { messages.size }

    companion object {
        const val ADAPTER_NAME = "fake-sms-gateway"
        const val CAPACITY = 100
    }
}
