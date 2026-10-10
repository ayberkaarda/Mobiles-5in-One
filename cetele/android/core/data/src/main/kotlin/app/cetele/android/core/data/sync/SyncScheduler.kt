package app.cetele.android.core.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncScheduler(
    private val work: WorkManager,
) {
    @Inject
    constructor(
        @ApplicationContext context: Context,
    ) : this(WorkManager.getInstance(context))

    fun requestNow(shopId: String) {
        work.enqueueUniqueWork("sync-$shopId", ExistingWorkPolicy.KEEP, immediateRequest(shopId))
    }

    fun ensurePeriodic(shopId: String) {
        work.enqueueUniquePeriodicWork(
            "sync-periodic-$shopId",
            ExistingPeriodicWorkPolicy.KEEP,
            periodicRequest(shopId),
        )
    }

    fun uploadPhoto(
        shopId: String,
        entryId: String,
    ) {
        val request =
            OneTimeWorkRequestBuilder<PhotoUploadWorker>()
                .setInputData(workDataOf(SHOP_ID to shopId, ENTRY_ID to entryId))
                .setConstraints(
                    networkConstraints(),
                ).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .addTag(WORK_TAG)
                .build()
        work.enqueueUniqueWork("photo-$entryId", ExistingWorkPolicy.KEEP, request)
    }

    fun cancelAll() {
        work.cancelAllWorkByTag(WORK_TAG)
    }

    companion object {
        const val SHOP_ID = "shopId"
        const val ENTRY_ID = "entryId"
        const val WORK_TAG = "cetele-sync"
        const val BACKOFF_SECONDS = 30L
        private const val PERIOD_MINUTES = 15L

        fun networkConstraints(): Constraints =
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun immediateRequest(shopId: String): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setInputData(workDataOf(SHOP_ID to shopId))
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .addTag(WORK_TAG)
                .build()

        fun periodicRequest(shopId: String): PeriodicWorkRequest =
            PeriodicWorkRequestBuilder<SyncWorker>(PERIOD_MINUTES, TimeUnit.MINUTES)
                .setInputData(workDataOf(SHOP_ID to shopId))
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .addTag(WORK_TAG)
                .build()
    }
}
