package app.cetele.android.feature.billing

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import app.cetele.android.core.data.repository.ShopRepository
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.BillingApi
import app.cetele.android.core.network.dto.billing.LinkPurchaseRequest
import app.cetele.android.feature.billing.link.BillingLinkClient
import app.cetele.android.feature.billing.link.BillingLinkScheduler
import app.cetele.android.feature.billing.link.BillingLinkWorker
import app.cetele.android.feature.billing.link.LinkOutcome
import app.cetele.android.feature.billing.link.PurchaseLinker
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class BillingLinkWorkerTest {
    private val token = "fake.sub.active.$SHOP_ID"
    private val api = mockk<BillingApi>()
    private val shops = mockk<ShopRepository>()

    @Test
    fun billingUnavailableRetries() =
        runTest {
            coEvery { api.link(any(), any()) } returns problem(503, BillingProblemCodes.UNAVAILABLE, 30)
            assertEquals(ListenableWorker.Result.retry(), worker().doWork())
            coVerify(exactly = 0) { shops.refresh() }
        }

    @Test
    fun networkFailureAndRateLimitAndServerErrorRetry() =
        runTest {
            coEvery { api.link(any(), any()) } returns ApiResult.Failure.Network(IOException("Offline"))
            assertEquals(ListenableWorker.Result.retry(), worker().doWork())
            coEvery { api.link(any(), any()) } returns problem(429, "rate_limited", 120)
            assertEquals(ListenableWorker.Result.retry(), worker().doWork())
            coEvery { api.link(any(), any()) } returns ApiResult.Failure.Unexpected(502)
            assertEquals(ListenableWorker.Result.retry(), worker().doWork())
        }

    @Test
    fun tokenInUseStopsWithItsCode() =
        runTest {
            coEvery { api.link(any(), any()) } returns problem(409, BillingProblemCodes.TOKEN_IN_USE)
            assertStops(BillingProblemCodes.TOKEN_IN_USE)
        }

    @Test
    fun alreadySubscribedStopsWithItsCode() =
        runTest {
            coEvery { api.link(any(), any()) } returns problem(409, BillingProblemCodes.ALREADY_SUBSCRIBED)
            assertStops(BillingProblemCodes.ALREADY_SUBSCRIBED)
        }

    @Test
    fun purchaseInvalidStopsWithItsCode() =
        runTest {
            coEvery { api.link(any(), any()) } returns problem(422, BillingProblemCodes.PURCHASE_INVALID)
            assertStops(BillingProblemCodes.PURCHASE_INVALID)
        }

    @Test
    fun staffForbiddenAndUnknownShopStop() =
        runTest {
            coEvery { api.link(any(), any()) } returns problem(403, "forbidden")
            assertStops("forbidden")
            coEvery { api.link(any(), any()) } returns problem(404, "not_found")
            assertStops("not_found")
        }

    @Test
    fun linkedPurchaseRefreshesTheShopsAndSucceeds() =
        runTest {
            val body = slot<LinkPurchaseRequest>()
            coEvery { api.link(SHOP_ID, capture(body)) } returns ApiResult.Success(proState(), 200)
            coEvery { shops.refresh() } returns ApiResult.Success(Unit, 200)
            assertEquals(ListenableWorker.Result.success(), worker().doWork())
            assertEquals(LinkPurchaseRequest("cetele_pro", token), body.captured)
            coVerify(exactly = 1) { shops.refresh() }
        }

    @Test
    fun missingInputFailsWithoutCallingTheServer() =
        runTest {
            val worker =
                TestListenableWorkerBuilder<BillingLinkWorker>(ApplicationProvider.getApplicationContext<Context>())
                    .setInputData(workDataOf(BillingLinkScheduler.SHOP_ID to SHOP_ID))
                    .setWorkerFactory(factory())
                    .build()
            assertEquals(ListenableWorker.Result.failure(), worker.doWork())
            coVerify(exactly = 0) { api.link(any(), any()) }
        }

    @Test
    fun schedulerEnqueuesUniqueNetworkWorkWithThirtySecondBackoffPerToken() {
        val work = mockk<WorkManager>(relaxed = true)
        val request = slot<OneTimeWorkRequest>()
        BillingLinkScheduler(work).enqueue(SHOP_ID, token, 30)
        verify { work.enqueueUniqueWork("billing-link-a8bacd564eb7c299", ExistingWorkPolicy.KEEP, capture(request)) }
        val spec = request.captured.workSpec
        assertEquals(NetworkType.CONNECTED, spec.constraints.requiredNetworkType)
        assertEquals(BackoffPolicy.EXPONENTIAL, spec.backoffPolicy)
        assertEquals(30_000L, spec.backoffDelayDuration)
        assertEquals(30_000L, spec.initialDelay)
        assertEquals(SHOP_ID, spec.input.getString(BillingLinkScheduler.SHOP_ID))
        assertEquals(token, spec.input.getString(BillingLinkScheduler.PURCHASE_TOKEN))
        assertTrue(request.captured.tags.contains(BillingLinkScheduler.WORK_TAG))
        assertFalse(request.captured.toString().contains(token))
    }

    @Test
    fun linkerQueuesRetryableFailuresAndNotFinalOnes() =
        runTest {
            val work = mockk<WorkManager>(relaxed = true)
            val linker = PurchaseLinker(BillingLinkClient(api, shops), BillingLinkScheduler(work), TestGateway(), shops)
            coEvery { api.link(any(), any()) } returns problem(503, BillingProblemCodes.UNAVAILABLE, 30)
            assertEquals(LinkOutcome.Queued, linker.link(SHOP_ID, purchase()))
            verify(exactly = 1) {
                work.enqueueUniqueWork(
                    "billing-link-a8bacd564eb7c299",
                    ExistingWorkPolicy.KEEP,
                    any<OneTimeWorkRequest>(),
                )
            }
            coEvery { api.link(any(), any()) } returns problem(422, BillingProblemCodes.PURCHASE_INVALID)
            assertEquals(LinkOutcome.Refused(BillingProblemCodes.PURCHASE_INVALID), linker.link(SHOP_ID, purchase()))
            verify(exactly = 1) { work.enqueueUniqueWork(any<String>(), any(), any<OneTimeWorkRequest>()) }
        }

    private suspend fun assertStops(code: String) {
        val result = worker().doWork()
        assertEquals(ListenableWorker.Result.failure(workDataOf(BillingLinkScheduler.RESULT_CODE to code)), result)
        coVerify(exactly = 0) { shops.refresh() }
    }

    private fun worker(): BillingLinkWorker =
        TestListenableWorkerBuilder<BillingLinkWorker>(ApplicationProvider.getApplicationContext<Context>())
            .setInputData(
                workDataOf(
                    BillingLinkScheduler.SHOP_ID to SHOP_ID,
                    BillingLinkScheduler.PURCHASE_TOKEN to token,
                ),
            ).setWorkerFactory(factory())
            .build()

    private fun factory(): WorkerFactory =
        object : WorkerFactory() {
            override fun createWorker(
                appContext: Context,
                workerClassName: String,
                workerParameters: WorkerParameters,
            ): ListenableWorker = BillingLinkWorker(appContext, workerParameters, BillingLinkClient(api, shops))
        }
}
