package app.cetele.android.feature.shop

import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.network.dto.ShopType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ShopFormBidiTest {
    @Test
    fun `every bidi control is rejected in shop text fields`() {
        val controls = listOf('\u200E', '\u200F', '\u061C') + ('\u202A'..'\u202E') + ('\u2066'..'\u2069')
        controls.forEach { control ->
            val text = "a${control}b"
            assertEquals(
                listOf("name", "il", "ilce").map { FieldError(it, FieldCodes.INVALID_FORMAT) },
                ShopForm(text, ShopType.BAKKAL, text, text).errors(),
            )
        }
    }

    @Test
    fun `Turkish and joined emoji shop names remain valid`() {
        listOf("Çağrı Şişçi", "👩\u200D💻").forEach { text ->
            assertTrue(ShopForm(text, ShopType.BAKKAL, "İstanbul", "Şişli").errors().isEmpty())
        }
    }
}
