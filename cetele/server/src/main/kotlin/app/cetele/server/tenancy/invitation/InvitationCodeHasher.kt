package app.cetele.server.tenancy.invitation

import app.cetele.server.auth.otp.OtpHasher
import org.springframework.stereotype.Component

/**
 * Stored form of an invitation code: lowercase hex `HMAC-SHA256(pepper, DOMAIN || code)`, keyed with
 * the server pepper (`CETELE_OTP_PEPPER`) so a copy of the database alone cannot be used to search
 * the 40-bit code space offline. [DOMAIN] separates these inputs from OTP inputs (`+90…` phone
 * numbers), so an invitation hash can never equal an OTP hash. Rotating the pepper invalidates
 * open invitations (at most 24 hours old).
 */
@Component
class InvitationCodeHasher(
    private val pepper: OtpHasher,
) {
    fun hash(canonicalCode: String): String = pepper.hmac(DOMAIN, canonicalCode).joinToString("") { "%02x".format(it) }

    companion object {
        const val DOMAIN = "cetele.invitation.v1|"
    }
}
