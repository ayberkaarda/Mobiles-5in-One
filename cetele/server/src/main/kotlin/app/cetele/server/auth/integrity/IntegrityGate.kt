package app.cetele.server.auth.integrity

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * Requires a valid integrity token bound to the phone and device of an OTP request. A missing
 * token is 403 `auth.integrity_required`; every other failure (undecodable token, refused
 * verdict, wrong request hash) is the same 403 `auth.integrity_invalid`.
 */
@Component
class IntegrityGate(
    private val verifier: IntegrityVerifier,
    private val policy: IntegrityPolicy,
) {
    private val log = LoggerFactory.getLogger(IntegrityGate::class.java)

    fun require(
        token: String?,
        phoneE164: String,
        deviceId: UUID,
    ) {
        if (token.isNullOrBlank()) throw ProblemException(ProblemCode.AUTH_INTEGRITY_REQUIRED, "integrity token missing")
        val nonce = IntegrityNonce.of(phoneE164, deviceId)
        val verdict =
            if (token.length > MAX_TOKEN_LENGTH) null else verifier.decode(token, nonce)
        if (verdict == null) {
            log.info("Integrity check outcome=undecodable")
            throw ProblemException(ProblemCode.AUTH_INTEGRITY_INVALID, "integrity token undecodable")
        }
        val rejection = policy.rejection(verdict, nonce)
        if (rejection != null) {
            log.info("Integrity check outcome=rejected reason={}", rejection.name.lowercase())
            throw ProblemException(ProblemCode.AUTH_INTEGRITY_INVALID, "integrity verdict rejected")
        }
    }

    companion object {
        /** Play tokens are a few kilobytes; anything far larger is not decoded at all. */
        const val MAX_TOKEN_LENGTH = 16_384
    }
}
