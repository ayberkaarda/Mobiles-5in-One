package app.cetele.server.billing.webhook

import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jose.jwk.JWK
import com.nimbusds.jose.jwk.JWKSelector
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jose.jwk.source.JWKSource
import com.nimbusds.jose.jwk.source.JWKSourceBuilder
import com.nimbusds.jose.proc.SecurityContext
import com.nimbusds.jose.util.DefaultResourceRetriever
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import java.net.URL
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Date

/** The keys that may sign a Pub/Sub push token (ADR-0032); injectable so tests sign with their own. */
interface RtdnKeySource : JWKSource<SecurityContext>

/** What a push token must name: the exact audience and the push service account. */
data class RtdnExpectations(
    val audience: String,
    val serviceAccountEmail: String,
) {
    companion object {
        const val PATH = "/v1/webhooks/play-rtdn"
        val ISSUERS = setOf("https://accounts.google.com", "accounts.google.com")
    }
}

/**
 * Google's published signing keys (`CETELE_PLAY_RTDN_JWKS_URL`), cached for one hour, refreshed on
 * an unknown `kid` at most once per minute, fetched with a 5-second timeout. Not exercised against
 * Google (`not exercised: no Google Cloud project`, ADR-0004 G2).
 */
class RemoteRtdnKeySource(
    url: URL,
) : RtdnKeySource {
    private val delegate: JWKSource<SecurityContext> =
        JWKSourceBuilder
            .create<SecurityContext>(url, DefaultResourceRetriever(FETCH_TIMEOUT_MS, FETCH_TIMEOUT_MS, MAX_JWKS_BYTES))
            .cache(Duration.ofHours(1).toMillis(), FETCH_TIMEOUT_MS.toLong())
            .rateLimited(Duration.ofMinutes(1).toMillis())
            .refreshAheadCache(false)
            .retrying(false)
            .build()

    override fun get(
        jwkSelector: JWKSelector,
        context: SecurityContext?,
    ): List<JWK> = delegate.get(jwkSelector, context)

    companion object {
        private const val FETCH_TIMEOUT_MS = 5_000
        private const val MAX_JWKS_BYTES = 64 * 1024
    }
}

/**
 * Stand-in signer for the local and test profiles (`fake-rtdn-signer`): an RSA 2048 key pair made
 * at start with `kid = local-rtdn-1`. Tests and a developer sign push tokens with [sign].
 */
class LocalRtdnSigner(
    private val clock: Clock,
) : RtdnKeySource {
    val key: RSAKey = RSAKeyGenerator(KEY_BITS).keyID(KID).generate()
    private val published = JWKSet(key.toPublicJWK())

    override fun get(
        jwkSelector: JWKSelector,
        context: SecurityContext?,
    ): List<JWK> = jwkSelector.select(published)

    /** A push token as Google would send it, with every claim overridable for negative tests. */
    fun sign(
        audience: String,
        email: String = EMAIL,
        issuer: String = "https://accounts.google.com",
        emailVerified: Any? = true,
        issuedAt: Instant = clock.instant(),
        expiresAt: Instant = issuedAt.plus(Duration.ofHours(1)),
        signingKey: RSAKey = key,
    ): String {
        val claims =
            JWTClaimsSet
                .Builder()
                .issuer(issuer)
                .audience(audience)
                .subject("1234567890")
                .claim("email", email)
                .claim("email_verified", emailVerified)
                .issueTime(Date.from(issuedAt))
                .expirationTime(Date.from(expiresAt))
                .build()
        val jwt =
            SignedJWT(
                JWSHeader
                    .Builder(JWSAlgorithm.RS256)
                    .keyID(signingKey.keyID)
                    .type(JOSEObjectType.JWT)
                    .build(),
                claims,
            )
        jwt.sign(RSASSASigner(signingKey))
        return jwt.serialize()
    }

    override fun toString(): String = "LocalRtdnSigner(kid=$KID)"

    companion object {
        const val ADAPTER_NAME = "fake-rtdn-signer"
        const val KID = "local-rtdn-1"
        const val EMAIL = "rtdn-push@cetele.invalid"
        private const val KEY_BITS = 2048
    }
}
