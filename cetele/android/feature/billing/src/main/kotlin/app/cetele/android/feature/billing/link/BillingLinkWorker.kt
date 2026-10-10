package app.cetele.android.feature.billing.link

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/** One background link attempt: `503`, `429`, server errors and no network retry; refusals are final. */
@HiltWorker
class BillingLinkWorker
    @AssistedInject
    constructor(
        @Assisted context: Context,
        @Assisted parameters: WorkerParameters,
        private val client: BillingLinkClient,
    ) : CoroutineWorker(context, parameters) {
        override suspend fun doWork(): Result {
            val shopId = inputData.getString(BillingLinkScheduler.SHOP_ID)
            val token = inputData.getString(BillingLinkScheduler.PURCHASE_TOKEN)
            if (shopId == null || token == null) return Result.failure()
            return when (val attempt = client.attempt(shopId, token)) {
                is LinkAttempt.Linked -> {
                    log("linked")
                    Result.success()
                }

                is LinkAttempt.Retry -> {
                    log("retry")
                    Result.retry()
                }

                is LinkAttempt.Final -> {
                    log("refused code=${attempt.code}")
                    Result.failure(workDataOf(BillingLinkScheduler.RESULT_CODE to attempt.code))
                }
            }
        }

        // Outcome and problem code only: never the token, the order id or the obfuscated account id.
        private fun log(outcome: String) {
            if (Log.isLoggable(TAG, Log.INFO)) Log.i(TAG, "billing link outcome=$outcome attempt=$runAttemptCount")
        }

        private companion object {
            const val TAG = "CeteleBilling"
        }
    }
