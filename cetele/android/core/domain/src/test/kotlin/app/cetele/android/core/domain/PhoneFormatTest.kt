package app.cetele.android.core.domain

import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.PhoneValidator
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class PhoneFormatTest {
    private val phone = "+905321234567"

    @Test
    fun `normalizes supported Turkish mobile forms`() {
        listOf("05321234567", "5321234567", phone, "0 532 123 45 67", "+90-532-123-45-67").forEach {
            assertEquals(phone, PhoneFormat.toE164Tr(it))
        }
        assertEquals("0 532 123 45 67", PhoneFormat.display(phone))
        assertEquals("+90*******67", PhoneFormat.masked(phone))
    }

    @Test
    fun `rejects foreign landline incomplete and extra characters`() {
        listOf("", "02121234567", "+445321234567", "0532123456", "053212345678", "(0532)1234567", "abc$phone")
            .forEach { assertNull(PhoneFormat.toE164Tr(it), it) }
        assertThrows<IllegalArgumentException> { PhoneFormat.display("invalid") }
        assertThrows<IllegalArgumentException> { PhoneFormat.masked("invalid") }
    }

    @Test
    fun `phone validator requires canonical wire format`() {
        assertTrue(PhoneValidator.validate(phone).isEmpty())
        assertEquals(listOf(FieldError("phone", FieldCodes.REQUIRED)), PhoneValidator.validate(" "))
        assertEquals(
            listOf(FieldError("phone", FieldCodes.INVALID_FORMAT)),
            PhoneValidator.validate("05321234567"),
        )
    }
}
