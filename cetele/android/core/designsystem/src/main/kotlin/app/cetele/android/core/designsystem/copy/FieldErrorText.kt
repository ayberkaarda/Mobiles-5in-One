package app.cetele.android.core.designsystem.copy

import androidx.annotation.StringRes
import app.cetele.android.core.designsystem.R
import app.cetele.android.core.domain.validation.FieldCodes
import app.cetele.android.core.domain.validation.FieldError

object FieldErrorText {
    private val resources =
        mapOf(
            ("customer.name" to FieldCodes.REQUIRED) to R.string.error_field_name_required,
            ("customer.name" to FieldCodes.TOO_LONG) to R.string.error_field_name_too_long,
            ("customer.phone" to FieldCodes.INVALID_FORMAT) to R.string.error_field_phone_invalid,
            ("customer.note" to FieldCodes.TOO_LONG) to R.string.error_field_note_too_long,
            ("customer.tag" to FieldCodes.REQUIRED) to R.string.error_field_tag_required,
            ("customer.tag" to FieldCodes.TOO_LONG) to R.string.error_field_tag_too_long,
            ("customer.smsConsentAt" to FieldCodes.REQUIRED) to R.string.error_field_consent_date_required,
            ("customer.smsConsentSource" to FieldCodes.REQUIRED) to R.string.error_field_consent_source_required,
            ("entry.amountMinor" to FieldCodes.OUT_OF_RANGE) to R.string.error_field_amount_out_of_range,
            ("entry.occurredOn" to FieldCodes.OUT_OF_RANGE) to R.string.error_field_date_out_of_range,
            ("entry.dueOn" to FieldCodes.INVALID_FORMAT) to R.string.error_field_due_invalid,
            ("entry.note" to FieldCodes.TOO_LONG) to R.string.error_field_note_too_long,
            ("entry.photoKey" to FieldCodes.INVALID_FORMAT) to R.string.error_field_photo_invalid,
            ("phone" to FieldCodes.REQUIRED) to R.string.error_field_phone_required,
            ("phone" to FieldCodes.INVALID_FORMAT) to R.string.error_field_phone_invalid,
            ("name" to FieldCodes.REQUIRED) to R.string.error_field_name_required,
            ("name" to FieldCodes.TOO_LONG) to R.string.error_field_name_too_long,
            ("displayName" to FieldCodes.TOO_LONG) to R.string.error_field_name_too_long,
        )

    @StringRes
    fun resId(
        field: String,
        code: String,
    ): Int = resources[field to code] ?: generic(code)

    @StringRes
    fun resId(error: FieldError): Int = resId(error.field, error.code)

    @StringRes
    private fun generic(code: String): Int =
        when (code) {
            FieldCodes.REQUIRED -> R.string.error_field_required
            FieldCodes.INVALID_FORMAT -> R.string.error_field_invalid_format
            FieldCodes.TOO_LONG -> R.string.error_field_too_long
            FieldCodes.OUT_OF_RANGE -> R.string.error_field_out_of_range
            else -> R.string.error_validation_failed
        }
}
