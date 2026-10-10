package app.cetele.server.admin.totp

import app.cetele.server.admin.AdminProperties
import app.cetele.server.config.LocalOnlyAdapterGuard
import dev.samstevens.totp.code.DefaultCodeGenerator
import dev.samstevens.totp.code.HashingAlgorithm
import dev.samstevens.totp.qr.QrData
import dev.samstevens.totp.qr.ZxingPngQrGenerator
import dev.samstevens.totp.secret.DefaultSecretGenerator
import dev.samstevens.totp.util.Utils
import org.slf4j.LoggerFactory
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * AES-256-GCM for TOTP secrets: `0x01 || nonce(12) || ciphertext || tag(16)` with the additional
 * data `UTF-8("cetele.admin.totp.v1")`. The key is `CETELE_ADMIN_TOTP_KEY` (standard Base64 of 32
 * bytes); empty is the local-only stand-in `ephemeral-admin-totp-key`.
 */
@Component
class TotpCipher(
    properties: AdminProperties,
    environment: Environment,
) {
    private val key = SecretKeySpec(resolveKey(properties.totpKey, environment), "AES")
    private val random = SecureRandom()

    fun encrypt(secret: String): ByteArray {
        val nonce = ByteArray(NONCE_BYTES).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce)) }
        cipher.updateAAD(AAD)
        val sealed = cipher.doFinal(secret.toByteArray(Charsets.US_ASCII))
        return byteArrayOf(VERSION) + nonce + sealed
    }

    /** The secret, or `null` when the value was not sealed with this key. */
    fun decrypt(value: ByteArray): String? {
        if (value.size < 1 + NONCE_BYTES + TAG_BITS / 8 || value[0] != VERSION) return null
        return try {
            val cipher =
                Cipher.getInstance(TRANSFORMATION).apply {
                    init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, value, 1, NONCE_BYTES))
                }
            cipher.updateAAD(AAD)
            String(cipher.doFinal(value, 1 + NONCE_BYTES, value.size - 1 - NONCE_BYTES), Charsets.US_ASCII)
        } catch (_: GeneralSecurityException) {
            null
        }
    }

    companion object {
        const val EPHEMERAL_ADAPTER = "ephemeral-admin-totp-key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val VERSION: Byte = 0x01
        private const val NONCE_BYTES = 12
        private const val TAG_BITS = 128
        private const val KEY_BYTES = 32
        private val AAD = "cetele.admin.totp.v1".toByteArray(Charsets.UTF_8)
        private val log = LoggerFactory.getLogger(TotpCipher::class.java)

        fun resolveKey(
            configured: String,
            environment: Environment,
        ): ByteArray {
            if (configured.isBlank()) {
                LocalOnlyAdapterGuard.check(EPHEMERAL_ADAPTER, environment)
                log.warn("Using an ephemeral admin TOTP key; enrolled authenticators do not survive a restart")
                return ByteArray(KEY_BYTES).also { SecureRandom().nextBytes(it) }
            }
            val decoded =
                runCatching { Base64.getDecoder().decode(configured.trim()) }
                    .getOrElse { throw IllegalStateException("CETELE_ADMIN_TOTP_KEY is not standard Base64") }
            check(decoded.size == KEY_BYTES) { "CETELE_ADMIN_TOTP_KEY must hold exactly 32 bytes" }
            return decoded
        }
    }
}

/** Enrollment material shown once: the `otpauth://` URI as text and as a PNG data URI. */
data class TotpEnrollment(
    val secret: String,
    val uri: String,
    val qrDataUri: String,
)

/**
 * RFC 6238 through `dev.samstevens.totp`: SHA-1, 6 digits, 30-second steps, one step of drift
 * either way. [matchStep] returns the matched time step so the caller can refuse a step that was
 * already used (`totp_last_step`).
 */
@Component
class TotpService(
    private val clock: Clock,
) {
    private val generator = DefaultCodeGenerator(HashingAlgorithm.SHA1, DIGITS)
    private val secrets = DefaultSecretGenerator(SECRET_CHARACTERS)

    /** 32 Base32 characters: 160 random bits. */
    fun newSecret(): String = secrets.generate()

    fun enrollment(
        secret: String,
        label: String,
    ): TotpEnrollment {
        val data =
            QrData
                .Builder()
                .label(label)
                .secret(secret)
                .issuer(ISSUER)
                .algorithm(HashingAlgorithm.SHA1)
                .digits(DIGITS)
                .period(PERIOD_SECONDS)
                .build()
        val png = ZxingPngQrGenerator().apply { imageSize = QR_SIZE }
        return TotpEnrollment(secret, data.uri, Utils.getDataUriForImage(png.generate(data), png.imageMimeType))
    }

    fun currentStep(): Long = Math.floorDiv(clock.instant().epochSecond, PERIOD_SECONDS.toLong())

    /** The step in `current - 1 .. current + 1` whose code equals [code], or `null`. */
    fun matchStep(
        secret: String,
        code: String,
    ): Long? {
        if (!CODE_FORMAT.matches(code)) return null
        val current = currentStep()
        var matched: Long? = null
        for (step in current - DRIFT_STEPS..current + DRIFT_STEPS) {
            val expected = generator.generate(secret, step)
            if (MessageDigest.isEqual(expected.toByteArray(Charsets.US_ASCII), code.toByteArray(Charsets.US_ASCII))) matched = step
        }
        return matched
    }

    companion object {
        const val DIGITS = 6
        const val PERIOD_SECONDS = 30
        const val DRIFT_STEPS = 1L
        const val ISSUER = "Çetele"
        private const val SECRET_CHARACTERS = 32
        private const val QR_SIZE = 240
        private val CODE_FORMAT = Regex("^[0-9]{6}$")
    }
}
