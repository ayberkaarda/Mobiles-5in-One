package app.cetele.android.core.data.sync.fake

import app.cetele.android.core.data.sync.SyncFixtures
import app.cetele.android.core.domain.id.UuidV7
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import app.cetele.android.core.network.api.MediaApi
import app.cetele.android.core.network.dto.MediaStatus
import app.cetele.android.core.network.dto.media.MediaDownloadView
import app.cetele.android.core.network.dto.media.MediaPresignRequest
import app.cetele.android.core.network.dto.media.MediaReadyView
import app.cetele.android.core.network.dto.media.MediaUploadView
import java.time.Clock

class FakeMediaApi(
    private val clock: Clock = SyncFixtures.clock,
) : MediaApi {
    data class UploadCall(
        val view: MediaUploadView,
        val bytes: ByteArray,
    )

    val presigns = mutableListOf<Pair<String, MediaPresignRequest>>()
    val uploads = mutableListOf<UploadCall>()
    val completions = mutableListOf<Pair<String, String>>()
    var completeFailure: String? = null
    private val views = mutableMapOf<String, Pair<String, MediaUploadView>>()
    private val content = mutableMapOf<String, ByteArray>()
    private val ready = mutableSetOf<String>()

    override suspend fun presign(
        shopId: String,
        body: MediaPresignRequest,
    ): ApiResult<MediaUploadView> {
        presigns += shopId to body
        if (body.contentLength !in 1..1_200_000) return failure("media.too_large", 413)
        val id = UuidV7.generate(clock)
        val view =
            MediaUploadView(
                id,
                "https://storage.example.test/$id",
                "PUT",
                mapOf(
                    "Content-Type" to body.contentType,
                    "Content-Length" to body.contentLength.toString(),
                    "X-Upload-Mode" to "photo",
                ),
                clock.instant().plusSeconds(600),
                "media/$shopId/$id.jpg",
            )
        views[id] = shopId to view
        return ApiResult.Success(view, 201)
    }

    override suspend fun upload(
        view: MediaUploadView,
        bytes: ByteArray,
    ): ApiResult<Unit> {
        uploads += UploadCall(view, bytes.copyOf())
        val expected = views[view.mediaId]?.second
        if (view != expected ||
            view.headers["Content-Length"] != bytes.size.toString()
        ) {
            return failure("media.invalid", 422)
        }
        content[view.mediaId] = bytes.copyOf()
        return ApiResult.Success(Unit, 200)
    }

    override suspend fun complete(
        shopId: String,
        mediaId: String,
    ): ApiResult<MediaReadyView> {
        completions += shopId to mediaId
        val view = views[mediaId]?.takeIf { it.first == shopId }?.second
        val bytes = content[mediaId]
        val refusal = completeFailure
        return when {
            refusal != null -> {
                failure(refusal, 422)
            }

            view == null -> {
                failure(NOT_FOUND, 404)
            }

            bytes == null -> {
                failure("media.not_uploaded", 409)
            }

            else -> {
                ready += mediaId
                ApiResult.Success(MediaReadyView(mediaId, view.photoKey, MediaStatus.READY, 1, 1, bytes.size), 200)
            }
        }
    }

    override suspend fun download(
        shopId: String,
        mediaId: String,
    ): ApiResult<MediaDownloadView> {
        val view = views[mediaId]?.takeIf { it.first == shopId }?.second
        return when {
            view == null -> {
                failure(NOT_FOUND, 404)
            }

            mediaId !in ready -> {
                failure("media.not_ready", 409)
            }

            else -> {
                val download =
                    MediaDownloadView(
                        mediaId,
                        MediaStatus.READY,
                        view.photoKey,
                        view.uploadUrl,
                        clock.instant().plusSeconds(600),
                    )
                ApiResult.Success(download, 200)
            }
        }
    }

    override suspend fun fetch(downloadUrl: String): ApiResult<ByteArray> {
        val id =
            views.values
                .firstOrNull { it.second.uploadUrl == downloadUrl }
                ?.second
                ?.mediaId
        val bytes = id?.let { content[it] } ?: return failure(NOT_FOUND, 404)
        return ApiResult.Success(bytes.copyOf(), 200)
    }

    private fun failure(
        code: String,
        status: Int,
    ): ApiResult.Failure.Problem =
        ApiResult.Failure.Problem(ProblemDetail(title = "Upload refused", status = status, code = code))

    private companion object {
        const val NOT_FOUND = "not_found"
    }
}
