package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.sync.OutboxRow
import app.cetele.android.core.data.sync.SyncLocalStore
import app.cetele.android.core.data.sync.SyncStatus
import app.cetele.android.core.data.write.LocalWriteEvents
import app.cetele.android.core.network.dto.SyncKind
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/** Upload progress of the photo attached to a locally created entry. */
sealed interface PhotoUploadState {
    /** No upload is tracked on this device (no photo, or the entry came from the server). */
    data object Absent : PhotoUploadState

    /** Waiting for the network, uploading or waiting for the server to verify it. */
    data object Uploading : PhotoUploadState

    /** The upload stopped for good; the entry stays unsent until it is sent without its photo. */
    data class Failed(
        val code: String?,
    ) : PhotoUploadState

    /** The server accepted the photo. */
    data object Ready : PhotoUploadState
}

enum class SyncIssueState { REJECTED, BLOCKED }

/** An outbox operation that needs the user's attention: rejected by the server or held back locally. */
data class SyncIssue(
    val shopId: String,
    val clientId: String,
    val kind: SyncKind,
    val entityId: String,
    val state: SyncIssueState,
    /** Problem code of the rejection or block, or of the failed photo upload holding the operation. */
    val code: String?,
    /** Upload state when the operation waits for its photo; null when no photo holds it. */
    val photo: PhotoUploadState?,
    val createdAt: String,
) {
    /** Only a server rejection can be dismissed; its local effects were already undone. */
    val canDismiss: Boolean get() = state == SyncIssueState.REJECTED

    /** An entry held by a failed (or lost) photo upload can be released without the photo. */
    val canSendWithoutPhoto: Boolean
        get() =
            state == SyncIssueState.BLOCKED &&
                (photo is PhotoUploadState.Failed || photo == PhotoUploadState.Absent)
}

/**
 * Read and repair surface of the outbox and the photo pipeline. Features use this instead of the
 * database: every change goes through the sync local store's transactions.
 */
interface SyncIssueRepository {
    fun observeIssues(shopId: String): Flow<List<SyncIssue>>

    /** Pending, blocked and rejected counts plus the last push/pull times of the shop. */
    fun observeStatus(shopId: String): Flow<SyncStatus>

    fun observePhotoUpload(
        shopId: String,
        entryId: String,
    ): Flow<PhotoUploadState>

    /** Deletes a REJECTED operation. Returns false when the operation is absent or not rejected. */
    suspend fun dismiss(
        shopId: String,
        clientId: String,
    ): Boolean

    /**
     * Sends the entry without its photo when the upload failed: the held operation is queued without
     * the photo key, the local photo is discarded and a sync is requested. Returns false when nothing
     * was held by a failed upload.
     */
    suspend fun sendWithoutPhoto(
        shopId: String,
        entryId: String,
    ): Boolean
}

class StoreSyncIssueRepository
    @Inject
    constructor(
        private val store: SyncLocalStore,
        private val events: LocalWriteEvents,
    ) : SyncIssueRepository {
        override fun observeIssues(shopId: String): Flow<List<SyncIssue>> =
            combine(store.observeOutbox(shopId), store.observePhotos(shopId)) { rows, photos ->
                val uploads = photos.associateBy { it.entryId }
                rows
                    .filter { it.state == REJECTED || it.state == BLOCKED }
                    .sortedWith(compareBy({ it.createdAt }, { it.clientId }))
                    .map { it.asIssue(uploads) }
            }.distinctUntilChanged()

        override fun observeStatus(shopId: String): Flow<SyncStatus> = store.status(shopId).distinctUntilChanged()

        override fun observePhotoUpload(
            shopId: String,
            entryId: String,
        ): Flow<PhotoUploadState> =
            store
                .observePhotos(shopId)
                .map { photos -> photos.firstOrNull { it.entryId == entryId }.uploadState() }
                .distinctUntilChanged()

        override suspend fun dismiss(
            shopId: String,
            clientId: String,
        ): Boolean {
            val rejected = store.observeOutbox(shopId).first().any { it.clientId == clientId && it.state == REJECTED }
            if (rejected) store.dismissIssue(shopId, clientId)
            return rejected
        }

        override suspend fun sendWithoutPhoto(
            shopId: String,
            entryId: String,
        ): Boolean {
            val released = store.detachPhoto(shopId, entryId)
            if (released) events.written(shopId)
            return released
        }

        private fun OutboxRow.asIssue(uploads: Map<String, PendingPhotoEntity>): SyncIssue {
            val held = state == BLOCKED && lastCode == null && photoEntryId != null
            val photo = if (held) uploads[photoEntryId].uploadState() else null
            return SyncIssue(
                shopId = shopId,
                clientId = clientId,
                kind = SyncKind.valueOf(kind),
                entityId = entityId,
                state = if (state == REJECTED) SyncIssueState.REJECTED else SyncIssueState.BLOCKED,
                code = lastCode ?: (photo as? PhotoUploadState.Failed)?.code,
                photo = photo,
                createdAt = createdAt,
            )
        }

        private fun PendingPhotoEntity?.uploadState(): PhotoUploadState =
            when (this?.state) {
                null -> PhotoUploadState.Absent
                "READY" -> PhotoUploadState.Ready
                "FAILED" -> PhotoUploadState.Failed(lastCode)
                else -> PhotoUploadState.Uploading
            }

        private companion object {
            const val REJECTED = "REJECTED"
            const val BLOCKED = "BLOCKED"
        }
    }
