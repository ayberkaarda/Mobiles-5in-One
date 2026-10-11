package app.cetele.server.monitoring

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * Thresholds of [SmsBalanceMonitor] (`cetele.monitoring.sms-balance`, see `docs/ops/cost-alerts.md`).
 * [lastTopUp] is the credit bought with the last top-up; 0 disables the share rule until the monitor
 * itself sees the credit rise.
 */
@ConfigurationProperties(prefix = "cetele.monitoring.sms-balance")
data class SmsBalanceAlertProperties(
    val minCredit: Long = 500,
    val lastTopUp: Long = 0,
    val topUpPercent: Int = 20,
) {
    init {
        require(minCredit >= 0) { "CETELE_SMS_BALANCE_MIN_CREDIT must not be negative" }
        require(lastTopUp >= 0) { "CETELE_SMS_BALANCE_LAST_TOP_UP must not be negative" }
        require(topUpPercent in 1..100) { "CETELE_SMS_BALANCE_TOP_UP_PERCENT must be between 1 and 100" }
    }
}

/** Operator alert mail (`cetele.alerts`). Not a data class: the API key must never reach a `toString`. */
@ConfigurationProperties(prefix = "cetele.alerts")
class AlertProperties(
    val mailer: String = "",
    val to: String = "",
    val from: String = "",
    val resend: ResendProperties = ResendProperties(),
) {
    fun recipients(): List<String> = to.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    override fun toString(): String = "AlertProperties(mailer=$mailer)"
}

class ResendProperties(
    val apiKey: String = "",
    val baseUrl: String = "",
    val connectTimeout: Duration = Duration.ofSeconds(5),
    val readTimeout: Duration = Duration.ofSeconds(10),
) {
    init {
        require(!connectTimeout.isNegative && !connectTimeout.isZero) { "Resend connect timeout must be positive" }
        require(!readTimeout.isNegative && !readTimeout.isZero) { "Resend read timeout must be positive" }
    }

    fun endpoint(): String = baseUrl.trim().ifEmpty { "https://api.resend.com" }.trimEnd('/')

    override fun toString(): String = "ResendProperties(endpoint=${endpoint()})"
}
