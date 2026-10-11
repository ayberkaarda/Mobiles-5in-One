package app.cetele.server.auth.integrity

/**
 * The fields of a decoded Play Integrity payload (`tokenPayloadExternal`) that the verifier reads.
 * A field Google left out is `null` (or empty for the device verdicts).
 */
data class IntegrityTokenPayload(
    /** `requestDetails.requestPackageName`. */
    val requestPackageName: String?,
    /** `requestDetails.nonce`: the classic request the app makes carries the request hash here. */
    val nonce: String?,
    /** `requestDetails.requestHash`: where a standard request would carry it. */
    val requestHash: String?,
    /** `requestDetails.timestampMillis`: when the token was requested on the device. */
    val timestampMillis: Long?,
    /** `appIntegrity.appRecognitionVerdict`, as Google spells it. */
    val appRecognitionVerdict: String?,
    /** `appIntegrity.packageName`, present when Play evaluated the app. */
    val appPackageName: String?,
    /** `deviceIntegrity.deviceRecognitionVerdict`. */
    val deviceRecognitionVerdict: Set<String>,
) {
    override fun toString(): String =
        "IntegrityTokenPayload(app=$appRecognitionVerdict, device=$deviceRecognitionVerdict, timestampMillis=$timestampMillis)"
}

/** Outcome of one `decodeIntegrityToken` call. */
sealed interface IntegrityDecodeResult {
    data class Decoded(
        val payload: IntegrityTokenPayload,
    ) : IntegrityDecodeResult

    /** Google refused the token itself (malformed, forged, from another project or package). */
    data object Invalid : IntegrityDecodeResult

    /** No answer could be obtained; [reason] is a short code, never a token or a key. */
    data class Unavailable(
        val reason: String,
    ) : IntegrityDecodeResult
}

/**
 * Port to Google's Play Integrity API (`v1/{packageName}:decodeIntegrityToken`). The real adapter is
 * [HttpPlayIntegrityApi]; tests use a fake adapter of this port.
 */
fun interface PlayIntegrityApi {
    fun decodeIntegrityToken(token: String): IntegrityDecodeResult
}
