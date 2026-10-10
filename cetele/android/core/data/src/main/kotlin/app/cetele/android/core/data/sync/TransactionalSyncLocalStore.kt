package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.SyncCursorEntity
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.ChangeEntity
import app.cetele.android.core.network.dto.ChangeOp
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.ChangeView
import app.cetele.android.core.network.dto.sync.CustomerSnapshot
import app.cetele.android.core.network.dto.sync.EntrySnapshot
import app.cetele.android.core.network.dto.sync.OperationResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.serialization.encodeToString
import java.time.Clock
import java.time.Instant

/** Shared transitions keep the persistent and in-memory implementations under one contract. */
@Suppress("TooManyFunctions")
abstract class TransactionalSyncLocalStore(
    private val clock: Clock,
) : SyncLocalStore {
    protected abstract suspend fun <T> transaction(block: suspend () -> T): T

    protected abstract suspend fun outbox(shopId: String): List<OutboxRow>

    protected abstract suspend fun putOutbox(row: OutboxRow)

    protected abstract suspend fun deleteOutbox(
        shopId: String,
        clientId: String,
    )

    protected abstract suspend fun getCustomer(
        shopId: String,
        id: String,
    ): CustomerEntity?

    protected abstract suspend fun putCustomer(row: CustomerEntity)

    protected abstract suspend fun deleteCustomer(
        shopId: String,
        id: String,
    )

    protected abstract suspend fun getEntry(
        shopId: String,
        id: String,
    ): LedgerEntryEntity?

    protected abstract suspend fun putEntry(row: LedgerEntryEntity)

    protected abstract suspend fun deleteEntry(
        shopId: String,
        id: String,
    )

    protected abstract suspend fun putCursor(row: SyncCursorEntity)

    protected abstract suspend fun deletePhoto(
        shopId: String,
        entryId: String,
    )

    protected abstract fun observeRows(shopId: String): Flow<List<OutboxRow>>

    protected abstract fun observeCursor(shopId: String): Flow<SyncCursorEntity>

    private val disconnected = MutableStateFlow<Map<String, Boolean>>(emptyMap())

    override suspend fun queuedOperations(
        shopId: String,
        limit: Int,
    ): List<OutboxRow> {
        require(limit in 1..BATCH_LIMIT)
        val all = outbox(shopId)
        val present = all.map { it.clientId }.toSet()
        return all
            .filter { row ->
                row.state == "QUEUED" && row.dependsOnClientId !in present &&
                    (row.photoEntryId == null || photo(shopId, row.photoEntryId)?.state == "READY")
            }.sortedWith(
                compareBy<OutboxRow>({ it.clientSeq == null }, { it.clientSeq }, { it.createdAt }, { it.clientId }),
            ).take(limit)
    }

    override suspend fun assignClientSeqs(
        shopId: String,
        clientIds: List<String>,
    ): Map<String, Long> =
        transaction {
            require(clientIds.distinct().size == clientIds.size)
            var next = cursor(shopId).nextClientSeq
            val rows = outbox(shopId).associateBy { it.clientId }
            val result =
                clientIds.associateWith { id ->
                    val row = requireNotNull(rows[id])
                    val seq = row.clientSeq ?: next.also { next = Math.addExact(next, 1) }
                    putOutbox(row.copy(clientSeq = seq, attempts = row.attempts + 1, updatedAt = now()))
                    seq
                }
            putCursor(cursor(shopId).copy(nextClientSeq = next))
            result
        }

    open override suspend fun applyResults(
        shopId: String,
        results: List<OperationResult>,
        head: Long,
    ) = transaction {
        require(head >= 0 && results.map { it.clientId }.distinct().size == results.size)
        for (result in results) {
            val row = outbox(shopId).firstOrNull { it.clientId == result.clientId } ?: continue
            if (result.status == OperationStatus.REJECTED) {
                undoRejected(shopId, row, result)
                putOutbox(
                    row.copy(
                        state = "REJECTED",
                        lastCode = result.code,
                        errorsJson = result.errors?.let { NetworkJson.encodeToString(it) },
                        updatedAt = now(),
                    ),
                )
            } else {
                deleteOutbox(shopId, row.clientId)
                acknowledgeEntity(shopId, row.entityId)
                getCustomer(shopId, row.entityId)?.let { customer ->
                    val pending = outbox(shopId).any { it.entityId == row.entityId && it.state == "QUEUED" }
                    putCustomer(customer.copy(syncState = if (pending) "PENDING" else "SYNCED"))
                }
                getEntry(shopId, row.entityId)?.let { putEntry(it.copy(syncState = "SYNCED")) }
            }
        }
        putCursor(cursor(shopId).copy(lastPushAt = now(), lastErrorCode = null))
    }

    private suspend fun acknowledgeEntity(
        shopId: String,
        id: String,
    ) {
        outbox(shopId).filter { it.entityId == id }.forEach { putOutbox(OutboxPayloads.acknowledge(it)) }
    }

    override suspend fun applyChanges(
        shopId: String,
        changes: List<ChangeView>,
        nextSince: Long,
    ) = transaction {
        val previous = cursor(shopId).lastPulledSeq
        require(nextSince >= previous)
        var seq = previous
        for (change in changes) {
            require(change.seq > seq && change.seq <= nextSince)
            seq = change.seq
            when (change.entity) {
                ChangeEntity.CUSTOMER -> {
                    val snapshot = NetworkJson.decodeFromJsonElement(CustomerSnapshot.serializer(), change.payload)
                    require(snapshot.id == change.entityId)
                    require(change.op != ChangeOp.DELETE || snapshot.deletedAt != null)
                    val pending = outbox(shopId).any { it.entityId == snapshot.id && it.state == "QUEUED" }
                    putCustomer(snapshot.asEntity(shopId, pending))
                    acknowledgeEntity(shopId, snapshot.id)
                }

                ChangeEntity.ENTRY -> {
                    if (change.op == ChangeOp.DELETE) {
                        deleteEntry(shopId, change.entityId)
                    } else {
                        val snapshot = NetworkJson.decodeFromJsonElement(EntrySnapshot.serializer(), change.payload)
                        require(snapshot.id == change.entityId)
                        putEntry(
                            snapshot.asEntity(shopId).copy(
                                reversedBy =
                                    snapshot.reversedBy ?: pendingReversal(shopId, snapshot.id),
                            ),
                        )
                    }
                }
            }
        }
        putCursor(cursor(shopId).copy(lastPulledSeq = nextSince, lastPullAt = now(), lastErrorCode = null))
    }

    /** A local reversal that the server has not seen yet must keep the original struck through. */
    private suspend fun pendingReversal(
        shopId: String,
        entryId: String,
    ): String? = getEntry(shopId, entryId)?.reversedBy?.takeIf { id -> getEntry(shopId, id)?.syncState == "PENDING" }

    /** A customer created by this upsert that the server never acknowledged exists only locally. */
    private fun neverAccepted(
        customer: CustomerEntity,
        row: OutboxRow,
    ): Boolean =
        customer.syncState != "SYNCED" && customer.createdAt == row.createdAt && !OutboxPayloads.acknowledged(row)

    override suspend fun undoRejected(
        shopId: String,
        row: OutboxRow,
        result: OperationResult,
    ) {
        require(row.shopId == shopId && row.clientId == result.clientId)
        when (SyncKind.valueOf(row.kind)) {
            SyncKind.ENTRY_CREATE -> {
                val entry = getEntry(shopId, row.entityId)
                entry?.reverses?.let { id ->
                    getEntry(shopId, id)?.takeIf { it.reversedBy == row.entityId }?.let {
                        putEntry(it.copy(reversedBy = null))
                    }
                }
                deleteEntry(shopId, row.entityId)
                deletePhoto(shopId, row.entityId)
            }

            SyncKind.CUSTOMER_UPSERT -> {
                val customer = getCustomer(shopId, row.entityId)
                if (customer != null && neverAccepted(customer, row)) {
                    deleteCustomer(shopId, row.entityId)
                } else {
                    putCursor(cursor(shopId).copy(lastPulledSeq = 0))
                }
            }

            SyncKind.CUSTOMER_DELETE -> {
                putCursor(cursor(shopId).copy(lastPulledSeq = 0))
            }
        }
    }

    override suspend fun blockBatch(
        shopId: String,
        clientIds: List<String>,
        code: String,
    ) = transaction {
        outbox(shopId).filter { it.clientId in clientIds }.forEach {
            putOutbox(it.copy(state = "BLOCKED", lastCode = code, updatedAt = now()))
        }
        putCursor(cursor(shopId).copy(lastErrorCode = code))
    }

    override suspend fun pendingPhotos(shopId: String): List<PendingPhotoEntity> =
        allPhotos(shopId).filter { it.state == "QUEUED" || it.state == "UPLOADED" }

    protected abstract suspend fun allPhotos(shopId: String): List<PendingPhotoEntity>

    override suspend fun unblockEntry(
        shopId: String,
        entryId: String,
    ) = transaction {
        val ready = requireNotNull(photo(shopId, entryId))
        require(ready.state == "READY")
        getEntry(shopId, entryId)?.let { putEntry(it.copy(photoKey = ready.photoKey)) }
        outbox(shopId)
            .filter { it.photoEntryId == entryId && it.state == "BLOCKED" && it.lastCode == null }
            .forEach { putOutbox(it.copy(state = "QUEUED", updatedAt = now())) }
    }

    open override suspend fun removePhoto(
        shopId: String,
        entryId: String,
    ) = transaction {
        deletePhoto(shopId, entryId)
        getEntry(shopId, entryId)?.let { putEntry(it.copy(photoKey = null)) }
        outbox(shopId)
            .filter { it.photoEntryId == entryId && it.state == "BLOCKED" && it.lastCode == null }
            .forEach { row ->
                val input =
                    NetworkJson.decodeFromString<app.cetele.android.core.network.dto.sync.EntryInput>(
                        row.payloadJson,
                    )
                putOutbox(
                    row.copy(
                        photoEntryId = null,
                        state = "QUEUED",
                        payloadJson = NetworkJson.encodeToString(input.copy(photoKey = null)),
                        updatedAt = now(),
                    ),
                )
            }
    }

    override suspend fun dismissIssue(
        shopId: String,
        clientId: String,
    ) = transaction {
        if (outbox(shopId).any { it.clientId == clientId && it.state == "REJECTED" }) deleteOutbox(shopId, clientId)
    }

    override suspend fun recordError(
        shopId: String,
        code: String?,
        offline: Boolean,
    ) {
        transaction { putCursor(cursor(shopId).copy(lastErrorCode = code)) }
        disconnected.value = disconnected.value + (shopId to offline)
    }

    override fun status(shopId: String): Flow<SyncStatus> =
        combine(
            observeRows(shopId),
            observeCursor(shopId),
            disconnected,
        ) { rows, cursor, offline ->
            SyncStatus(
                rows.count { it.state != "REJECTED" },
                rows.count { it.state == "BLOCKED" },
                rows.count { it.state == "REJECTED" },
                cursor.lastPushAt?.let(Instant::parse),
                cursor.lastPullAt?.let(Instant::parse),
                cursor.lastErrorCode,
                offline[shopId] == true,
            )
        }

    protected fun now(): String = clock.instant().toString()

    companion object {
        const val BATCH_LIMIT = 500
    }
}
