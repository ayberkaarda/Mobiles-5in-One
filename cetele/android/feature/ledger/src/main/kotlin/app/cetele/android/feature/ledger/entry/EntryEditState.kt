package app.cetele.android.feature.ledger.entry

import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.FieldError
import java.time.LocalDate

data class EntryEditState(
    val customerId: String,
    val type: EntryType,
    val occurredOn: LocalDate,
    val today: LocalDate = occurredOn,
    val amountMinor: Long = 0,
    val dueOn: LocalDate? = null,
    val note: String = "",
    val photo: CompressedPhoto? = null,
    val errors: List<FieldError> = emptyList(),
    val shopId: String? = null,
    val busy: Boolean = false,
    val photoBusy: Boolean = false,
    val photoFailed: Boolean = false,
    val writeFailed: Boolean = false,
    val savedId: String? = null,
)
