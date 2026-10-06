package app.cetele.server.config

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "cetele.sms")
data class SmsLimitsProperties(
    val dailyCap: Int = 1000,
) {
    init {
        require(dailyCap > 0) { "CETELE_SMS_DAILY_CAP must be positive" }
    }
}
