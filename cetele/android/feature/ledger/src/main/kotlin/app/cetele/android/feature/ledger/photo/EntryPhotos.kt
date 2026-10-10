package app.cetele.android.feature.ledger.photo

import app.cetele.android.core.data.media.PhotoRepository
import app.cetele.android.core.domain.model.LedgerEntry
import javax.inject.Inject

enum class EntryPhotoStatus { Absent, Uploading, Ready }

/**
 * Photo state of an entry as far as the public data layer exposes it: a server key means the
 * upload finished; an encrypted local copy without a key means the upload is still pending.
 */
class EntryPhotos
    @Inject
    constructor(
        private val photos: PhotoRepository,
    ) {
        suspend fun status(entry: LedgerEntry): EntryPhotoStatus =
            when {
                entry.photoKey != null -> EntryPhotoStatus.Ready
                photos.open(entry.id) != null -> EntryPhotoStatus.Uploading
                else -> EntryPhotoStatus.Absent
            }
    }
