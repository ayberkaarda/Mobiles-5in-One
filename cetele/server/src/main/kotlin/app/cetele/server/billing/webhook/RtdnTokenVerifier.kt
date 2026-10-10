package app.cetele.server.billing.webhook

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.KeySourceException
import com.nimbusds.jose.crypto.RSASSAVerifier
import com.nimbusds.jose.jwk.JWKMatcher
import com.nimbusds.jose.jwk.JWKSelector
import com.nimbusds.jose.jwk.KeyType
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.source.RateLimitReachedException
import com.nimbusds.jwt.SignedJWT
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration

/** Why a push token was refused; logged as `outcome=<label>`, never returned. */
enum class RtdnRejection(
    val label: String,
) {
    MISSING_BEARER("missing_bearer"),
    MALFORMED("malformed_token"),
    ALGORITHM("bad_alg"),
    UNKNOWN_KEY("unknown_kid"),
    SIGNATURE("bad_signature"),
    ISSUER("bad_issuer"),
    AUDIENCE("bad_audience"),
    EMAIL("bad_email"),
    EMAIL_UNVERIFIED("unverified_email"),
    EXPIRED("expired"),
    NOT_YET_VALID("issued_in_future"),
}

/**
 * Verifies the Google-signed OIDC token of a Pub/Sub push (ADR-0032 step 3): `RS256` only with a
 * `kid` from [RtdnKeySource], the Google issuer, exactly the expected audience, the push service
 * account's verified email, and `exp`/`iat` within 30 seconds of now. Returns `null` when the token
 * is valid. A key source that cannot be reached throws `503 billing.unavailable` so Pub/Sub retries.
 */
@Component
class RtdnTokenVerifier(
    private val keys: RtdnKeySource,
    private val expected: RtdnExpectations,
    private val clock: Clock,
) {
    fun reject(authorization: String?): RtdnRejection? {
        if (authorization == null || !authorization.startsWith(BEARER)) return RtdnRejection.MISSING_BEARER
        val token = authorization.substring(BEARER.length).trim()
        if (token.isEmpty()) return RtdnRejection.MISSING_BEARER
        if (token.length > MAX_TOKEN_LENGTH) return RtdnRejection.MALFORMED
        val jwt = runCatching { SignedJWT.parse(token) }.getOrNull() ?: return RtdnRejection.MALFORMED
        if (jwt.header.algorithm != JWSAlgorithm.RS256) return RtdnRejection.ALGORITHM
        val kid = jwt.header.keyID ?: return RtdnRejection.UNKNOWN_KEY
        val key = key(kid) ?: return RtdnRejection.UNKNOWN_KEY
        val signed = runCatching { jwt.verify(RSASSAVerifier(key.toRSAPublicKey())) }.getOrDefault(false)
        if (!signed) return RtdnRejection.SIGNATURE
        val claims = runCatching { jwt.jwtClaimsSet }.getOrNull() ?: return RtdnRejection.MALFORMED
        if (claims.issuer !in RtdnExpectations.ISSUERS) return RtdnRejection.ISSUER
        if (claims.audience != listOf(expected.audience)) return RtdnRejection.AUDIENCE
        if (claims.getClaim("email") != expected.serviceAccountEmail) return RtdnRejection.EMAIL
        if (claims.getClaim("email_verified") != true) return RtdnRejection.EMAIL_UNVERIFIED
        val now = clock.instant()
        val expiresAt = claims.expirationTime?.toInstant() ?: return RtdnRejection.EXPIRED
        if (!expiresAt.isAfter(now.minus(SKEW))) return RtdnRejection.EXPIRED
        val issuedAt = claims.issueTime?.toInstant() ?: return RtdnRejection.NOT_YET_VALID
        if (issuedAt.isAfter(now.plus(SKEW))) return RtdnRejection.NOT_YET_VALID
        return null
    }

    private fun key(kid: String): RSAKey? {
        val selector =
            JWKSelector(
                JWKMatcher
                    .Builder()
                    .keyID(kid)
                    .keyType(KeyType.RSA)
                    .build(),
            )
        val found =
            try {
                keys.get(selector, null)
            } catch (_: RateLimitReachedException) {
                // An unknown kid inside the refresh interval: the set was just fetched and lacks it.
                return null
            } catch (_: KeySourceException) {
                throw ProblemException(ProblemCode.BILLING_UNAVAILABLE, "rtdn signing keys unavailable")
            }
        return found.firstOrNull() as? RSAKey
    }

    companion object {
        private const val BEARER = "Bearer "
        const val MAX_TOKEN_LENGTH = 4096
        val SKEW: Duration = Duration.ofSeconds(30)
    }
}
