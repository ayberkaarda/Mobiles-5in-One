package app.cetele.server.billing.play

import com.nimbusds.jose.JOSEObjectType
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import org.springframework.http.MediaType
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.security.KeyFactory
import java.security.interfaces.RSAPrivateKey
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.Date

/** The three fields of a Google service account key file that the token exchange needs. */
class ServiceAccountKey(
    val clientEmail: String,
    val privateKey: RSAPrivateKey,
    val tokenUri: URI,
) {
    override fun toString(): String = "ServiceAccountKey(clientEmail=$clientEmail)"

    companion object {
        /** Parses the JSON key file; the failure message never contains any part of it. */
        fun parse(
            json: String,
            mapper: ObjectMapper,
        ): ServiceAccountKey {
            val invalid = "CETELE_PLAY_SERVICE_ACCOUNT_JSON is not a service account key"
            val node = runCatching { mapper.readTree(json) }.getOrNull() ?: error(invalid)
            val email =
                node
                    .path("client_email")
                    .takeIf { it.isString }
                    ?.asString()
                    ?.trim()
                    .orEmpty()
            val pem =
                node
                    .path("private_key")
                    .takeIf { it.isString }
                    ?.asString()
                    .orEmpty()
            val tokenUri =
                node
                    .path("token_uri")
                    .takeIf { it.isString }
                    ?.asString()
                    ?.trim()
                    .orEmpty()
            check(email.isNotEmpty() && pem.isNotEmpty() && tokenUri.isNotEmpty()) { invalid }
            val key =
                runCatching {
                    val body =
                        pem
                            .replace("\\n", "\n")
                            .replace("-----BEGIN PRIVATE KEY-----", "")
                            .replace("-----END PRIVATE KEY-----", "")
                            .filterNot { it.isWhitespace() }
                    KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(body))) as RSAPrivateKey
                }.getOrElse { error(invalid) }
            val uri = runCatching { URI.create(tokenUri) }.getOrNull()
            check(uri != null && uri.scheme == "https" && !uri.host.isNullOrBlank()) { invalid }
            return ServiceAccountKey(email, key, uri)
        }
    }
}

/** Thrown when no access token could be obtained; the message is a short reason, never a secret. */
class GoogleTokenUnavailable(
    reason: String,
) : RuntimeException(reason) {
    override fun fillInStackTrace(): Throwable = this
}

/**
 * OAuth 2.0 access tokens for a Google service account (two-legged JWT bearer flow): an RS256
 * assertion signed with the account's key is exchanged at `token_uri`, and the access token is
 * cached until [REFRESH_MARGIN] before its expiry. No Google client library is involved. Billing
 * uses it for the Android Publisher scope; the Play Integrity client can share the same class.
 *
 * Shape per Google's public documentation, not verified against the live endpoint (ADR-0031).
 */
class GoogleServiceAccountTokens(
    private val key: ServiceAccountKey,
    private val scope: String,
    private val rest: RestClient,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    private var cached: String? = null
    private var validUntil: Instant = Instant.MIN

    @Synchronized
    fun accessToken(): String {
        val now = clock.instant()
        cached?.takeIf { now.isBefore(validUntil) }?.let { return it }
        val form =
            LinkedMultiValueMap<String, String>().apply {
                add("grant_type", GRANT_TYPE)
                add("assertion", assertion(now))
            }
        val body =
            try {
                rest
                    .post()
                    .uri(key.tokenUri)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .exchange { _, response ->
                        if (!response.statusCode.is2xxSuccessful) {
                            throw GoogleTokenUnavailable("token_http_${response.statusCode.value()}")
                        }
                        response.body.readAllBytes().toString(Charsets.UTF_8)
                    }
            } catch (exception: RestClientException) {
                throw GoogleTokenUnavailable("token_transport")
            }
        val node = runCatching { mapper.readTree(body) }.getOrNull() ?: throw GoogleTokenUnavailable("token_unparseable")
        val token = node.path("access_token").takeIf { it.isString }?.asString()
        val expiresIn = node.path("expires_in").takeIf { it.isNumber }?.asLong() ?: DEFAULT_LIFETIME.seconds
        if (token.isNullOrBlank()) throw GoogleTokenUnavailable("token_missing")
        cached = token
        validUntil = now.plusSeconds(expiresIn).minus(REFRESH_MARGIN)
        return token
    }

    /** The signed JWT bearer assertion for [now] (public for the adapter test). */
    fun assertion(now: Instant): String {
        val claims =
            JWTClaimsSet
                .Builder()
                .issuer(key.clientEmail)
                .audience(key.tokenUri.toString())
                .claim("scope", scope)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(ASSERTION_LIFETIME)))
                .build()
        val jwt = SignedJWT(JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).build(), claims)
        jwt.sign(RSASSASigner(key.privateKey))
        return jwt.serialize()
    }

    companion object {
        const val ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
        const val GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer"
        val REFRESH_MARGIN: Duration = Duration.ofSeconds(60)
        val ASSERTION_LIFETIME: Duration = Duration.ofHours(1)
        private val DEFAULT_LIFETIME: Duration = Duration.ofHours(1)
    }
}
