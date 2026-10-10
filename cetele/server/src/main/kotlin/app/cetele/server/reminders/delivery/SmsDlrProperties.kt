package app.cetele.server.reminders.delivery

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * Settings of the delivery-report webhook (ADR-0032). An empty [secret] means the endpoint is not
 * configured and answers 401 to every request; a secret shorter than 32 bytes fails startup.
 */
@ConfigurationProperties(prefix = "cetele.sms.dlr")
class SmsDlrProperties(
    val secret: String = "",
    val previousSecret: String = "",
    val allowedIps: String = "",
) {
    /** Parsed at startup so a malformed entry fails the boot, not the first request. */
    val allowlist: IpAllowlist = IpAllowlist.parse(allowedIps)

    init {
        require(secret.isEmpty() || secret.toByteArray(Charsets.UTF_8).size >= MIN_SECRET_BYTES) {
            "CETELE_SMS_DLR_SECRET must be at least $MIN_SECRET_BYTES bytes"
        }
        require(previousSecret.isEmpty() || previousSecret.toByteArray(Charsets.UTF_8).size >= MIN_SECRET_BYTES) {
            "CETELE_SMS_DLR_PREVIOUS_SECRET must be at least $MIN_SECRET_BYTES bytes"
        }
    }

    val configured: Boolean get() = secret.isNotEmpty()

    companion object {
        const val MIN_SECRET_BYTES = 32
    }
}
