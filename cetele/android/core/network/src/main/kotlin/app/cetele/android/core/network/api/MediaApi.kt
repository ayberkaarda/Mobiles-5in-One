package app.cetele.android.core.network.api

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.di.ApiClient
import app.cetele.android.core.network.di.StorageClient
import app.cetele.android.core.network.dto.media.MediaDownloadView
import app.cetele.android.core.network.dto.media.MediaPresignRequest
import app.cetele.android.core.network.dto.media.MediaReadyView
import app.cetele.android.core.network.dto.media.MediaUploadView
import io.ktor.client.HttpClient
import io.ktor.client.request.prepareGet
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.isSuccess
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import java.io.ByteArrayOutputStream
import javax.inject.Inject

interface MediaApi {
    suspend fun presign(
        shopId: String,
        body: MediaPresignRequest,
    ): ApiResult<MediaUploadView>

    suspend fun upload(
        view: MediaUploadView,
        bytes: ByteArray,
    ): ApiResult<Unit>

    suspend fun complete(
        shopId: String,
        mediaId: String,
    ): ApiResult<MediaReadyView>

    suspend fun download(
        shopId: String,
        mediaId: String,
    ): ApiResult<MediaDownloadView>

    suspend fun fetch(downloadUrl: String): ApiResult<ByteArray>
}

class KtorMediaApi
    @Inject
    constructor(
        @ApiClient private val client: HttpClient,
        @StorageClient private val storage: HttpClient,
    ) : MediaApi {
        override suspend fun presign(
            shopId: String,
            body: MediaPresignRequest,
        ): ApiResult<MediaUploadView> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/media/presign")
                setBody(body)
            }

        override suspend fun upload(
            view: MediaUploadView,
            bytes: ByteArray,
        ): ApiResult<Unit> =
            storage.apiCall {
                method = HttpMethod.parse(view.method)
                url(view.uploadUrl)
                headers.clear()
                // Content-Type travels on the body and Content-Length is derived from it; both are signed.
                view.headers
                    .filterKeys { key -> key.lowercase() !in BODY_HEADERS }
                    .forEach { (key, value) -> headers.append(key, value) }
                val contentType =
                    view.headers.entries
                        .firstOrNull { it.key.equals(HttpHeaders.ContentType, ignoreCase = true) }
                        ?.let { ContentType.parse(it.value) }
                setBody(ByteArrayContent(bytes, contentType ?: ContentType.Application.OctetStream))
            }

        override suspend fun complete(
            shopId: String,
            mediaId: String,
        ): ApiResult<MediaReadyView> =
            client.apiCall {
                method = HttpMethod.Post
                url("v1/shops/${segment(shopId)}/media/${segment(mediaId)}/complete")
            }

        override suspend fun download(
            shopId: String,
            mediaId: String,
        ): ApiResult<MediaDownloadView> =
            client.apiCall {
                method = HttpMethod.Get
                url("v1/shops/${segment(shopId)}/media/${segment(mediaId)}")
            }

        // Any transport or decoding failure is reported as a network failure; cancellation propagates.
        @Suppress("TooGenericExceptionCaught")
        override suspend fun fetch(downloadUrl: String): ApiResult<ByteArray> =
            try {
                storage.prepareGet(downloadUrl).execute { response ->
                    if (!response.status.isSuccess()) {
                        ApiResult.Failure.Unexpected(response.status.value)
                    } else {
                        val channel = response.bodyAsChannel()
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(READ_BUFFER_BYTES)
                        var count = channel.readAvailable(buffer)
                        while (count >= 0) {
                            if (output.size() + count > MAX_PHOTO_BYTES) {
                                channel.cancel(null)
                                return@execute ApiResult.Failure.Unexpected(HttpStatusCode.PayloadTooLarge.value)
                            }
                            output.write(buffer, 0, count)
                            count = channel.readAvailable(buffer)
                        }
                        ApiResult.Success(output.toByteArray(), response.status.value)
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                ApiResult.Failure.Network(exception)
            }

        private companion object {
            const val MAX_PHOTO_BYTES = 1_200_000
            const val READ_BUFFER_BYTES = 8192
            val BODY_HEADERS = setOf("content-type", "content-length")
        }
    }
