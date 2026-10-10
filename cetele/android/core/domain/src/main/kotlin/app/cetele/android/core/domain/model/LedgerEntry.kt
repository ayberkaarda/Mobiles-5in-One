package app.cetele.android.core.domain.model

import java.time.Instant
import java.time.LocalDate

data class LedgerEntry(
    val id: String,
    val shopId: String,
    val customerId: String,
    val type: EntryType,
    val amount: Money,
    val occurredOn: LocalDate,
    val dueOn: LocalDate?,
    val note: String?,
    val photoKey: String?,
    val reverses: String?,
    val reversedBy: String?,
    val createdBy: String?,
    val createdAt: Instant,
) {
    val isReversed: Boolean get() = reversedBy != null
    val isReversal: Boolean get() = reverses != null
    val countsTowardBalance: Boolean get() = reverses == null && reversedBy == null
}
