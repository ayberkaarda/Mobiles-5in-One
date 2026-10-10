package app.cetele.android.feature.billing.link

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import app.cetele.android.feature.billing.PurchaseTokenKey
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Retries a link in the background until the server answers. Play refunds a purchase that is not acknowledged
 * within three days, so the retry is WorkManager work that survives restarts. The token lives only in the work's
 * input data, which WorkManager keeps in app-private storage.
 */
@Singleton
class BillingLinkScheduler(
    private val work: WorkManager,
) {
    @Inject
    constructor(
        @ApplicationContext context: Context,
    ) : this(WorkManager.getInstance(context))

    fun enqueue(
        shopId: String,
        purchaseToken: String,
        initialDelaySeconds: Int? = null,
    ) {
        work.enqueueUniqueWork(
            PurchaseTokenKey.workName(purchaseToken),
            ExistingWorkPolicy.KEEP,
            request(shopId, purchaseToken, initialDelaySeconds),
        )
    }

    companion object {
        const val SHOP_ID = "shopId"
        const val PURCHASE_TOKEN = "purchaseToken"
        const val RESULT_CODE = "code"
        const val WORK_TAG = "cetele-billing-link"
        const val BACKOFF_SECONDS = 30L

        fun request(
            shopId: String,
            purchaseToken: String,
            initialDelaySeconds: Int? = null,
        ): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<BillingLinkWorker>()
                .setInputData(workDataOf(SHOP_ID to shopId, PURCHASE_TOKEN to purchaseToken))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
                .setInitialDelay((initialDelaySeconds ?: 0).toLong().coerceAtLeast(0), TimeUnit.SECONDS)
                .addTag(WORK_TAG)
                .build()
    }
}
