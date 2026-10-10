package app.cetele.android.core.data.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.BackoffPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import app.cetele.android.core.data.settings.SettingsRepository
import app.cetele.android.core.data.settings.UserSettings
import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.SyncApi
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SyncWorkerTest {
    @Test fun offlineReturnsRetryAndCompletedSyncReturnsSuccess() =
        runTest {
            val store = InMemorySyncLocalStore()
            val offline = mockk<SyncApi>()
            coEvery { offline.pull(any(), any(), any()) } returns
                ApiResult.Failure.Network(java.io.IOException("Offline"))
            assertEquals(ListenableWorker.Result.retry(), worker(store, offline).doWork())
            assertEquals(ListenableWorker.Result.success(), worker(store, FakeSyncServer().client("owner")).doWork())
        }

    @Test fun pendingShopsAreIncludedAndRetryAfterWaitsBeforeRetry() =
        runTest {
            val store = InMemorySyncLocalStore()
            val server = FakeSyncServer()
            SyncFixtures.customer(store, "queued", "customer", "Müşteri")
            val context = ApplicationProvider.getApplicationContext<Context>()
            val settings = mockk<SettingsRepository>()
            coEvery { settings.current() } returns UserSettings(activeShopId = "another-shop")
            val factory = factory(store, SyncFixtures.engine(store, server.client("owner")), settings)
            val worker = TestListenableWorkerBuilder<SyncWorker>(context).setWorkerFactory(factory).build()
            server.rateLimit(9)
            val start = testScheduler.currentTime
            assertEquals(ListenableWorker.Result.retry(), worker.doWork())
            assertTrue(testScheduler.currentTime - start >= 9000)
            assertTrue(server.pulls.any { it.shopId == "another-shop" })
            assertTrue(server.pushes.any { it.shopId == SHOP })
        }

    @Test fun schedulerUsesConnectedUniqueExpeditedAndPeriodicWork() {
        val work = mockk<WorkManager>(relaxed = true)
        val immediate = slot<OneTimeWorkRequest>()
        val periodic = slot<PeriodicWorkRequest>()
        val scheduler = SyncScheduler(work)
        scheduler.requestNow(SHOP)
        scheduler.ensurePeriodic(SHOP)
        verify { work.enqueueUniqueWork("sync-$SHOP", ExistingWorkPolicy.KEEP, capture(immediate)) }
        verify {
            work.enqueueUniquePeriodicWork(
                "sync-periodic-$SHOP",
                ExistingPeriodicWorkPolicy.KEEP,
                capture(periodic),
            )
        }
        assertEquals(NetworkType.CONNECTED, immediate.captured.workSpec.constraints.requiredNetworkType)
        assertEquals(BackoffPolicy.EXPONENTIAL, immediate.captured.workSpec.backoffPolicy)
        assertEquals(30000L, immediate.captured.workSpec.backoffDelayDuration)
        assertTrue(immediate.captured.workSpec.expedited)
        assertEquals(900000L, periodic.captured.workSpec.intervalDuration)
        assertEquals(NetworkType.CONNECTED, periodic.captured.workSpec.constraints.requiredNetworkType)
        scheduler.cancelAll()
        verify { work.cancelAllWorkByTag(SyncScheduler.WORK_TAG) }
    }

    @Test fun persistedDelayPreventsNetworkRequestsFromNewWork() =
        runTest {
            val context = ApplicationProvider.getApplicationContext<Context>()
            context
                .getSharedPreferences(RetryAfterPolicy.FILE_NAME, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit()
            val policy = RetryAfterPolicy(context, SyncFixtures.clock)
            policy.defer(SHOP, 91)
            val store = InMemorySyncLocalStore()
            val server = FakeSyncServer()
            val settings = mockk<SettingsRepository>()
            coEvery { settings.current() } returns UserSettings(activeShopId = SHOP)
            val worker =
                TestListenableWorkerBuilder<SyncWorker>(context)
                    .setWorkerFactory(
                        factory(store, SyncFixtures.engine(store, server.client("owner")), settings, policy),
                    ).build()
            val start = testScheduler.currentTime
            assertEquals(ListenableWorker.Result.retry(), worker.doWork())
            assertEquals(60000L, testScheduler.currentTime - start)
            assertTrue(server.pushes.isEmpty())
            assertTrue(server.pulls.isEmpty())
        }

    private fun worker(
        store: SyncLocalStore,
        api: SyncApi,
    ): SyncWorker {
        val settings = mockk<SettingsRepository>()
        coEvery { settings.current() } returns UserSettings(activeShopId = SHOP)
        return TestListenableWorkerBuilder<SyncWorker>(ApplicationProvider.getApplicationContext<Context>())
            .setInputData(workDataOf(SyncScheduler.SHOP_ID to SHOP))
            .setWorkerFactory(factory(store, SyncFixtures.engine(store, api), settings))
            .build()
    }

    private fun factory(
        store: SyncLocalStore,
        engine: SyncEngine,
        settings: SettingsRepository,
        policy: RetryAfterPolicy = mockk(relaxed = true),
    ): WorkerFactory =
        object : WorkerFactory() {
            override fun createWorker(
                appContext: Context,
                workerClassName: String,
                workerParameters: WorkerParameters,
            ): ListenableWorker =
                SyncWorker(appContext, workerParameters, engine, store, settings, mockk(relaxed = true), policy)
        }
}
