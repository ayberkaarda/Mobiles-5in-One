@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.sync

import app.cetele.android.core.network.dto.ChangeEntity
import app.cetele.android.core.network.dto.ChangeOp
import app.cetele.android.core.network.dto.ConsentSource
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.problem.ProblemFieldError
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.LocalDate

@Serializable
data class PushRequest(
    val operations: List<SyncOperation>,
)

@Serializable
data class SyncOperation(
    val clientId: String,
    val clientSeq: Long,
    val kind: SyncKind,
    val customer: CustomerInput? = null,
    val customerId: String? = null,
    val entry: EntryInput? = null,
)

@Serializable
data class CustomerInput(
    val id: String,
    val name: String,
    val phone: String? = null,
    val note: String? = null,
    val tag: String? = null,
    val smsConsent: Boolean,
    val smsConsentAt: Instant? = null,
    val smsConsentSource: ConsentSource? = null,
)

@Serializable
data class EntryInput(
    val id: String,
    val customerId: String,
    val type: EntryType,
    val amountMinor: Long,
    val occurredOn: LocalDate,
    val dueOn: LocalDate? = null,
    val note: String? = null,
    val photoKey: String? = null,
    val reverses: String? = null,
)

@Serializable
data class PushResponse(
    val results: List<OperationResult>,
    val head: Long,
)

@Serializable
data class OperationResult(
    val clientId: String,
    val status: OperationStatus,
    val entityId: String? = null,
    val code: String? = null,
    val errors: List<ProblemFieldError>? = null,
)

@Serializable
data class PullResponse(
    val changes: List<ChangeView>,
    val nextSince: Long,
    val hasMore: Boolean,
)

@Serializable
data class ChangeView(
    val seq: Long,
    val entity: ChangeEntity,
    val entityId: String,
    val op: ChangeOp,
    val at: Instant,
    val payload: JsonObject,
)
