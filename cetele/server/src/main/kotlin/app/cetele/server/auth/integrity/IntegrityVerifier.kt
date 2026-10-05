package app.cetele.server.auth.integrity

import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/**
 * Decodes a Play Integrity token sent with `POST /v1/auth/otp/request`.
 *
 * Phase 1 ships only [FakeIntegrityVerifier] (local and test profiles). The Google-calling
 * verifier (`decodeIntegrityToken` with a service account) arrives in Phase 4.
 */
interface IntegrityVerifier {
    /**
     * Returns the decoded verdict, or `null` when the token is not a token this verifier can
     * decode (malformed, forged, from another project). [expectedNonce] is the request hash the
     * app was asked to bind into the token, see [IntegrityNonce].
     */
    fun decode(
        token: String,
        expectedNonce: String,
    ): IntegrityVerdict?
}

/** Play's app recognition verdict (`appIntegrity.appRecognitionVerdict`). */
enum class AppRecognition {
    PLAY_RECOGNIZED,
    UNRECOGNIZED_VERSION,
    UNEVALUATED,
}

/** The fields of a decoded integrity payload that [IntegrityPolicy] looks at. */
data class IntegrityVerdict(
    val packageName: String?,
    val appRecognition: AppRecognition,
    val deviceRecognition: Set<String>,
    val requestHash: String?,
)

/** Why a verdict was refused; logged as the outcome, never returned to the client. */
enum class IntegrityRejection {
    PACKAGE_MISMATCH,
    APP_NOT_RECOGNIZED,
    NO_DEVICE_INTEGRITY,
    NONCE_MISMATCH,
}

/**
 * Acceptance rules for a verdict: the expected package, an app recognised by Play,
 * `MEETS_DEVICE_INTEGRITY`, and the request hash bound to this phone and device.
 */
class IntegrityPolicy(
    private val packageName: String,
) {
    /** Returns `null` when the verdict is acceptable, otherwise the first failed rule. */
    fun rejection(
        verdict: IntegrityVerdict,
        expectedNonce: String,
    ): IntegrityRejection? =
        when {
            verdict.packageName != packageName -> IntegrityRejection.PACKAGE_MISMATCH
            verdict.appRecognition != AppRecognition.PLAY_RECOGNIZED -> IntegrityRejection.APP_NOT_RECOGNIZED
            MEETS_DEVICE_INTEGRITY !in verdict.deviceRecognition -> IntegrityRejection.NO_DEVICE_INTEGRITY
            !constantTimeEquals(verdict.requestHash, expectedNonce) -> IntegrityRejection.NONCE_MISMATCH
            else -> null
        }

    private fun constantTimeEquals(
        actual: String?,
        expected: String,
    ): Boolean = actual != null && MessageDigest.isEqual(actual.toByteArray(), expected.toByteArray())

    companion object {
        const val MEETS_DEVICE_INTEGRITY = "MEETS_DEVICE_INTEGRITY"
    }
}

/** The request hash an OTP request binds into its integrity token. */
object IntegrityNonce {
    /** `base64url(SHA-256(phone + deviceId))` without padding, UTF-8, device id in canonical form. */
    fun of(
        phoneE164: String,
        deviceId: UUID,
    ): String {
        val digest = MessageDigest.getInstance("SHA-256").digest((phoneE164 + deviceId).toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }
}
