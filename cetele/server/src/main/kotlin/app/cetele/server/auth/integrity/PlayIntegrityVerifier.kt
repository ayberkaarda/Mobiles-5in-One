package app.cetele.server.auth.integrity

import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.Duration
import java.time.Instant

/**
 * The Google verifier of `CETELE_INTEGRITY_MODE=play` (ADR-0006). It decodes the token through the
 * [PlayIntegrityApi] port and turns the payload into an [IntegrityVerdict] for [IntegrityPolicy],
 * which still decides package, app recognition, device integrity and the nonce binding
 * (`base64url_nopad(SHA-256(UTF-8(phone_e164 + deviceId)))`, [IntegrityNonce]).
 *
 * Fails closed: Google unreachable, a refused or unparseable token, a payload without a request
 * time, a token requested more than [MAX_AGE] ago or more than [MAX_CLOCK_SKEW] in the future, a
 * request package that differs from the evaluated app package, or an unknown recognition verdict
 * all end in `auth.integrity_invalid`. The outcome is logged as a short reason, never the token.
 */
class PlayIntegrityVerifier(
    private val api: PlayIntegrityApi,
    private val clock: Clock,
) : IntegrityVerifier {
    private val log = LoggerFactory.getLogger(PlayIntegrityVerifier::class.java)

    override fun decode(
        token: String,
        expectedNonce: String,
    ): IntegrityVerdict? {
        val payload =
            when (val result = api.decodeIntegrityToken(token)) {
                is IntegrityDecodeResult.Decoded -> {
                    result.payload
                }

                IntegrityDecodeResult.Invalid -> {
                    return refuse("invalid_token")
                }

                is IntegrityDecodeResult.Unavailable -> {
                    return refuse("unavailable_${result.reason}")
                }
            }
        val requestedAt = payload.timestampMillis?.let(Instant::ofEpochMilli) ?: return refuse("no_timestamp")
        val now = clock.instant()
        if (requestedAt.isBefore(now.minus(MAX_AGE))) return refuse("stale")
        if (requestedAt.isAfter(now.plus(MAX_CLOCK_SKEW))) return refuse("future")
        val requestPackage = payload.requestPackageName ?: return refuse("no_request_package")
        // A request made for one package and evaluated as another is never this app's request.
        val packageName = if (payload.appPackageName == null || payload.appPackageName == requestPackage) requestPackage else null
        return IntegrityVerdict(
            packageName = packageName,
            appRecognition = recognition(payload.appRecognitionVerdict),
            deviceRecognition = payload.deviceRecognitionVerdict,
            // The app makes a classic request (`setNonce`); a standard request would carry the same value as `requestHash`.
            requestHash = payload.nonce ?: payload.requestHash,
        )
    }

    private fun refuse(reason: String): IntegrityVerdict? {
        log.info("Integrity decode outcome=refused reason={}", reason)
        return null
    }

    companion object {
        /** The app asks for the token right before `otp/request`; anything older is a replay candidate. */
        val MAX_AGE: Duration = Duration.ofMinutes(5)
        val MAX_CLOCK_SKEW: Duration = Duration.ofMinutes(1)

        /** Google's spelling; anything unknown is treated as `UNEVALUATED`, which the policy refuses. */
        fun recognition(verdict: String?): AppRecognition =
            when (verdict) {
                "PLAY_RECOGNIZED" -> AppRecognition.PLAY_RECOGNIZED
                "UNRECOGNIZED_VERSION" -> AppRecognition.UNRECOGNIZED_VERSION
                else -> AppRecognition.UNEVALUATED
            }
    }
}
