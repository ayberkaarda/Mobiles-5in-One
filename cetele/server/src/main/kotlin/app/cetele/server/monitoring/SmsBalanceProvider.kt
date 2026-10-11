package app.cetele.server.monitoring

/** One read of the SMS provider credit, in messages. An unreadable answer is never reported as a number. */
sealed interface SmsBalanceReading {
    data class Known(
        val credit: Long,
    ) : SmsBalanceReading {
        init {
            require(credit >= 0) { "credit must not be negative" }
        }
    }

    /** [reason] is a bounded code (`http_503`, `transport_error`, `invalid_response`, `provider_30`). */
    data class Unknown(
        val reason: String,
    ) : SmsBalanceReading
}

/** Reads the remaining SMS credit of the provider account (spec item 22). */
interface SmsBalanceProvider {
    fun read(): SmsBalanceReading
}

/** Local and test stand-in: a settable credit, 1000 at start. Configuration restricts it to local and test. */
class FakeSmsBalanceProvider(
    credit: Long = 1000,
) : SmsBalanceProvider {
    @Volatile
    private var reading: SmsBalanceReading = SmsBalanceReading.Known(credit)

    fun set(credit: Long) {
        reading = SmsBalanceReading.Known(credit)
    }

    fun fail(reason: String) {
        reading = SmsBalanceReading.Unknown(reason)
    }

    override fun read(): SmsBalanceReading = reading

    companion object {
        const val ADAPTER_NAME = "fake-sms-balance-provider"
    }
}
