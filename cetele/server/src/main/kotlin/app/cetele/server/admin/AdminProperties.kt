package app.cetele.server.admin

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * Admin console settings (ADR-0033). [totpKey] is the standard Base64 of 32 bytes for the
 * AES-256-GCM encryption of TOTP secrets; empty means the local-only stand-in
 * `ephemeral-admin-totp-key`. The bootstrap pair creates the first `ADMIN` once.
 */
@ConfigurationProperties(prefix = "cetele.admin")
data class AdminProperties(
    val totpKey: String = "",
    val bootstrapEmail: String = "",
    val bootstrapPassword: String = "",
) {
    override fun toString(): String = "AdminProperties(totpKey=***, bootstrapEmail=***, bootstrapPassword=***)"
}

/**
 * Audit log settings. [ipKey] is the standard Base64 of at least 32 bytes for the HMAC-SHA256 of
 * client addresses; empty means the local-only stand-in `ephemeral-audit-ip-key`.
 */
@ConfigurationProperties(prefix = "cetele.audit")
data class AuditProperties(
    val ipKey: String = "",
) {
    override fun toString(): String = "AuditProperties(ipKey=***)"
}
