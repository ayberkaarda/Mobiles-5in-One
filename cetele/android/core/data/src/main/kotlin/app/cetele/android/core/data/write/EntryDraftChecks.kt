package app.cetele.android.core.data.write

import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.domain.validation.EntryValidator
import app.cetele.android.core.domain.validation.FieldError
import app.cetele.android.core.domain.validation.Limits
import java.time.LocalDate

/** Checks a new entry before [LocalWriteService] opens its transaction. */
internal object EntryDraftChecks {
    fun errors(
        shopId: String,
        draft: EntryDraft,
        today: LocalDate,
    ): List<FieldError> {
        val errors =
            EntryValidator.validate(
                draft.type,
                draft.amountMinor,
                draft.occurredOn,
                draft.dueOn,
                draft.note,
                draft.photoKey,
                null,
                today,
            )
        val foreignPhoto = draft.photoKey != null && !draft.photoKey.startsWith("media/$shopId/")
        return if (foreignPhoto) errors + FieldError("entry.photoKey", "invalid_format") else errors
    }

    fun photoErrors(photo: CompressedPhoto?): List<FieldError> {
        if (photo == null) return emptyList()
        val validSize = photo.bytes.size in 1..Limits.PHOTO_MAX_BYTES
        val validSides = photo.width in 1..Limits.PHOTO_MAX_SIDE && photo.height in 1..Limits.PHOTO_MAX_SIDE
        return if (validSize && validSides) emptyList() else listOf(FieldError("entry.photoKey", "out_of_range"))
    }
}
