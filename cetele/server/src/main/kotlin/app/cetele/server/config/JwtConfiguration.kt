package app.cetele.server.config

import app.cetele.server.security.JwtCodec
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.time.Clock
import java.util.Base64

@Configuration(proxyBeanMethods = false)
class JwtConfiguration {
    private val log = LoggerFactory.getLogger(JwtConfiguration::class.java)

    @Bean
    fun clock(): Clock = Clock.systemUTC()

    @Bean
    fun jwtCodec(
        properties: JwtProperties,
        environment: Environment,
        clock: Clock,
    ): JwtCodec {
        val keys = keyPair(properties, environment)
        return JwtCodec(
            signingKey = keys.private as ECPrivateKey,
            verificationKey = keys.public as ECPublicKey,
            issuer = properties.issuer,
            accessTokenTtl = properties.accessTokenTtl,
            clockSkew = properties.clockSkew,
            clock = clock,
        )
    }

    private fun keyPair(
        properties: JwtProperties,
        environment: Environment,
    ): KeyPair {
        val privatePem = properties.privateKeyPem
        val publicPem = properties.publicKeyPem
        if (privatePem.isBlank() && publicPem.isBlank()) {
            LocalOnlyAdapterGuard.check(EPHEMERAL_KEYS_ADAPTER, environment)
            log.warn("Using an ephemeral ES256 key pair; access tokens do not survive a restart")
            return EcKeys.generate()
        }
        check(privatePem.isNotBlank() && publicPem.isNotBlank()) {
            "CETELE_JWT_ES256_PRIVATE_KEY_PEM and CETELE_JWT_ES256_PUBLIC_KEY_PEM must both be set"
        }
        return EcKeys.parse(privatePem, publicPem)
    }

    companion object {
        const val EPHEMERAL_KEYS_ADAPTER = "ephemeral-jwt-keys"
    }
}

/** P-256 key handling for the access token keys. */
internal object EcKeys {
    private val p256: ECParameterSpec =
        AlgorithmParameters
            .getInstance("EC")
            .apply { init(ECGenParameterSpec("secp256r1")) }
            .getParameterSpec(ECParameterSpec::class.java)

    fun generate(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    fun parse(
        privatePem: String,
        publicPem: String,
    ): KeyPair {
        val factory = KeyFactory.getInstance("EC")
        val privateKey =
            runCatching { factory.generatePrivate(PKCS8EncodedKeySpec(der(privatePem, "PRIVATE KEY"))) as ECPrivateKey }
                .getOrElse { throw IllegalStateException("CETELE_JWT_ES256_PRIVATE_KEY_PEM is not a PKCS#8 EC private key") }
        val publicKey =
            runCatching { factory.generatePublic(X509EncodedKeySpec(der(publicPem, "PUBLIC KEY"))) as ECPublicKey }
                .getOrElse { throw IllegalStateException("CETELE_JWT_ES256_PUBLIC_KEY_PEM is not an X.509 EC public key") }
        check(isP256(privateKey.params) && isP256(publicKey.params)) { "JWT keys must use the P-256 curve" }
        check(matches(privateKey, publicKey)) { "JWT private and public keys do not belong together" }
        return KeyPair(publicKey, privateKey)
    }

    private fun isP256(params: ECParameterSpec): Boolean = params.order == p256.order && params.curve == p256.curve

    private fun matches(
        privateKey: ECPrivateKey,
        publicKey: ECPublicKey,
    ): Boolean {
        val probe = "cetele-key-check".toByteArray()
        val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }
        signature.update(probe)
        val signed = signature.sign()
        val verifier = Signature.getInstance("SHA256withECDSA").apply { initVerify(publicKey) }
        verifier.update(probe)
        return verifier.verify(signed)
    }

    /** Accepts real line breaks or escaped `\n` sequences, as environment variables often carry. */
    private fun der(
        pem: String,
        label: String,
    ): ByteArray {
        val body =
            pem
                .replace("\\n", "\n")
                .replace("-----BEGIN $label-----", "")
                .replace("-----END $label-----", "")
                .filterNot { it.isWhitespace() }
        return Base64.getDecoder().decode(body)
    }
}
