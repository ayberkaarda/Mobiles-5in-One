package app.cetele.android.feature.ledger.photo

import app.cetele.android.core.data.media.PhotoRepository
import app.cetele.android.core.data.repository.PhotoUploadState
import app.cetele.android.core.data.repository.SyncIssueRepository
import app.cetele.android.core.domain.model.LedgerEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import javax.inject.Inject

enum class EntryPhotoStatus { Absent, Uploading, Failed, Ready }

/**
 * Photo state of an entry from the public data layer: the upload pipeline state when this device
 * tracks an upload, otherwise a server key means the photo is on the server.
 */
class EntryPhotos
    @Inject
    constructor(
        private val photos: PhotoRepository,
        private val uploads: SyncIssueRepository,
    ) {
        suspend fun status(entry: LedgerEntry): EntryPhotoStatus =
            when {
                entry.photoKey != null -> EntryPhotoStatus.Ready
                photos.open(entry.id) != null -> EntryPhotoStatus.Uploading
                else -> EntryPhotoStatus.Absent
            }

        fun observe(entry: LedgerEntry): Flow<EntryPhotoStatus> =
            uploads
                .observePhotoUpload(entry.shopId, entry.id)
                .map { upload ->
                    when (upload) {
                        PhotoUploadState.Uploading -> EntryPhotoStatus.Uploading
                        is PhotoUploadState.Failed -> EntryPhotoStatus.Failed
                        PhotoUploadState.Ready -> EntryPhotoStatus.Ready
                        PhotoUploadState.Absent -> status(entry)
                    }
                }.distinctUntilChanged()

        /** Releases an entry whose photo upload failed; it is then sent without the photo. */
        suspend fun sendWithoutPhoto(entry: LedgerEntry): Boolean = uploads.sendWithoutPhoto(entry.shopId, entry.id)
    }
