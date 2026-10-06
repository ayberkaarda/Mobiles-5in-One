package app.cetele.server.sync

import app.cetele.server.web.validation.E164Tr
import app.cetele.server.web.validation.Kurus
import jakarta.validation.constraints.Size
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

enum class OperationKind { CUSTOMER_UPSERT, CUSTOMER_DELETE, ENTRY_CREATE }

data class PushRequest(
    val operations: List<SyncOperation>,
)

data class SyncOperation(
    val clientId: UUID,
    val clientSeq: Long,
    val kind: OperationKind,
    val customer: CustomerInput? = null,
    val customerId: UUID? = null,
    val entry: EntryInput? = null,
)

data class CustomerInput(
    val id: UUID,
    @field:Size(min = 1, max = 80, message = "too_long")
    val name: String,
    @field:E164Tr
    val phone: String? = null,
    @field:Size(max = 500, message = "too_long")
    val note: String? = null,
    @field:Size(min = 1, max = 30, message = "too_long")
    val tag: String? = null,
    val smsConsent: Boolean,
    val smsConsentAt: Instant? = null,
    val smsConsentSource: String? = null,
)

data class EntryInput(
    val id: UUID,
    val customerId: UUID,
    val type: String,
    @field:Kurus
    val amountMinor: Long,
    val occurredOn: LocalDate,
    val dueOn: LocalDate? = null,
    @field:Size(max = 500, message = "too_long")
    val note: String? = null,
    val photoKey: String? = null,
    val reverses: UUID? = null,
)
