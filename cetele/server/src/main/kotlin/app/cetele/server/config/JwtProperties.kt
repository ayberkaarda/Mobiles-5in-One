package app.cetele.server.config

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * Access token settings. The key pair comes from `CETELE_JWT_ES256_PRIVATE_KEY_PEM` (PKCS#8) and
 * `CETELE_JWT_ES256_PUBLIC_KEY_PEM` (X.509 SubjectPublicKeyInfo), both P-256. When both are empty
 * and the profile is `local` or `test`, an ephemeral pair is created at startup.
 */
@ConfigurationProperties(prefix = "cetele.jwt")
data class JwtProperties(
    val privateKeyPem: String = "",
    val publicKeyPem: String = "",
    val issuer: String = "https://cetele.app",
    val accessTokenTtl: Duration = Duration.ofMinutes(15),
    val clockSkew: Duration = Duration.ofSeconds(30),
) {
    override fun toString(): String = "JwtProperties(issuer=$issuer, accessTokenTtl=$accessTokenTtl, clockSkew=$clockSkew, keys=<masked>)"
}
