package app.cetele.android.core.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.MediaApi
import app.cetele.android.core.network.dto.MediaStatus
import app.cetele.android.core.network.dto.media.MediaPresignRequest
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.delay
import java.time.Clock

@HiltWorker
@Suppress("LongParameterList")
class PhotoUploadWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted parameters: WorkerParameters,
        private val store: SyncLocalStore,
        private val api: MediaApi,
        private val photos: EncryptedPhotoStore,
        private val scheduler: SyncScheduler,
        private val clock: Clock,
        private val retryAfter: RetryAfterPolicy,
    ) : CoroutineWorker(context, parameters) {
        override suspend fun doWork(): Result {
            val shopId = inputData.getString(SyncScheduler.SHOP_ID)
            val entryId = inputData.getString(SyncScheduler.ENTRY_ID)
            val row = if (shopId == null || entryId == null) null else store.photo(shopId, entryId)
            return when {
                shopId == null || entryId == null -> Result.failure()
                row == null || row.state == FAILED -> Result.success()
                row.state == READY -> finish(row)
                else -> waitOrUpload(row)
            }
        }

        private suspend fun waitOrUpload(row: PendingPhotoEntity): Result {
            val remaining = retryAfter.remainingSeconds(row.shopId)
            if (remaining > 0) {
                delay(TimeUnitMillis.seconds(minOf(remaining, RetryAfterPolicy.WAIT_CHUNK_SECONDS)))
                return Result.retry()
            }
            val attempt = row.copy(attempts = row.attempts + 1, updatedAt = clock.instant().toString())
            store.markPhoto(attempt)
            return if (attempt.state == UPLOADED) complete(attempt) else upload(attempt)
        }

        private suspend fun upload(row: PendingPhotoEntity): Result {
            val bytes =
                photos.open(row.entryId)?.takeIf { it.size == row.contentLength } ?: return fail(row, MEDIA_INVALID)
            return when (val presign = api.presign(row.shopId, MediaPresignRequest(CONTENT_TYPE, bytes.size))) {
                is ApiResult.Failure -> {
                    handle(row, presign)
                }

                is ApiResult.Success -> {
                    when (val upload = api.upload(presign.value, bytes)) {
                        is ApiResult.Failure -> {
                            handle(row, upload)
                        }

                        is ApiResult.Success -> {
                            val uploaded =
                                row.copy(
                                    mediaId = presign.value.mediaId,
                                    photoKey = presign.value.photoKey,
                                    state = UPLOADED,
                                )
                            store.markPhoto(uploaded)
                            complete(uploaded)
                        }
                    }
                }
            }
        }

        private suspend fun complete(row: PendingPhotoEntity): Result {
            val mediaId = row.mediaId ?: return fail(row, MEDIA_INVALID)
            return when (val complete = api.complete(row.shopId, mediaId)) {
                is ApiResult.Failure -> {
                    handle(row, complete)
                }

                is ApiResult.Success -> {
                    if (complete.value.status != MediaStatus.READY) {
                        fail(row, MEDIA_NOT_READY)
                    } else {
                        val ready =
                            row.copy(
                                state = READY,
                                photoKey = complete.value.photoKey,
                                lastCode = null,
                                updatedAt = clock.instant().toString(),
                            )
                        store.markPhoto(ready)
                        finish(ready)
                    }
                }
            }
        }

        private suspend fun finish(row: PendingPhotoEntity): Result {
            store.unblockEntry(row.shopId, row.entryId)
            photos.markReady(row.entryId)
            scheduler.requestNow(row.shopId)
            return Result.success()
        }

        private suspend fun handle(
            row: PendingPhotoEntity,
            failure: ApiResult.Failure,
        ): Result =
            when (val outcome = failure.outcome()) {
                is SyncOutcome.RetryAfter -> {
                    retryAfter.defer(row.shopId, outcome.seconds)
                    delay(TimeUnitMillis.seconds(minOf(outcome.seconds, RetryAfterPolicy.WAIT_CHUNK_SECONDS)))
                    Result.retry()
                }

                SyncOutcome.Offline -> {
                    Result.retry()
                }

                SyncOutcome.Unauthorized -> {
                    Result.success()
                }

                is SyncOutcome.Blocked -> {
                    fail(row, outcome.code)
                }

                is SyncOutcome.Done -> {
                    Result.success()
                }
            }

        private suspend fun fail(
            row: PendingPhotoEntity,
            code: String,
        ): Result {
            store.markPhoto(row.copy(state = FAILED, lastCode = code, updatedAt = clock.instant().toString()))
            return Result.success()
        }

        private companion object {
            const val READY = "READY"
            const val UPLOADED = "UPLOADED"
            const val FAILED = "FAILED"
            const val CONTENT_TYPE = "image/jpeg"
            const val MEDIA_INVALID = "media.invalid"
            const val MEDIA_NOT_READY = "media.not_ready"
        }
    }
