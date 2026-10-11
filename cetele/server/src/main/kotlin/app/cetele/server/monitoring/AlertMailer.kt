package app.cetele.server.monitoring

/** An operator alert. Subject and text carry counts and thresholds only, never personal data. */
data class AlertMail(
    val subject: String,
    val text: String,
)

sealed interface AlertMailResult {
    data object Sent : AlertMailResult

    /** [reason] is a bounded code (`http_422`, `transport_error`, `invalid_response`). */
    data class Failed(
        val reason: String,
    ) : AlertMailResult
}

/** Sends operator alerts to the configured recipients (`CETELE_ALERT_EMAIL_TO`). */
interface AlertMailer {
    fun send(mail: AlertMail): AlertMailResult
}

/** Local and test stand-in: keeps the last 50 mails. Configuration restricts it to local and test. */
class FakeAlertMailer : AlertMailer {
    private val mails = ArrayDeque<AlertMail>()
    private var nextFailure: String? = null

    override fun send(mail: AlertMail): AlertMailResult =
        synchronized(mails) {
            val failure = nextFailure
            nextFailure = null
            if (failure != null) return AlertMailResult.Failed(failure)
            if (mails.size == CAPACITY) mails.removeFirst()
            mails.addLast(mail)
            AlertMailResult.Sent
        }

    fun failNextSend(reason: String) = synchronized(mails) { nextFailure = reason }

    fun sent(): List<AlertMail> = synchronized(mails) { mails.toList() }

    companion object {
        const val ADAPTER_NAME = "fake-alert-mailer"
        const val CAPACITY = 50
    }
}
