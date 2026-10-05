package app.cetele.server.security

import app.cetele.server.web.problem.ProblemCode
import app.cetele.server.web.problem.ProblemException
import com.nimbusds.jose.JOSEException
import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.crypto.ECDSAVerifier
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.text.ParseException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Date
import java.util.UUID

/**
 * Issues and verifies the ES256 access tokens.
 *
 * Claims: `sub` (user id), `did` (device id), `jti`, `iat`, `exp`, `iss`, `aud` (`cetele-api`). No roles: memberships
 * are read on every request. Verification accepts only `alg=ES256` with the configured `kid`
 * and signature key; `none`, HMAC algorithms, foreign keys, a wrong issuer or audience and expired tokens
 * (beyond [clockSkew]) are rejected with [ProblemCode.AUTH_UNAUTHENTICATED].
 */
class JwtCodec(
    signingKey: ECPrivateKey,
    verificationKey: ECPublicKey,
    private val issuer: String,
    private val accessTokenTtl: Duration,
    private val clockSkew: Duration,
    private val clock: Clock,
    private val keyId: String = KEY_ID,
) {
    private val signer = ECDSASigner(signingKey)
    private val verifier = ECDSAVerifier(verificationKey)

    /** Access token lifetime in seconds, for the `expiresIn` member of token responses. */
    val expiresInSeconds: Long get() = accessTokenTtl.seconds

    fun issue(
        userId: UUID,
        deviceId: UUID,
        now: Instant,
    ): String {
        val claims =
            JWTClaimsSet
                .Builder()
                .issuer(issuer)
                .audience(AUDIENCE)
                .subject(userId.toString())
                .claim(DEVICE_CLAIM, deviceId.toString())
                .jwtID(UUID.randomUUID().toString())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(accessTokenTtl)))
                .build()
        val header =
            JWSHeader
                .Builder(JWSAlgorithm.ES256)
                .keyID(keyId)
                .type(JOSEObjectType.JWT)
                .build()
        val jwt = SignedJWT(header, claims)
        jwt.sign(signer)
        return jwt.serialize()
    }

    fun verify(token: String): CurrentUser {
        if (token.isEmpty() || token.length > MAX_TOKEN_LENGTH) throw invalid("token length")
        val jwt =
            try {
                SignedJWT.parse(token)
            } catch (_: ParseException) {
                throw invalid("unparseable token")
            }
        val header = jwt.header
        if (header.algorithm != JWSAlgorithm.ES256) throw invalid("algorithm")
        if (header.keyID != keyId) throw invalid("key id")
        if (header.criticalParams?.isNotEmpty() == true) throw invalid("critical header")
        val signatureValid =
            try {
                jwt.verify(verifier)
            } catch (_: JOSEException) {
                false
            }
        if (!signatureValid) throw invalid("signature")
        val claims =
            try {
                jwt.jwtClaimsSet
            } catch (_: ParseException) {
                throw invalid("claims")
            }
        val now = clock.instant()
        if (claims.issuer != issuer) throw invalid("issuer")
        if (claims.audience != listOf(AUDIENCE)) throw invalid("audience")
        val expiresAt = claims.expirationTime?.toInstant() ?: throw invalid("missing exp")
        val issuedAt = claims.issueTime?.toInstant() ?: throw invalid("missing iat")
        if (now.isAfter(expiresAt.plus(clockSkew))) throw invalid("expired")
        if (issuedAt.isAfter(now.plus(clockSkew))) throw invalid("issued in the future")
        if (claims.jwtid.isNullOrBlank()) throw invalid("missing jti")
        val userId = parseUuid(claims.subject) ?: throw invalid("subject")
        val deviceId = parseUuid(claims.getClaim(DEVICE_CLAIM) as? String) ?: throw invalid("device")
        return CurrentUser(userId, deviceId)
    }

    private fun invalid(reason: String) = ProblemException(ProblemCode.AUTH_UNAUTHENTICATED, "access token rejected: $reason")

    private fun parseUuid(value: String?): UUID? = value?.let { runCatching { UUID.fromString(it) }.getOrNull() }

    companion object {
        const val KEY_ID = "es256-1"
        const val AUDIENCE = "cetele-api"
        const val DEVICE_CLAIM = "did"
        private const val MAX_TOKEN_LENGTH = 4096
    }
}
