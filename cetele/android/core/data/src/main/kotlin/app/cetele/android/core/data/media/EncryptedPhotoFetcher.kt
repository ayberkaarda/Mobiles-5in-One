package app.cetele.android.core.data.media

import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.request.Options
import okio.Buffer
import okio.FileSystem

data class PhotoRef(
    val entryId: String,
)

class EncryptedPhotoFetcher(
    private val ref: PhotoRef,
    private val photos: PhotoRepository,
) : Fetcher {
    override suspend fun fetch(): SourceFetchResult? {
        val bytes = photos.open(ref.entryId) ?: return null
        return SourceFetchResult(ImageSource(Buffer().write(bytes), FileSystem.SYSTEM), "image/jpeg", DataSource.DISK)
    }

    class Factory(
        private val photos: PhotoRepository,
    ) : Fetcher.Factory<PhotoRef> {
        override fun create(
            data: PhotoRef,
            options: Options,
            imageLoader: ImageLoader,
        ): Fetcher = EncryptedPhotoFetcher(data, photos)
    }
}
