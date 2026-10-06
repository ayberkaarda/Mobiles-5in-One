package app.cetele.android.core.designsystem

import app.cetele.android.core.designsystem.copy.FieldErrorText
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.EntryValidator
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import java.time.LocalDate

class FieldErrorTextTest {
    @Test
    fun `all customer validator failures have specific copy`() {
        val errors =
            CustomerValidator.validate("", "invalid", "n".repeat(501), "", true, null, null) +
                CustomerValidator.validate("n".repeat(81), null, null, "t".repeat(31), false, null, null)
        assertEquals(8, errors.size)
        errors.forEach { assertNotEquals(R.string.error_validation_failed, FieldErrorText.resId(it), it.toString()) }
        assertEquals(R.string.error_field_name_required, FieldErrorText.resId("customer.name", "required"))
    }

    @Test
    fun `all entry validator failures have specific copy`() {
        val today = LocalDate.of(2026, 10, 6)
        val errors =
            EntryValidator.validate(
                EntryType.PAYMENT,
                0,
                today.plusDays(2),
                today,
                "n".repeat(501),
                "photo",
                "original",
                today,
            )
        assertEquals(5, errors.size)
        errors.forEach { assertNotEquals(R.string.error_validation_failed, FieldErrorText.resId(it), it.toString()) }
        assertEquals(
            R.string.error_field_amount_out_of_range,
            FieldErrorText.resId("entry.amountMinor", "out_of_range"),
        )
    }

    @Test
    fun `unrecognized field and code have safe copy`() {
        assertEquals(R.string.error_field_required, FieldErrorText.resId("unknown", "required"))
        assertEquals(R.string.error_validation_failed, FieldErrorText.resId("unknown", "unknown"))
    }
}
