package app.cetele.android.core.domain

import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.EntryValidator
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.containsBidiControl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.LocalDate

class BidiValidationTest {
    @Test
    fun `every bidi control is rejected in customer text and entry notes`() {
        val controls = listOf('\u200E', '\u200F', '\u061C') + ('\u202A'..'\u202E') + ('\u2066'..'\u2069')
        controls.forEach { control ->
            val text = "a${control}b"
            assertTrue(containsBidiControl(text))
            assertEquals(
                listOf("customer.name", "customer.note", "customer.tag")
                    .map { FieldError(it, FieldCodes.INVALID_FORMAT) },
                CustomerValidator.validate(text, null, text, text, false, null, null),
            )
            assertEquals(listOf(FieldError("entry.note", FieldCodes.INVALID_FORMAT)), entryErrors(text))
        }
    }

    @Test
    fun `Turkish text and joined emoji remain valid`() {
        listOf("Çağrı Şişçi", "👩\u200D💻", "a\u200Cb").forEach { text ->
            assertFalse(containsBidiControl(text))
            assertTrue(CustomerValidator.validate(text, null, "$text\n", text, false, null, null).isEmpty())
            assertTrue(entryErrors("$text\n").isEmpty())
        }
    }

    private fun entryErrors(note: String): List<FieldError> {
        val today = LocalDate.of(2026, 10, 11)
        return EntryValidator.validate(EntryType.DEBT, 1, today, null, note, null, null, today)
    }
}
