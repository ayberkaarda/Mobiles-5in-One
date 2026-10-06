package app.cetele.server.reminders.sms

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties(prefix = "cetele.sms.netgsm")
class NetgsmProperties(
    val baseUrl: String = "",
    val username: String = "",
    val password: String = "",
    val msgheader: String = "",
    val connectTimeout: Duration = Duration.ofSeconds(5),
    val readTimeout: Duration = Duration.ofSeconds(10),
) {
    init {
        require(!connectTimeout.isNegative && !connectTimeout.isZero) { "Netgsm connect timeout must be positive" }
        require(!readTimeout.isNegative && !readTimeout.isZero) { "Netgsm read timeout must be positive" }
    }

    fun endpoint(): String = baseUrl.trim().ifEmpty { "https://api.netgsm.com.tr" }.trimEnd('/')
}
