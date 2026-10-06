package app.cetele.android.core.network.integrity

import java.security.MessageDigest
import java.util.Base64
import java.util.Locale

object IntegrityNonce {
    fun of(
        phoneE164: String,
        deviceId: String,
    ): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest
                .getInstance("SHA-256")
                .digest((phoneE164 + deviceId.lowercase(Locale.ROOT)).toByteArray(Charsets.UTF_8)),
        )
}
