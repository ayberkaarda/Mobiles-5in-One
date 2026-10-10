package app.cetele.android.feature.customers.edit

import app.cetele.android.core.data.write.CustomerDraft
import app.cetele.android.core.designsystem.copy.FieldErrorText
import app.cetele.android.core.domain.format.PhoneFormat
import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.FieldError
import java.time.Instant
import java.time.LocalDate

data class CustomerEditState(
    val name: String = "",
    val phone: String = "",
    val note: String = "",
    val tag: String = "",
    val smsConsent: Boolean = false,
    val consentDate: LocalDate? = null,
    val consentSource: ConsentSource? = null,
    val originalConsentAt: Instant? = null,
    val errors: List<FieldError> = emptyList(),
    val loading: Boolean = true,
    val saving: Boolean = false,
    val available: Boolean = false,
    val savedId: String? = null,
    val problemCode: String? = null,
) {
    fun draft(id: String?): CustomerDraft =
        CustomerDraft(
            id = id,
            name = name.trim(),
            phone = phone.takeIf { it.isNotBlank() }?.let { PhoneFormat.toE164Tr(it) ?: it.trim() },
            note = note.takeIf { it.isNotEmpty() },
            tag = tag.trim().takeIf { it.isNotEmpty() },
            smsConsent = smsConsent,
            smsConsentAt =
                if (smsConsent) {
                    originalConsentAt ?: consentDate?.atStartOfDay(CeteleClock.ZONE)?.toInstant()
                } else {
                    null
                },
            smsConsentSource = consentSource.takeIf { smsConsent },
        )

    fun validationErrors(id: String?): List<FieldError> {
        val draft = draft(id)
        return CustomerValidator.validate(
            draft.name,
            draft.phone,
            draft.note,
            draft.tag,
            draft.smsConsent,
            draft.smsConsentAt,
            draft.smsConsentSource,
        )
    }

    fun errorResource(field: String): Int? = errors.firstOrNull { it.field == field }?.let(FieldErrorText::resId)
}
