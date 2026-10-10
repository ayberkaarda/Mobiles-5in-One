package app.cetele.android.core.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.cetele.android.core.data.settings.SettingsRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.delay

@HiltWorker
@Suppress("LongParameterList")
class SyncWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted parameters: WorkerParameters,
        private val engine: SyncEngine,
        private val store: SyncLocalStore,
        private val settings: SettingsRepository,
        private val scheduler: SyncScheduler,
        private val retryAfter: RetryAfterPolicy,
    ) : CoroutineWorker(context, parameters) {
        override suspend fun doWork(): Result {
            val active = settings.current().activeShopId
            val shops =
                (
                    listOfNotNull(
                        inputData.getString(SyncScheduler.SHOP_ID),
                        active,
                    ) + store.shopsWithPending()
                ).distinct()
            var retry = false
            var waitSeconds = 0
            for (shopId in shops) {
                val remaining = retryAfter.remainingSeconds(shopId)
                if (remaining > 0) {
                    retry = true
                    waitSeconds = maxOf(waitSeconds, remaining)
                    continue
                }
                store.pendingPhotos(shopId).forEach { scheduler.uploadPhoto(shopId, it.entryId) }
                val outcome = engine.sync(shopId)
                if (outcome == SyncOutcome.Unauthorized) return Result.success()
                if (outcome is SyncOutcome.RetryAfter) {
                    retryAfter.defer(shopId, outcome.seconds)
                    waitSeconds = maxOf(waitSeconds, outcome.seconds)
                }
                // A blocked shop is surfaced through the status flow and waits for the user, not for a retry.
                retry = retry ||
                    when (outcome) {
                        SyncOutcome.Offline, is SyncOutcome.RetryAfter -> true
                        is SyncOutcome.Done -> store.queuedOperations(shopId, 1).isNotEmpty()
                        else -> false
                    }
            }
            if (waitSeconds > 0) delay(TimeUnitMillis.seconds(minOf(waitSeconds, RetryAfterPolicy.WAIT_CHUNK_SECONDS)))
            return if (retry) Result.retry() else Result.success()
        }
    }

internal object TimeUnitMillis {
    private const val MILLIS_PER_SECOND = 1000L

    fun seconds(seconds: Int): Long = seconds.toLong() * MILLIS_PER_SECOND
}
