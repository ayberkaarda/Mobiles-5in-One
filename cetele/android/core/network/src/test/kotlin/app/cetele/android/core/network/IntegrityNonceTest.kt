package app.cetele.android.core.network

import app.cetele.android.core.network.integrity.IntegrityNonce
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class IntegrityNonceTest {
    @Test
    fun `server vector uses UTF8 concatenation and lowercase device text`() {
        val expected = "QDUkwVEuConltSaG5p_MHd9y8dhGWkhcHh_xwFou4Bw"
        assertEquals(expected, IntegrityNonce.of("+905321234567", "0190b7e2-1a2b-7c3d-8e4f-5a6b7c8d9e0f"))
        assertEquals(expected, IntegrityNonce.of("+905321234567", "0190B7E2-1A2B-7C3D-8E4F-5A6B7C8D9E0F"))
    }
}
