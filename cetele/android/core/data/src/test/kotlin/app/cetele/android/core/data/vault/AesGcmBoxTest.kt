package app.cetele.android.core.data.vault

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import javax.crypto.AEADBadTagException
import javax.crypto.KeyGenerator

class AesGcmBoxTest {
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test fun roundTripAndFreshIv() {
        val plaintext = "private contents".toByteArray()
        val aad = "entry".toByteArray()
        val first = AesGcmBox.seal(key, plaintext, aad)
        val second = AesGcmBox.seal(key, plaintext, aad)
        assertArrayEquals(plaintext, AesGcmBox.open(key, first, aad))
        assertFalse(first.iv.contentEquals(second.iv))
    }

    @Test fun tamperFails() {
        val box = AesGcmBox.seal(key, byteArrayOf(1, 2), byteArrayOf(3))
        box.ciphertext[0] = (box.ciphertext[0].toInt() xor 1).toByte()
        assertThrows(AEADBadTagException::class.java) { AesGcmBox.open(key, box, byteArrayOf(3)) }
    }

    @Test fun aadMismatchFails() {
        val box = AesGcmBox.seal(key, byteArrayOf(1), byteArrayOf(2))
        assertThrows(AEADBadTagException::class.java) { AesGcmBox.open(key, box, byteArrayOf(3)) }
    }
}
