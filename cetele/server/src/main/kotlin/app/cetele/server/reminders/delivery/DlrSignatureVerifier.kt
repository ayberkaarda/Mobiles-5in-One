package app.cetele.server.reminders.delivery

import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.time.Clock
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.abs

/** Why a delivery report envelope was refused; only ever logged, never sent to the caller. */
enum class DlrCheck(
    val outcome: String,
) {
    OK("ok"),
    NOT_CONFIGURED("not_configured"),
    MISSING_HEADER("missing_header"),
    MALFORMED_HEADER("malformed_header"),
    STALE_TIMESTAMP("stale_timestamp"),
    BAD_SIGNATURE("bad_signature"),
}

/**
 * `X-Cetele-Signature: v1=` + hex(HMAC-SHA256(secret, ASCII(timestamp) || "." || rawBody)) with
 * `X-Cetele-Timestamp` within [TOLERANCE_SECONDS] of now (ADR-0032). The comparison is constant
 * time and both secrets are always evaluated, so rotation does not leak which one matched.
 */
@Component
class DlrSignatureVerifier(
    private val properties: SmsDlrProperties,
    private val clock: Clock,
) {
    fun check(
        timestampHeader: String?,
        signatureHeader: String?,
        body: ByteArray,
    ): DlrCheck {
        if (!properties.configured) return DlrCheck.NOT_CONFIGURED
        if (timestampHeader == null || signatureHeader == null) return DlrCheck.MISSING_HEADER
        if (!TIMESTAMP.matches(timestampHeader) || !SIGNATURE.matches(signatureHeader)) return DlrCheck.MALFORMED_HEADER
        val timestamp = timestampHeader.toLong()
        if (abs(clock.instant().epochSecond - timestamp) > TOLERANCE_SECONDS) return DlrCheck.STALE_TIMESTAMP
        val presented = signatureHeader.removePrefix(PREFIX).toByteArray(Charsets.US_ASCII)
        var matched = matches(properties.secret, timestampHeader, body, presented)
        if (properties.previousSecret.isNotEmpty()) {
            matched = matches(properties.previousSecret, timestampHeader, body, presented) or matched
        }
        return if (matched) DlrCheck.OK else DlrCheck.BAD_SIGNATURE
    }

    private fun matches(
        secret: String,
        timestamp: String,
        body: ByteArray,
        presentedHex: ByteArray,
    ): Boolean {
        val expected = sign(secret, timestamp, body).toByteArray(Charsets.US_ASCII)
        return MessageDigest.isEqual(expected, presentedHex)
    }

    companion object {
        const val TOLERANCE_SECONDS = 300L
        const val PREFIX = "v1="
        private val TIMESTAMP = Regex("[0-9]{1,12}")
        private val SIGNATURE = Regex("v1=[0-9a-f]{64}")

        /** The lowercase hex signature; used by the verifier and by whoever signs (relay, tests). */
        fun sign(
            secret: String,
            timestamp: String,
            body: ByteArray,
        ): String {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
            mac.update(timestamp.toByteArray(Charsets.US_ASCII))
            mac.update('.'.code.toByte())
            mac.update(body)
            return HexFormat.of().formatHex(mac.doFinal())
        }
    }
}
