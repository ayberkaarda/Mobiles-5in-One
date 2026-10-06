package app.cetele.android.core.data.media

import app.cetele.android.core.domain.model.LedgerEntry
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MediaApi
import app.cetele.android.core.network.dto.MediaStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject

interface PhotoRepository {
    suspend fun save(
        entryId: String,
        photo: CompressedPhoto,
    )

    suspend fun open(entryId: String): ByteArray?

    suspend fun ensureCached(
        shopId: String,
        entry: LedgerEntry,
    ): Result<Unit>
}

class StoredPhotoRepository
    @Inject
    constructor(
        private val store: EncryptedPhotoStore,
        private val api: MediaApi,
    ) : PhotoRepository {
        override suspend fun save(
            entryId: String,
            photo: CompressedPhoto,
        ) {
            withContext(Dispatchers.IO) { store.save(entryId, photo.bytes) }
        }

        override suspend fun open(entryId: String): ByteArray? = withContext(Dispatchers.IO) { store.open(entryId) }

        override suspend fun ensureCached(
            shopId: String,
            entry: LedgerEntry,
        ): Result<Unit> {
            if (open(entry.id) != null) return Result.success(Unit)
            return try {
                val fetched = api.fetch(downloadUrl(shopId, entry))
                check(fetched is ApiResult.Success) { "Photo download failed" }
                withContext(Dispatchers.IO) { store.save(entry.id, fetched.value) }
                Result.success(Unit)
            } catch (exception: IllegalStateException) {
                Result.failure(exception)
            } catch (exception: IllegalArgumentException) {
                Result.failure(exception)
            } catch (exception: IOException) {
                Result.failure(exception)
            }
        }

        private suspend fun downloadUrl(
            shopId: String,
            entry: LedgerEntry,
        ): String {
            val key = checkNotNull(entry.photoKey) { "Photo is absent" }
            require(entry.shopId == shopId && key.startsWith("media/$shopId/")) { "Photo tenant mismatch" }
            val mediaId = key.substringAfterLast('/').substringBeforeLast('.')
            val view = api.download(shopId, mediaId)
            check(view is ApiResult.Success && view.value.status == MediaStatus.READY) { "Photo is unavailable" }
            return checkNotNull(view.value.downloadUrl) { "Photo URL is absent" }
        }
    }
