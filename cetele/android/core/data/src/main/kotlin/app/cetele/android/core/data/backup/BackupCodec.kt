package app.cetele.android.core.data.backup

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.text.Normalizer
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Argon2id cost stored in every file header; decoding accepts only values inside the bounds below. */
data class BackupKdf(
    val memoryKib: Int = BackupFormat.DEFAULT_MEMORY_KIB,
    val iterations: Int = BackupFormat.DEFAULT_ITERATIONS,
    val parallelism: Int = BackupFormat.DEFAULT_PARALLELISM,
) {
    fun isSupported(): Boolean =
        memoryKib in BackupFormat.MIN_MEMORY_KIB..BackupFormat.MAX_MEMORY_KIB &&
            iterations in BackupFormat.MIN_ITERATIONS..BackupFormat.MAX_ITERATIONS &&
            parallelism in BackupFormat.MIN_PARALLELISM..BackupFormat.MAX_PARALLELISM
}

enum class BackupFailure {
    /** The bytes do not start with the `.cetele` magic number. */
    NOT_A_BACKUP,

    /** The format version is newer or older than this app understands. */
    UNSUPPORTED_VERSION,

    /** The header or body is cut short, oversized or structurally wrong. */
    MALFORMED,

    /** Wrong passphrase, or the header or ciphertext was changed. GCM cannot tell these apart. */
    AUTHENTICATION,
}

class BackupFormatException(
    val failure: BackupFailure,
) : Exception(failure.name)

/**
 * Binary layout of a `.cetele` file, version 1 (all integers big-endian, see docs/ops/export-format.md):
 * magic(8) version(u16) kdf(u8) memoryKib(u32) iterations(u32) parallelism(u8) saltLength(u8) salt
 * nonceLength(u8) nonce ciphertextLength(u32) ciphertext. Every byte before the ciphertext is the
 * GCM additional data, so a changed header fails authentication.
 */
object BackupFormat {
    /** 0x89 "CETELE" 0x0A: a non-ASCII lead byte keeps text tools from treating the file as text. */
    val MAGIC: ByteArray = byteArrayOf(0x89.toByte()) + "CETELE".toByteArray(Charsets.US_ASCII) + byteArrayOf(0x0A)
    const val VERSION = 1
    const val KDF_ARGON2ID_13 = 1
    const val SALT_BYTES = 16
    const val NONCE_BYTES = 12
    const val KEY_BYTES = 32
    const val TAG_BITS = 128
    const val TAG_BYTES = TAG_BITS / Byte.SIZE_BITS
    const val DEFAULT_MEMORY_KIB = 65_536
    const val DEFAULT_ITERATIONS = 3
    const val DEFAULT_PARALLELISM = 1
    const val MIN_MEMORY_KIB = 8_192
    const val MAX_MEMORY_KIB = 262_144
    const val MIN_ITERATIONS = 1
    const val MAX_ITERATIONS = 10
    const val MIN_PARALLELISM = 1
    const val MAX_PARALLELISM = 4
    const val MAX_FILE_BYTES = 64 * 1024 * 1024
    const val FILE_EXTENSION = "cetele"

    /** Fixed part of the header: magic, version, kdf, memory, iterations, parallelism, two lengths, body length. */
    const val HEADER_BYTES = 8 + 2 + 1 + 4 + 4 + 1 + 1 + SALT_BYTES + 1 + NONCE_BYTES + 4
}

class BackupCodec(
    private val kdf: BackupKdf = BackupKdf(),
    private val random: SecureRandom = SecureRandom(),
) {
    init {
        require(kdf.isSupported())
    }

    fun encrypt(
        plaintext: ByteArray,
        passphrase: CharArray,
    ): ByteArray {
        require(plaintext.size + BackupFormat.HEADER_BYTES + BackupFormat.TAG_BYTES <= BackupFormat.MAX_FILE_BYTES)
        val salt = ByteArray(BackupFormat.SALT_BYTES).also(random::nextBytes)
        val nonce = ByteArray(BackupFormat.NONCE_BYTES).also(random::nextBytes)
        val header = header(kdf, salt, nonce, plaintext.size + BackupFormat.TAG_BYTES)
        val key = derive(passphrase, salt, kdf)
        try {
            val body = cipher(Cipher.ENCRYPT_MODE, key, nonce, header).doFinal(plaintext)
            return header + body
        } finally {
            key.fill(0)
        }
    }

    companion object {
        private const val BYTE_MASK = 0xFF
        private const val SHORT_MASK = 0xFFFF

        fun decrypt(
            file: ByteArray,
            passphrase: CharArray,
        ): ByteArray {
            val parsed = parse(file)
            val key = derive(passphrase, parsed.salt, parsed.kdf)
            try {
                return cipher(Cipher.DECRYPT_MODE, key, parsed.nonce, parsed.header).doFinal(parsed.body)
            } catch (ignored: AEADBadTagException) {
                throw BackupFormatException(BackupFailure.AUTHENTICATION)
            } catch (ignored: GeneralSecurityException) {
                throw BackupFormatException(BackupFailure.AUTHENTICATION)
            } finally {
                key.fill(0)
            }
        }

        /** Reads the header without the passphrase; used to reject foreign or damaged files early. */
        fun inspect(file: ByteArray): BackupKdf = parse(file).kdf

        private class Parsed(
            val kdf: BackupKdf,
            val salt: ByteArray,
            val nonce: ByteArray,
            val header: ByteArray,
            val body: ByteArray,
        )

        @Suppress("CyclomaticComplexMethod", "ThrowsCount")
        private fun parse(file: ByteArray): Parsed {
            val magic = BackupFormat.MAGIC
            if (file.size < magic.size || !file.copyOfRange(0, magic.size).contentEquals(magic)) {
                throw BackupFormatException(BackupFailure.NOT_A_BACKUP)
            }
            if (file.size > BackupFormat.MAX_FILE_BYTES) throw BackupFormatException(BackupFailure.MALFORMED)
            if (file.size < magic.size + Short.SIZE_BYTES) throw BackupFormatException(BackupFailure.MALFORMED)
            val buffer = ByteBuffer.wrap(file)
            buffer.position(magic.size)
            val version = buffer.short.toInt() and SHORT_MASK
            if (version != BackupFormat.VERSION) throw BackupFormatException(BackupFailure.UNSUPPORTED_VERSION)
            if (file.size < BackupFormat.HEADER_BYTES) throw BackupFormatException(BackupFailure.MALFORMED)
            val kdfId = buffer.get().toInt() and BYTE_MASK
            val kdf = BackupKdf(buffer.int, buffer.int, buffer.get().toInt() and BYTE_MASK)
            if (kdfId != BackupFormat.KDF_ARGON2ID_13 || !kdf.isSupported()) {
                throw BackupFormatException(BackupFailure.MALFORMED)
            }
            val salt = lengthPrefixed(buffer, BackupFormat.SALT_BYTES)
            val nonce = lengthPrefixed(buffer, BackupFormat.NONCE_BYTES)
            val bodyLength = buffer.int
            val headerEnd = buffer.position()
            if (bodyLength < BackupFormat.TAG_BYTES || bodyLength.toLong() != (file.size - headerEnd).toLong()) {
                throw BackupFormatException(BackupFailure.MALFORMED)
            }
            return Parsed(kdf, salt, nonce, file.copyOfRange(0, headerEnd), file.copyOfRange(headerEnd, file.size))
        }

        private fun lengthPrefixed(
            buffer: ByteBuffer,
            expected: Int,
        ): ByteArray {
            val length = buffer.get().toInt() and BYTE_MASK
            if (length != expected) throw BackupFormatException(BackupFailure.MALFORMED)
            return ByteArray(length).also { buffer.get(it) }
        }

        private fun header(
            kdf: BackupKdf,
            salt: ByteArray,
            nonce: ByteArray,
            bodyLength: Int,
        ): ByteArray =
            ByteBuffer
                .allocate(BackupFormat.HEADER_BYTES)
                .put(BackupFormat.MAGIC)
                .putShort(BackupFormat.VERSION.toShort())
                .put(BackupFormat.KDF_ARGON2ID_13.toByte())
                .putInt(kdf.memoryKib)
                .putInt(kdf.iterations)
                .put(kdf.parallelism.toByte())
                .put(salt.size.toByte())
                .put(salt)
                .put(nonce.size.toByte())
                .put(nonce)
                .putInt(bodyLength)
                .array()

        /** NFC first, so the same passphrase typed on two keyboards derives the same key. */
        internal fun derive(
            passphrase: CharArray,
            salt: ByteArray,
            kdf: BackupKdf,
        ): ByteArray {
            val normalized = Normalizer.normalize(CharBuffer.wrap(passphrase), Normalizer.Form.NFC)
            val encoded = Charsets.UTF_8.encode(CharBuffer.wrap(normalized))
            val secret = ByteArray(encoded.remaining()).also { encoded.get(it) }
            if (encoded.hasArray()) encoded.array().fill(0)
            val parameters =
                Argon2Parameters
                    .Builder(Argon2Parameters.ARGON2_id)
                    .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                    .withMemoryAsKB(kdf.memoryKib)
                    .withIterations(kdf.iterations)
                    .withParallelism(kdf.parallelism)
                    .withSalt(salt)
                    .build()
            return try {
                ByteArray(BackupFormat.KEY_BYTES).also { key ->
                    Argon2BytesGenerator().apply {
                        init(parameters)
                        generateBytes(secret, key)
                    }
                }
            } finally {
                secret.fill(0)
            }
        }

        private fun cipher(
            mode: Int,
            key: ByteArray,
            nonce: ByteArray,
            aad: ByteArray,
        ): Cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(BackupFormat.TAG_BITS, nonce))
                updateAAD(aad)
            }
    }
}
