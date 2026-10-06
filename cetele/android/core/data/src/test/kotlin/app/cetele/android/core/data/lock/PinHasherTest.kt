package app.cetele.android.core.data.lock

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class PinHasherTest {
    @Test fun fixedParametersAndSaltSensitivity() {
        val hasher = PinHasher()
        val pin = CharArray(6) { ('1'.code + it).toChar() }
        val salt = ByteArray(16) { it.toByte() }
        val first = hasher.hash(pin, salt)
        assertArrayEquals(first, hasher.hash(pin, salt))
        assertFalse(first.contentEquals(hasher.hash(pin, ByteArray(16) { (it + 1).toByte() })))
        assertEquals(32, first.size)
        assertEquals(32768, PinHasher.MEMORY_KIB)
        assertEquals(3, PinHasher.ITERATIONS)
        assertEquals(1, PinHasher.PARALLELISM)
        assertThrows(IllegalArgumentException::class.java) { hasher.hash(charArrayOf('1'), salt) }
    }
}
