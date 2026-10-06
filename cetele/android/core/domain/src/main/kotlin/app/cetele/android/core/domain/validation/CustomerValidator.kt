package app.cetele.android.core.domain.validation

import app.cetele.android.core.domain.model.ConsentSource
import java.time.Instant

object CustomerValidator {
    @Suppress("LongParameterList")
    fun validate(
        name: String,
        phone: String?,
        note: String?,
        tag: String?,
        smsConsent: Boolean,
        smsConsentAt: Instant?,
        smsConsentSource: ConsentSource?,
    ): List<FieldError> =
        buildList {
            val trimmed = name.trim()
            if (trimmed.isEmpty()) add(FieldError("customer.name", FieldCodes.REQUIRED))
            if (trimmed.length > Limits.NAME_MAX) add(FieldError("customer.name", FieldCodes.TOO_LONG))
            if (phone != null && !PhoneValidator.isValid(phone)) {
                add(FieldError("customer.phone", FieldCodes.INVALID_FORMAT))
            }
            if (note != null && note.length > Limits.NOTE_MAX) add(FieldError("customer.note", FieldCodes.TOO_LONG))
            if (tag != null) {
                if (tag.isEmpty()) add(FieldError("customer.tag", FieldCodes.REQUIRED))
                if (tag.length > Limits.TAG_MAX) add(FieldError("customer.tag", FieldCodes.TOO_LONG))
            }
            if (smsConsent && smsConsentAt == null) add(FieldError("customer.smsConsentAt", FieldCodes.REQUIRED))
            if (smsConsent && smsConsentSource == null) {
                add(FieldError("customer.smsConsentSource", FieldCodes.REQUIRED))
            }
        }.sortedWith(compareBy({ it.field }, { it.code }))
}
