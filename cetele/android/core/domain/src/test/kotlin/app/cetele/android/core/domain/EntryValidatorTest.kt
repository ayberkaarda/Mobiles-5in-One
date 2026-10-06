package app.cetele.android.core.domain

import app.cetele.android.core.domain.validation.EntryValidator
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.LocalDate

class EntryValidatorTest {
    @Test
    fun `accepts inclusive amount date and note boundaries`() {
        for (amount in listOf(Limits.AMOUNT_MIN, Limits.AMOUNT_MAX)) {
            assertTrue(validate(amountMinor = amount, occurredOn = today.plusDays(1)).isEmpty())
        }
        assertTrue(validate(occurredOn = today.minusYears(10), note = "n".repeat(Limits.NOTE_MAX)).isEmpty())
        assertTrue(validate(dueOn = today.plusMonths(1)).isEmpty())
        assertTrue(validate(type = EntryType.PAYMENT).isEmpty())
    }

    @Test
    fun `zero amount is out of range`() {
        assertAmountError(0)
    }

    @Test
    fun `negative amount is out of range`() {
        assertAmountError(-1)
    }

    @Test
    fun `amount above maximum is out of range`() {
        assertAmountError(Limits.AMOUNT_MAX + 1)
        assertAmountError(Long.MAX_VALUE)
    }

    @Test
    fun `date beyond tomorrow is out of range`() {
        assertEquals(
            listOf(FieldError("entry.occurredOn", FieldCodes.OUT_OF_RANGE)),
            validate(occurredOn = today.plusDays(2)),
        )
    }

    @Test
    fun `payment due date is invalid format`() {
        assertEquals(
            listOf(FieldError("entry.dueOn", FieldCodes.INVALID_FORMAT)),
            validate(type = EntryType.PAYMENT, dueOn = today),
        )
    }

    @Test
    fun `long note is too long`() {
        assertEquals(
            listOf(FieldError("entry.note", FieldCodes.TOO_LONG)),
            validate(note = "n".repeat(Limits.NOTE_MAX + 1)),
        )
    }

    @Test
    fun `reversal cannot carry due date`() {
        assertEquals(
            listOf(FieldError("entry.dueOn", FieldCodes.INVALID_FORMAT)),
            validate(reverses = "original", dueOn = today),
        )
    }

    @Test
    fun `reversal cannot carry photo`() {
        assertEquals(
            listOf(FieldError("entry.photoKey", FieldCodes.INVALID_FORMAT)),
            validate(reverses = "original", photoKey = "media/shop/photo.jpg"),
        )
    }

    @Test
    fun `overlapping due date failures produce one error`() {
        assertEquals(
            listOf(FieldError("entry.dueOn", FieldCodes.INVALID_FORMAT)),
            validate(type = EntryType.PAYMENT, reverses = "original", dueOn = today),
        )
    }

    @Test
    fun `draft preserves original type amount and customer and clears attachments`() {
        for (type in EntryType.entries) {
            val original = entry(type = type, dueOn = today).copy(photoKey = "media/shop/photo.jpg")
            assertTrue(EntryValidator.canReverse(original))
            val draft = EntryValidator.reversalOf(original, today.plusDays(1))
            assertEquals(type, draft.type)
            assertEquals(original.amount, draft.amount)
            assertEquals(original.customerId, draft.customerId)
            assertEquals(original.id, draft.reverses)
            assertEquals(today.plusDays(1), draft.occurredOn)
            assertNull(draft.dueOn)
            assertNull(draft.photoKey)
            assertTrue(
                EntryValidator
                    .validate(
                        draft.type,
                        draft.amount.minor,
                        draft.occurredOn,
                        draft.dueOn,
                        draft.note,
                        draft.photoKey,
                        draft.reverses,
                        today.plusDays(1),
                    ).isEmpty(),
            )
        }
    }

    @Test
    fun `reversed original and correction cannot be reversed again`() {
        listOf(entry(reversedBy = "correction"), entry(reverses = "original")).forEach {
            assertFalse(EntryValidator.canReverse(it))
            assertThrows<IllegalArgumentException> { EntryValidator.reversalOf(it, today) }
        }
    }

    private fun assertAmountError(amount: Long) {
        assertEquals(listOf(FieldError("entry.amountMinor", FieldCodes.OUT_OF_RANGE)), validate(amountMinor = amount))
    }

    @Suppress("LongParameterList")
    private fun validate(
        type: EntryType = EntryType.DEBT,
        amountMinor: Long = 1250,
        occurredOn: LocalDate = today,
        dueOn: LocalDate? = null,
        note: String? = null,
        photoKey: String? = null,
        reverses: String? = null,
    ): List<FieldError> = EntryValidator.validate(type, amountMinor, occurredOn, dueOn, note, photoKey, reverses, today)
}
