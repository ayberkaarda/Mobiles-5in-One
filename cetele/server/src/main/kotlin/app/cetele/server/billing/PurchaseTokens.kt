package app.cetele.server.billing

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Hashing rules shared by the server and the app (ADR-0031, handoff 002 test vectors). */
object PurchaseTokens {
    /** `purchaseToken` of the link body: 1 to 4096 characters of `[A-Za-z0-9._-]`. */
    const val TOKEN_PATTERN = "^[A-Za-z0-9._-]+$"
    const val TOKEN_MAX = 4096
    private val token = Regex(TOKEN_PATTERN)

    fun isWellFormed(value: String): Boolean = value.length in 1..TOKEN_MAX && token.matches(value)

    /** `lowercase_hex(SHA-256(UTF-8(token)))`, the stored and logged-never key of a purchase. */
    fun hash(purchaseToken: String): String = sha256Hex(purchaseToken)

    /** `lowercase_hex(SHA-256(UTF-8(shopId)))` with the shop id in canonical lowercase UUID text. */
    fun obfuscatedAccountId(shopId: UUID): String = sha256Hex(shopId.toString().lowercase())

    private fun sha256Hex(text: String): String =
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)))
}

/**
 * AES-256-GCM for stored purchase tokens: `0x01 || nonce(12) || ciphertext || tag(16)` with the
 * additional data `cetele.billing.token.v1`. A token that cannot be decrypted (wrong key, an
 * ephemeral key after a restart, a damaged value) reads as `null`.
 */
class PurchaseTokenCipher(
    key: ByteArray,
) {
    private val secret: SecretKeySpec
    private val random = SecureRandom()

    init {
        require(key.size == KEY_BYTES) { "CETELE_BILLING_TOKEN_KEY must be standard Base64 of exactly 32 bytes" }
        secret = SecretKeySpec(key.copyOf(), "AES")
    }

    fun encrypt(token: String): ByteArray {
        val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secret, GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(AAD)
        val sealed = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        return ByteBuffer
            .allocate(1 + NONCE_BYTES + sealed.size)
            .put(VERSION)
            .put(nonce)
            .put(sealed)
            .array()
    }

    fun decrypt(blob: ByteArray?): String? {
        if (blob == null || blob.size < 1 + NONCE_BYTES + TAG_BITS / 8 || blob[0] != VERSION) return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(TAG_BITS, blob, 1, NONCE_BYTES))
            cipher.updateAAD(AAD)
            String(cipher.doFinal(blob, 1 + NONCE_BYTES, blob.size - 1 - NONCE_BYTES), Charsets.UTF_8)
        } catch (_: AEADBadTagException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    override fun toString(): String = "PurchaseTokenCipher"

    companion object {
        const val KEY_BYTES = 32
        const val VERSION: Byte = 0x01
        private const val NONCE_BYTES = 12
        private const val TAG_BITS = 128
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private val AAD = "cetele.billing.token.v1".toByteArray(Charsets.UTF_8)

        /** Parses `CETELE_BILLING_TOKEN_KEY`; the error never repeats the value. */
        fun fromBase64(text: String): PurchaseTokenCipher {
            val bytes =
                runCatching { Base64.getDecoder().decode(text.trim()) }
                    .getOrElse { throw IllegalStateException("CETELE_BILLING_TOKEN_KEY must be standard Base64 of exactly 32 bytes") }
            check(bytes.size == KEY_BYTES) { "CETELE_BILLING_TOKEN_KEY must be standard Base64 of exactly 32 bytes" }
            return PurchaseTokenCipher(bytes)
        }

        fun ephemeral(): PurchaseTokenCipher = PurchaseTokenCipher(ByteArray(KEY_BYTES).also(SecureRandom()::nextBytes))
    }
}
