package app.cetele.android.core.domain.validation

import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.domain.model.Money
import java.time.LocalDate

data class ReversalDraft(
    val customerId: String,
    val type: EntryType,
    val amount: Money,
    val occurredOn: LocalDate,
    val reverses: String,
    val dueOn: LocalDate? = null,
    val note: String? = null,
    val photoKey: String? = null,
)

object EntryValidator {
    @Suppress("LongParameterList")
    fun validate(
        type: EntryType,
        amountMinor: Long,
        occurredOn: LocalDate,
        dueOn: LocalDate?,
        note: String?,
        photoKey: String?,
        reverses: String?,
        today: LocalDate,
    ): List<FieldError> =
        buildList {
            if (amountMinor !in Limits.AMOUNT_MIN..Limits.AMOUNT_MAX) {
                add(FieldError("entry.amountMinor", FieldCodes.OUT_OF_RANGE))
            }
            if (occurredOn > today.plusDays(1)) add(FieldError("entry.occurredOn", FieldCodes.OUT_OF_RANGE))
            if (dueOn != null && (type != EntryType.DEBT || reverses != null)) {
                add(FieldError("entry.dueOn", FieldCodes.INVALID_FORMAT))
            }
            if (note != null && note.length > Limits.NOTE_MAX) add(FieldError("entry.note", FieldCodes.TOO_LONG))
            if (photoKey != null && reverses != null) add(FieldError("entry.photoKey", FieldCodes.INVALID_FORMAT))
        }.sortedWith(compareBy({ it.field }, { it.code }))

    fun canReverse(original: LedgerEntry): Boolean = original.countsTowardBalance

    fun reversalOf(
        original: LedgerEntry,
        today: LocalDate,
    ): ReversalDraft {
        require(canReverse(original)) { "Entry cannot be reversed" }
        return ReversalDraft(original.customerId, original.type, original.amount, today, original.id)
    }
}
