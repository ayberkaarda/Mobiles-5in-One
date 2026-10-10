package app.cetele.android.core.data.sync.fake

import app.cetele.android.core.data.sync.SyncFixtures
import app.cetele.android.core.domain.time.CeteleClock
import app.cetele.android.core.domain.validation.CustomerValidator
import app.cetele.android.core.domain.validation.EntryValidator
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.SyncApi
import app.cetele.android.core.network.dto.ChangeEntity
import app.cetele.android.core.network.dto.ChangeOp
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.problem.ProblemFieldError
import app.cetele.android.core.network.dto.sync.ChangeView
import app.cetele.android.core.network.dto.sync.CustomerSnapshot
import app.cetele.android.core.network.dto.sync.EntrySnapshot
import app.cetele.android.core.network.dto.sync.OperationResult
import app.cetele.android.core.network.dto.sync.PullResponse
import app.cetele.android.core.network.dto.sync.PushRequest
import app.cetele.android.core.network.dto.sync.PushResponse
import app.cetele.android.core.network.dto.sync.SyncOperation
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import java.time.Clock

@Suppress("TooManyFunctions")
class FakeSyncServer(
    private val clock: Clock = SyncFixtures.clock,
    var customerLimit: Int = 100,
) {
    val media = FakeMediaApi(clock)

    enum class Role { OWNER, STAFF }

    data class PushCall(
        val deviceId: String,
        val shopId: String,
        val body: PushRequest,
    )

    data class PullCall(
        val deviceId: String,
        val shopId: String,
        val since: Long,
        val limit: Int,
    )

    val pushes = mutableListOf<PushCall>()
    val pulls = mutableListOf<PullCall>()
    val customers = linkedMapOf<Pair<String, String>, CustomerSnapshot>()
    val entries = linkedMapOf<Pair<String, String>, EntrySnapshot>()
    private val receipts = mutableMapOf<Pair<String, String>, String>()
    private val logs = mutableMapOf<String, MutableList<ChangeView>>()
    private val mutex = Mutex()
    private var after: Int? = null
    private var retryAfter: Int? = null
    private var unauthorized = false
    private var tick = 0L

    fun failNextPushWith(
        status: Int = 500,
        afterApplying: Int = 1,
    ) {
        require(status == 500)
        after = afterApplying
    }

    fun rateLimit(retryAfter: Int) {
        this.retryAfter = retryAfter
    }

    fun unauthorizedOnce() {
        unauthorized = true
    }

    fun client(
        deviceId: String,
        role: Role = Role.OWNER,
    ): SyncApi =
        object : SyncApi {
            override suspend fun push(
                shopId: String,
                body: PushRequest,
            ): ApiResult<PushResponse> =
                mutex.withLock {
                    pushes += PushCall(deviceId, shopId, body)
                    fault()?.let { return@withLock it }
                    val operations = body.operations
                    if (malformed(operations)) return@withLock problem(422, VALIDATION_FAILED)
                    val results = mutableListOf<OperationResult>()
                    val stopAfter = after.also { after = null }
                    if (stopAfter == 0) return@withLock ApiResult.Failure.Unexpected(500)
                    for ((index, operation) in operations.withIndex()) {
                        val receipt = receipts[shopId to operation.clientId]
                        val result =
                            if (receipt !=
                                null
                            ) {
                                OperationResult(operation.clientId, OperationStatus.DUPLICATE, receipt)
                            } else {
                                apply(shopId, operation, role, deviceId)
                            }
                        results += result
                        if (result.status ==
                            OperationStatus.APPLIED
                        ) {
                            receipts[shopId to operation.clientId] = requireNotNull(result.entityId)
                        }
                        if (stopAfter == index + 1) return@withLock ApiResult.Failure.Unexpected(500)
                    }
                    ApiResult.Success(PushResponse(results, head(shopId)), 200)
                }

            override suspend fun pull(
                shopId: String,
                since: Long,
                limit: Int,
            ): ApiResult<PullResponse> =
                mutex.withLock {
                    pulls += PullCall(deviceId, shopId, since, limit)
                    fault()?.let { return@withLock it }
                    require(limit in 1..500)
                    val remaining = logs[shopId].orEmpty().filter { it.seq > since }
                    val changes = remaining.take(limit)
                    ApiResult.Success(
                        PullResponse(changes, changes.lastOrNull()?.seq ?: since, remaining.size > changes.size),
                        200,
                    )
                }
        }

    private fun fault(): ApiResult.Failure? {
        if (unauthorized) {
            unauthorized = false
            return problem(401, "auth.refresh_invalid")
        }
        return retryAfter?.let { seconds ->
            retryAfter = null
            problem(429, "rate_limited", seconds)
        }
    }

    private fun malformed(operations: List<SyncOperation>): Boolean =
        when {
            operations.size > 500 -> true
            operations.any { it.clientSeq < 1 } -> true
            operations.zipWithNext().any { (a, b) -> a.clientSeq >= b.clientSeq } -> true
            operations.map { it.clientId }.distinct().size != operations.size -> true
            else -> operations.any { !hasBody(it) }
        }

    private fun hasBody(op: SyncOperation): Boolean =
        when (op.kind) {
            SyncKind.CUSTOMER_UPSERT -> op.customer != null
            SyncKind.CUSTOMER_DELETE -> op.customerId != null
            SyncKind.ENTRY_CREATE -> op.entry != null
        }

    private fun apply(
        shopId: String,
        op: SyncOperation,
        role: Role,
        deviceId: String,
    ): OperationResult =
        when (op.kind) {
            SyncKind.CUSTOMER_UPSERT -> upsert(shopId, op)
            SyncKind.CUSTOMER_DELETE -> delete(shopId, op, role)
            SyncKind.ENTRY_CREATE -> create(shopId, op, deviceId)
        }

    private fun upsert(
        shopId: String,
        op: SyncOperation,
    ): OperationResult {
        val old = customers[shopId to requireNotNull(op.customer).id]
        return customerRejection(shopId, op, old) ?: storeCustomer(shopId, op, old)
    }

    private fun customerRejection(
        shopId: String,
        op: SyncOperation,
        old: CustomerSnapshot?,
    ): OperationResult? {
        val input = requireNotNull(op.customer)
        val errors =
            CustomerValidator.validate(
                input.name,
                input.phone,
                input.note,
                input.tag,
                input.smsConsent,
                input.smsConsentAt,
                input.smsConsentSource?.let {
                    app.cetele.android.core.domain.model.ConsentSource
                        .valueOf(it.name)
                },
            )
        val live = customers.filterKeys { it.first == shopId }.values.count { it.deletedAt == null }
        return when {
            old?.deletedAt != null -> reject(op, CUSTOMER_DELETED)
            errors.isNotEmpty() -> reject(op, VALIDATION_FAILED, errors.map { ProblemFieldError(it.field, it.code) })
            old == null && live >= customerLimit -> reject(op, "plan.customer_limit")
            else -> null
        }
    }

    private fun storeCustomer(
        shopId: String,
        op: SyncOperation,
        old: CustomerSnapshot?,
    ): OperationResult {
        val input = requireNotNull(op.customer)
        val now = clock.instant().plusNanos(++tick)
        val row =
            CustomerSnapshot(
                input.id,
                input.name,
                input.phone,
                input.note,
                input.tag,
                input.smsConsent,
                input.smsConsentAt,
                input.smsConsentSource,
                old?.createdAt ?: now,
                now,
            )
        customers[shopId to input.id] = row
        change(
            shopId,
            ChangeEntity.CUSTOMER,
            row.id,
            ChangeOp.UPSERT,
            NetworkJson.encodeToJsonElement(CustomerSnapshot.serializer(), row) as JsonObject,
        )
        return applied(op, row.id)
    }

    private fun delete(
        shopId: String,
        op: SyncOperation,
        role: Role,
    ): OperationResult {
        val id = requireNotNull(op.customerId)
        val old = customers[shopId to id]
        val rejection =
            when {
                role == Role.STAFF -> reject(op, "forbidden")
                old == null -> reject(op, NOT_FOUND)
                old.deletedAt != null -> reject(op, CUSTOMER_DELETED)
                else -> null
            }
        return rejection ?: markDeleted(shopId, op, requireNotNull(old))
    }

    private fun markDeleted(
        shopId: String,
        op: SyncOperation,
        old: CustomerSnapshot,
    ): OperationResult {
        val now = clock.instant().plusNanos(++tick)
        val row = old.copy(updatedAt = now, deletedAt = now)
        customers[shopId to old.id] = row
        change(
            shopId,
            ChangeEntity.CUSTOMER,
            old.id,
            ChangeOp.DELETE,
            NetworkJson.encodeToJsonElement(CustomerSnapshot.serializer(), row) as JsonObject,
        )
        return applied(op, old.id)
    }

    private fun create(
        shopId: String,
        op: SyncOperation,
        deviceId: String,
    ): OperationResult {
        val original = requireNotNull(op.entry).reverses?.let { entries[shopId to it] }
        return entryRejection(shopId, op, original) ?: storeEntry(shopId, op, deviceId, original)
    }

    private fun entryRejection(
        shopId: String,
        op: SyncOperation,
        original: EntrySnapshot?,
    ): OperationResult? {
        val input = requireNotNull(op.entry)
        val customer = customers[shopId to input.customerId]
        val errors =
            EntryValidator.validate(
                app.cetele.android.core.domain.model.EntryType
                    .valueOf(input.type.name),
                input.amountMinor,
                input.occurredOn,
                input.dueOn,
                input.note,
                input.photoKey,
                input.reverses,
                CeteleClock.today(clock),
            )
        return when {
            customer == null -> reject(op, NOT_FOUND)
            customer.deletedAt != null -> reject(op, CUSTOMER_DELETED)
            entries.containsKey(shopId to input.id) -> reject(op, "conflict")
            errors.isNotEmpty() -> reject(op, VALIDATION_FAILED, errors.map { ProblemFieldError(it.field, it.code) })
            input.photoKey?.startsWith("media/$shopId/") == false -> reject(op, VALIDATION_FAILED)
            input.reverses != null -> reversalRejection(op, original)
            else -> null
        }
    }

    private fun reversalRejection(
        op: SyncOperation,
        original: EntrySnapshot?,
    ): OperationResult? {
        val input = requireNotNull(op.entry)
        return when {
            original == null -> {
                reject(op, NOT_FOUND)
            }

            original.reversedBy != null || original.reverses != null -> {
                reject(op, "ledger.already_reversed")
            }

            original.customerId != input.customerId || original.type != input.type ||
                original.amountMinor != input.amountMinor -> {
                reject(op, "ledger.reversal_mismatch")
            }

            else -> {
                null
            }
        }
    }

    private fun storeEntry(
        shopId: String,
        op: SyncOperation,
        deviceId: String,
        original: EntrySnapshot?,
    ): OperationResult {
        val input = requireNotNull(op.entry)
        val now = clock.instant().plusNanos(++tick)
        val row =
            EntrySnapshot(
                input.id,
                input.customerId,
                input.type,
                input.amountMinor,
                "TRY",
                input.occurredOn,
                input.dueOn,
                input.note,
                input.photoKey,
                input.reverses,
                createdBy = deviceId,
                createdAt = now,
            )
        entries[shopId to row.id] = row
        change(
            shopId,
            ChangeEntity.ENTRY,
            row.id,
            ChangeOp.UPSERT,
            NetworkJson.encodeToJsonElement(EntrySnapshot.serializer(), row) as JsonObject,
        )
        if (original != null) {
            val reversed = original.copy(reversedBy = row.id)
            entries[shopId to original.id] = reversed
            change(
                shopId,
                ChangeEntity.ENTRY,
                original.id,
                ChangeOp.UPSERT,
                NetworkJson.encodeToJsonElement(EntrySnapshot.serializer(), reversed) as JsonObject,
            )
        }
        return applied(op, row.id)
    }

    fun head(shopId: String): Long = logs[shopId]?.lastOrNull()?.seq ?: 0

    private fun change(
        shopId: String,
        entity: ChangeEntity,
        id: String,
        op: ChangeOp,
        payload: JsonObject,
    ) {
        val seq = head(shopId) + 1
        logs.getOrPut(shopId) { mutableListOf() } +=
            ChangeView(seq, entity, id, op, clock.instant().plusNanos(tick), payload)
    }

    private fun applied(
        op: SyncOperation,
        id: String,
    ): OperationResult = OperationResult(op.clientId, OperationStatus.APPLIED, id)

    private fun reject(
        op: SyncOperation,
        code: String,
        errors: List<ProblemFieldError>? = null,
    ): OperationResult = OperationResult(op.clientId, OperationStatus.REJECTED, code = code, errors = errors)

    private fun problem(
        status: Int,
        code: String,
        seconds: Int? = null,
    ): ApiResult.Failure.Problem =
        ApiResult.Failure.Problem(ProblemDetail(title = "Request refused", status = status, code = code), seconds)

    private companion object {
        const val VALIDATION_FAILED = "validation.failed"
        const val CUSTOMER_DELETED = "customer.deleted"
        const val NOT_FOUND = "not_found"
    }
}
