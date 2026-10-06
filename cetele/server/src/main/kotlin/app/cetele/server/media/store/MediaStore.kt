package app.cetele.server.media.store

import java.net.URL
import java.time.Duration

data class PresignedUpload(
    val url: URL,
    val method: String = "PUT",
    val headers: Map<String, String>,
)

data class ObjectInfo(
    val length: Long,
    val contentType: String?,
)

interface MediaStore {
    fun presignPut(
        key: String,
        contentType: String,
        contentLength: Long,
        ttl: Duration,
    ): PresignedUpload

    fun presignGet(
        key: String,
        ttl: Duration,
    ): URL

    fun head(key: String): ObjectInfo?

    fun get(key: String): ByteArray

    fun put(
        key: String,
        bytes: ByteArray,
        contentType: String,
    )

    fun delete(key: String)

    fun deletePrefix(prefix: String)

    companion object {
        const val MAX_BYTES = 1_200_000
    }
}
