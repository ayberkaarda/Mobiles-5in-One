package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.SyncCursorEntity
import app.cetele.android.core.data.database.entity.OutboxEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.network.dto.sync.ChangeView
import app.cetele.android.core.network.dto.sync.OperationResult
import kotlinx.coroutines.flow.Flow
import java.time.Instant

typealias OutboxRow = OutboxEntity

@Suppress("TooManyFunctions")
interface SyncLocalStore {
    suspend fun queuedOperations(
        shopId: String,
        limit: Int,
    ): List<OutboxRow>

    suspend fun assignClientSeqs(
        shopId: String,
        clientIds: List<String>,
    ): Map<String, Long>

    suspend fun applyResults(
        shopId: String,
        results: List<OperationResult>,
        head: Long,
    )

    suspend fun cursor(shopId: String): SyncCursorEntity

    suspend fun applyChanges(
        shopId: String,
        changes: List<ChangeView>,
        nextSince: Long,
    )

    suspend fun undoRejected(
        shopId: String,
        row: OutboxRow,
        result: OperationResult,
    )

    suspend fun blockBatch(
        shopId: String,
        clientIds: List<String>,
        code: String,
    )

    suspend fun pendingPhotos(shopId: String): List<PendingPhotoEntity>

    suspend fun photo(
        shopId: String,
        entryId: String,
    ): PendingPhotoEntity?

    suspend fun markPhoto(row: PendingPhotoEntity)

    suspend fun unblockEntry(
        shopId: String,
        entryId: String,
    )

    suspend fun removePhoto(
        shopId: String,
        entryId: String,
    )

    suspend fun dismissIssue(
        shopId: String,
        clientId: String,
    )

    suspend fun recordError(
        shopId: String,
        code: String?,
        offline: Boolean,
    )

    suspend fun shopsWithPending(): List<String>

    fun status(shopId: String): Flow<SyncStatus>

    /** Every outbox row of the shop, re-emitted after each committed change. */
    fun observeOutbox(shopId: String): Flow<List<OutboxRow>>

    /** Every photo upload row of the shop, re-emitted after each committed change. */
    fun observePhotos(shopId: String): Flow<List<PendingPhotoEntity>>

    /**
     * Releases the entry operation held back by a failed (or missing) photo upload: the operation is
     * queued without a photo key, the entry loses its photo and the upload row is dropped, all in one
     * transaction. Returns false and changes nothing when no operation is held by that photo or the
     * upload is still in progress or already finished.
     */
    suspend fun detachPhoto(
        shopId: String,
        entryId: String,
    ): Boolean
}

data class SyncStatus(
    val pendingCount: Int = 0,
    val blockedCount: Int = 0,
    val rejectedCount: Int = 0,
    val lastPushAt: Instant? = null,
    val lastPullAt: Instant? = null,
    val lastErrorCode: String? = null,
    val offline: Boolean = false,
)
