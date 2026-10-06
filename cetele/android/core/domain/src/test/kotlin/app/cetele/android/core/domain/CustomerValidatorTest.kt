package app.cetele.android.core.domain

import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

class CustomerValidatorTest {
    @Test
    fun `accepts trimmed name and all maximum lengths`() {
        assertTrue(validate(name = "  Ayşe  ").isEmpty())
        assertTrue(
            validate(
                name = "a".repeat(Limits.NAME_MAX),
                phone = "+905321234567",
                note = "n".repeat(Limits.NOTE_MAX),
                tag = "t".repeat(Limits.TAG_MAX),
                smsConsent = true,
                smsConsentAt = createdAt,
                smsConsentSource = ConsentSource.IN_PERSON,
            ).isEmpty(),
        )
    }

    @Test
    fun `blank name is required`() {
        assertEquals(listOf(FieldError("customer.name", FieldCodes.REQUIRED)), validate(name = "  "))
    }

    @Test
    fun `name over eighty characters is too long`() {
        assertEquals(
            listOf(FieldError("customer.name", FieldCodes.TOO_LONG)),
            validate(name = "a".repeat(Limits.NAME_MAX + 1)),
        )
    }

    @Test
    fun `phone must be canonical Turkish mobile or null`() {
        listOf("", "05321234567", "+902121234567", "+90532123456", "+9053212345678").forEach {
            assertEquals(listOf(FieldError("customer.phone", FieldCodes.INVALID_FORMAT)), validate(phone = it))
        }
    }

    @Test
    fun `note over five hundred characters is too long`() {
        assertEquals(
            listOf(FieldError("customer.note", FieldCodes.TOO_LONG)),
            validate(note = "n".repeat(Limits.NOTE_MAX + 1)),
        )
    }

    @Test
    fun `empty tag is required`() {
        assertEquals(listOf(FieldError("customer.tag", FieldCodes.REQUIRED)), validate(tag = ""))
    }

    @Test
    fun `tag over thirty characters is too long`() {
        assertEquals(
            listOf(FieldError("customer.tag", FieldCodes.TOO_LONG)),
            validate(tag = "t".repeat(Limits.TAG_MAX + 1)),
        )
    }

    @Test
    fun `consent requires timestamp`() {
        assertEquals(
            listOf(FieldError("customer.smsConsentAt", FieldCodes.REQUIRED)),
            validate(smsConsent = true, smsConsentSource = ConsentSource.PHONE),
        )
    }

    @Test
    fun `consent requires source`() {
        assertEquals(
            listOf(FieldError("customer.smsConsentSource", FieldCodes.REQUIRED)),
            validate(smsConsent = true, smsConsentAt = createdAt),
        )
    }

    @Test
    fun `returns both missing evidence fields in server order`() {
        assertEquals(
            listOf(
                FieldError("customer.smsConsentAt", FieldCodes.REQUIRED),
                FieldError("customer.smsConsentSource", FieldCodes.REQUIRED),
            ),
            validate(smsConsent = true),
        )
        ConsentSource.entries.forEach {
            assertTrue(validate(smsConsent = true, smsConsentAt = createdAt, smsConsentSource = it).isEmpty())
        }
        assertTrue(validate(note = "", smsConsentAt = createdAt, smsConsentSource = ConsentSource.OTHER).isEmpty())
    }

    @Suppress("LongParameterList")
    private fun validate(
        name: String = "Ayşe",
        phone: String? = null,
        note: String? = null,
        tag: String? = null,
        smsConsent: Boolean = false,
        smsConsentAt: Instant? = null,
        smsConsentSource: ConsentSource? = null,
    ): List<FieldError> = CustomerValidator.validate(name, phone, note, tag, smsConsent, smsConsentAt, smsConsentSource)
}
