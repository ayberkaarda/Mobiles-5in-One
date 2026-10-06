package app.cetele.server.sync

import app.cetele.server.ledger.customer.Customer
import app.cetele.server.ledger.entry.LedgerEntry
import app.cetele.server.web.problem.ProblemFieldError
import com.fasterxml.jackson.annotation.JsonInclude
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class CustomerView(
    val id: UUID,
    val name: String,
    val phone: String?,
    val note: String?,
    val tag: String?,
    val smsConsent: Boolean,
    val smsConsentAt: Instant?,
    val smsConsentSource: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val deletedAt: Instant?,
) {
    companion object {
        fun of(c: Customer) =
            CustomerView(
                c.id,
                c.name,
                c.phoneE164,
                c.note,
                c.tag,
                c.smsConsent,
                c.smsConsentAt,
                c.smsConsentSource,
                c.createdAt,
                c.updatedAt,
                c.deletedAt,
            )
    }
}

data class EntryView(
    val id: UUID,
    val customerId: UUID,
    val type: String,
    val amountMinor: Long,
    val currency: String,
    val occurredOn: LocalDate,
    val dueOn: LocalDate?,
    val note: String?,
    val photoKey: String?,
    val reverses: UUID?,
    val reversedBy: UUID?,
    val createdBy: UUID?,
    val createdAt: Instant,
) {
    companion object {
        fun of(e: LedgerEntry) =
            EntryView(
                e.id,
                e.customerId,
                e.type,
                e.amountMinor,
                e.currency,
                e.occurredOn,
                e.dueOn,
                e.note,
                e.photoKey,
                e.reverses,
                e.reversedBy,
                e.createdBy,
                e.createdAt,
            )
    }
}

enum class OperationStatus { APPLIED, DUPLICATE, REJECTED }

@JsonInclude(JsonInclude.Include.NON_NULL)
data class OperationResult(
    val clientId: UUID,
    val status: OperationStatus,
    val entityId: UUID? = null,
    val code: String? = null,
    val errors: List<ProblemFieldError>? = null,
)

data class PushResponse(
    val results: List<OperationResult>,
    val head: Long,
)

data class ChangeView(
    val seq: Long,
    val entity: String,
    val entityId: UUID,
    val op: String,
    val at: Instant,
    val payload: Any,
)

data class PullResponse(
    val changes: List<ChangeView>,
    val nextSince: Long,
    val hasMore: Boolean,
)
