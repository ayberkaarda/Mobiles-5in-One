package app.cetele.android.core.network

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ApiConfigTest {
    @Test
    fun `accepts https and normalises the trailing slash`() {
        assertEquals("https://api.cetele.app/", ApiConfig("https://api.cetele.app").baseUrl)
    }

    @Test
    fun `accepts plain http only for the emulator host`() {
        assertEquals("http://10.0.2.2:60080/", ApiConfig("http://10.0.2.2:60080").baseUrl)
        assertThrows<IllegalArgumentException> { ApiConfig("http://api.cetele.app") }
        assertThrows<IllegalArgumentException> { ApiConfig("http://192.168.1.10:60080") }
    }

    @Test
    fun `rejects values that are not absolute URLs`() {
        assertThrows<IllegalArgumentException> { ApiConfig("") }
        assertThrows<IllegalArgumentException> { ApiConfig("api.cetele.app") }
        assertThrows<IllegalArgumentException> { ApiConfig("ftp://api.cetele.app") }
    }

    @Test
    fun `rejects credentials query strings and fragments`() {
        assertThrows<IllegalArgumentException> { ApiConfig("https://user:password@api.cetele.app") }
        assertThrows<IllegalArgumentException> { ApiConfig("https://api.cetele.app?phone=value") }
        assertThrows<IllegalArgumentException> { ApiConfig("https://api.cetele.app#fragment") }
    }
}
