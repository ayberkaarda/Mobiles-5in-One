@file:UseSerializers(InstantSerializer::class, LocalDateSerializer::class)

package app.cetele.android.core.network.dto.media

import app.cetele.android.core.network.dto.InstantSerializer
import app.cetele.android.core.network.dto.LocalDateSerializer
import app.cetele.android.core.network.dto.MediaStatus
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

@Serializable
data class MediaPresignRequest(
    val contentType: String,
    val contentLength: Int,
)

@Serializable
data class MediaUploadView(
    val mediaId: String,
    val uploadUrl: String,
    val method: String,
    val headers: Map<String, String>,
    val expiresAt: Instant,
    val photoKey: String,
)

@Serializable
data class MediaReadyView(
    val mediaId: String,
    val photoKey: String,
    val status: MediaStatus,
    val width: Int,
    val height: Int,
    val bytes: Int,
)

@Serializable
data class MediaDownloadView(
    val mediaId: String,
    val status: MediaStatus,
    val photoKey: String? = null,
    val downloadUrl: String? = null,
    val expiresAt: Instant? = null,
)
