package app.cetele.android.core.data.write

import app.cetele.android.core.domain.model.ConsentSource
import app.cetele.android.core.domain.model.EntryType
import app.cetele.android.core.domain.validation.FieldError
import java.time.Instant
import java.time.LocalDate

data class CustomerDraft(
    val id: String? = null,
    val name: String,
    val phone: String? = null,
    val note: String? = null,
    val tag: String? = null,
    val smsConsent: Boolean = false,
    val smsConsentAt: Instant? = null,
    val smsConsentSource: ConsentSource? = null,
)

data class EntryDraft(
    val customerId: String,
    val type: EntryType,
    val amountMinor: Long,
    val occurredOn: LocalDate,
    val dueOn: LocalDate? = null,
    val note: String? = null,
    val photoKey: String? = null,
)

sealed interface WriteResult {
    data class Ok(
        val id: String,
    ) : WriteResult

    data class Invalid(
        val errors: List<FieldError>,
    ) : WriteResult
}
