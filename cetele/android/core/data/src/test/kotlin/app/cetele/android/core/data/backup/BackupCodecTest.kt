package app.cetele.android.core.data.backup

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.nio.ByteBuffer

class BackupCodecTest {
    private val fast = BackupKdf(memoryKib = BackupFormat.MIN_MEMORY_KIB, iterations = 1, parallelism = 1)
    private val codec = BackupCodec(fast)
    private val plain = "{\"shop\":\"Çınar Bakkalı\"}".toByteArray()
    private val passphrase = "doğru at pil zımba".toCharArray()

    @Test fun roundTripKeepsContentAndStoresParametersInTheHeader() {
        val first = codec.encrypt(plain, passphrase)
        val second = codec.encrypt(plain, passphrase)
        assertArrayEquals(plain, BackupCodec.decrypt(first, passphrase))
        assertEquals(fast, BackupCodec.inspect(first))
        assertArrayEquals(BackupFormat.MAGIC, first.copyOfRange(0, BackupFormat.MAGIC.size))
        assertEquals(BackupFormat.HEADER_BYTES + plain.size + BackupFormat.TAG_BYTES, first.size)
        assertFalse(first.contentEquals(second), "salt and nonce must be fresh for every file")
        assertFalse(String(first, Charsets.ISO_8859_1).contains("Bakkal"))
    }

    @Test fun defaultParametersAreArgon2idSixtyFourMebibytesThreePasses() {
        val file = BackupCodec().encrypt(plain, passphrase)
        assertEquals(BackupKdf(65_536, 3, 1), BackupCodec.inspect(file))
        val buffer = ByteBuffer.wrap(file, BackupFormat.MAGIC.size, 3)
        assertEquals(BackupFormat.VERSION, buffer.short.toInt())
        assertEquals(BackupFormat.KDF_ARGON2ID_13, buffer.get().toInt())
        assertArrayEquals(plain, BackupCodec.decrypt(file, passphrase))
    }

    @Test fun composedAndDecomposedPassphrasesDeriveTheSameKey() {
        val composed = "çay ocağı".toCharArray()
        val decomposed = "çay ocağı".toCharArray()
        assertArrayEquals(plain, BackupCodec.decrypt(codec.encrypt(plain, composed), decomposed))
    }

    @Test fun wrongPassphraseFailsAuthentication() {
        val file = codec.encrypt(plain, passphrase)
        assertFailure(BackupFailure.AUTHENTICATION) { BackupCodec.decrypt(file, "doğru at pil zimba".toCharArray()) }
        assertFailure(BackupFailure.AUTHENTICATION) { BackupCodec.decrypt(file, CharArray(0)) }
    }

    @Test fun everyChangedHeaderByteIsRejected() {
        val file = codec.encrypt(plain, passphrase)
        for (index in 0 until BackupFormat.HEADER_BYTES) {
            val changed = file.copyOf().also { it[index] = (it[index].toInt() xor 0x01).toByte() }
            val failure = assertThrows<BackupFormatException> { BackupCodec.decrypt(changed, passphrase) }.failure
            val expected =
                when (index) {
                    in 0 until BackupFormat.MAGIC.size -> BackupFailure.NOT_A_BACKUP
                    in 8 until 10 -> BackupFailure.UNSUPPORTED_VERSION
                    else -> null
                }
            if (expected != null) {
                assertEquals(expected, failure, "byte $index")
            } else {
                assertFalse(failure == BackupFailure.NOT_A_BACKUP, "byte $index")
            }
        }
    }

    @Test fun inBoundsParameterChangeFailsAuthenticationAndOutOfBoundsIsMalformed() {
        val file = codec.encrypt(plain, passphrase)
        val iterationsOffset = BackupFormat.MAGIC.size + 2 + 1 + 4
        val twoPasses = file.copyOf().also { ByteBuffer.wrap(it).putInt(iterationsOffset, 2) }
        assertFailure(BackupFailure.AUTHENTICATION) { BackupCodec.decrypt(twoPasses, passphrase) }
        val memoryOffset = BackupFormat.MAGIC.size + 2 + 1
        val huge = file.copyOf().also { ByteBuffer.wrap(it).putInt(memoryOffset, Int.MAX_VALUE) }
        assertFailure(BackupFailure.MALFORMED) { BackupCodec.decrypt(huge, passphrase) }
        val tiny = file.copyOf().also { ByteBuffer.wrap(it).putInt(memoryOffset, 8) }
        assertFailure(BackupFailure.MALFORMED) { BackupCodec.decrypt(tiny, passphrase) }
        val kdf = file.copyOf().also { it[BackupFormat.MAGIC.size + 2] = 2 }
        assertFailure(BackupFailure.MALFORMED) { BackupCodec.decrypt(kdf, passphrase) }
    }

    @Test fun changedCiphertextOrTagFailsAuthentication() {
        val file = codec.encrypt(plain, passphrase)
        for (index in listOf(BackupFormat.HEADER_BYTES, BackupFormat.HEADER_BYTES + plain.size / 2, file.size - 1)) {
            val changed = file.copyOf().also { it[index] = (it[index].toInt() xor 0x80).toByte() }
            assertFailure(BackupFailure.AUTHENTICATION) { BackupCodec.decrypt(changed, passphrase) }
        }
    }

    @Test fun truncatedOrExtendedFilesAreRejected() {
        val file = codec.encrypt(plain, passphrase)
        assertFailure(BackupFailure.NOT_A_BACKUP) { BackupCodec.decrypt(ByteArray(0), passphrase) }
        assertFailure(BackupFailure.NOT_A_BACKUP) { BackupCodec.decrypt(file.copyOf(5), passphrase) }
        for (length in listOf(9, 12, BackupFormat.HEADER_BYTES - 1, BackupFormat.HEADER_BYTES, file.size - 1)) {
            assertFailure(BackupFailure.MALFORMED) { BackupCodec.decrypt(file.copyOf(length), passphrase) }
        }
        assertFailure(BackupFailure.MALFORMED) { BackupCodec.decrypt(file + byteArrayOf(0), passphrase) }
    }

    @Test fun unknownVersionIsRejectedBeforeTheKeyIsDerived() {
        val file = codec.encrypt(plain, passphrase)
        for (version in listOf(0, 2, 0xFFFF)) {
            val changed =
                file.copyOf().also {
                    ByteBuffer
                        .wrap(
                            it,
                        ).putShort(BackupFormat.MAGIC.size, version.toShort())
                }
            assertFailure(BackupFailure.UNSUPPORTED_VERSION) { BackupCodec.decrypt(changed, passphrase) }
        }
    }

    @Test fun foreignFilesAreNotBackups() {
        assertFailure(BackupFailure.NOT_A_BACKUP) { BackupCodec.decrypt("%PDF-1.7".toByteArray(), passphrase) }
        assertFailure(BackupFailure.NOT_A_BACKUP) { BackupCodec.inspect("CETELE".toByteArray()) }
    }

    private fun assertFailure(
        expected: BackupFailure,
        block: () -> Unit,
    ) {
        assertEquals(expected, assertThrows<BackupFormatException> { block() }.failure)
    }
}
