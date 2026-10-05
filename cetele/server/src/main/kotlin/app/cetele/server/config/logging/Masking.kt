package app.cetele.server.config.logging

/**
 * Masks personal data and credentials in log text. Applied by [MaskingConverter] (plain console
 * pattern) and [MaskingJsonMembersCustomizer] (structured JSON) to the message, MDC values,
 * key-value pairs and stack traces. It is a safety net: code should not log these values at all.
 *
 * Rules, in order:
 * 1. compact JWS/JWT (`eyJ...`) -> `***`;
 * 2. values of `Authorization`, `Cookie`, `Set-Cookie` -> `***`;
 * 3. a run of 4-8 digits right after a word containing `code` or `otp` -> `******`;
 * 4. Turkish phone numbers -> `+90*******12` (last two digits kept), other E.164 numbers likewise;
 * 5. the path segment after `/invitations/` (invitation codes) -> `***`;
 * 6. base64url runs of at least 32 characters that mix letters and digits (tokens, hashes) -> `***`.
 *    UUIDs such as trace ids are kept.
 */
object Masking {
    private const val STARS = "***"

    private val jwt = Regex("""eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*""")
    private val secretHeader = Regex("""(?i)\b(authorization|set-cookie|cookie)\b(["']?\s*[:=]\s*["']?)[^"'\r\n]+""")
    private val otpCode = Regex("""(?i)((?:code|otp)[a-z_]*)(\W{1,4})(\d{4,8})(?!\d)""")
    private val turkishPhone = Regex("""\+90\d{8}(\d{2})(?!\d)""")
    private val otherE164 = Regex("""\+(?!90)\d{6,13}(\d{2})(?!\d)""")
    private val bareTurkishMobile = Regex("""(?<![\w+-])(?:90|0)?5\d{7}(\d{2})(?![\w-])""")
    private val invitationPath = Regex("""(?i)(/invitations/)(?!\{)[^/\s?#"']+""")
    private val longRun = Regex("""(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])""")
    private val uuid = Regex("""[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}""")

    fun mask(text: String?): String? {
        if (text == null || text.isEmpty()) return text
        var masked: String = text
        masked = jwt.replace(masked, STARS)
        masked = secretHeader.replace(masked) { it.groupValues[1] + it.groupValues[2] + STARS }
        masked = otpCode.replace(masked) { it.groupValues[1] + it.groupValues[2] + "******" }
        masked = turkishPhone.replace(masked) { "+90*******" + it.groupValues[1] }
        masked = otherE164.replace(masked) { "+*******" + it.groupValues[1] }
        masked = bareTurkishMobile.replace(masked) { "*******" + it.groupValues[1] }
        masked = invitationPath.replace(masked) { it.groupValues[1] + STARS }
        masked = longRun.replace(masked) { match -> if (isOpaqueToken(match.value)) STARS else match.value }
        return masked
    }

    /** The display form of a stored E.164 phone, e.g. for `GET /v1/me`: `+90*******12`. */
    fun phone(e164: String): String {
        if (e164.length < 4) return STARS
        val prefix = if (e164.startsWith("+90")) "+90" else "+"
        return prefix + "*******" + e164.takeLast(2)
    }

    private fun isOpaqueToken(value: String): Boolean {
        if (uuid.matches(value)) return false
        return value.any { it.isDigit() } && value.any { it.isLetter() }
    }
}
