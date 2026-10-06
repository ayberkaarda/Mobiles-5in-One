package app.cetele.server.reminders.sms

enum class SmsKind { OTP, REMINDER }

data class SmsMessage(
    val phoneE164: String,
    val text: String,
    val kind: SmsKind,
)

sealed interface SmsSendResult {
    data class Accepted(
        val providerMessageId: String?,
    ) : SmsSendResult

    data class Rejected(
        val reason: String,
    ) : SmsSendResult

    data class Failed(
        val reason: String,
    ) : SmsSendResult
}

data class SmsBalance(
    val credit: Long?,
    val currency: String?,
)

interface SmsGateway {
    fun send(message: SmsMessage): SmsSendResult

    fun balance(): SmsBalance
}
