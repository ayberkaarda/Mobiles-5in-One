package app.cetele.android.core.data.sync

import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.write.LocalWriteEvents
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SyncTriggerTest {
    @Test fun localWriteRequestsImmediateAndPeriodicSync() =
        runTest {
            val events = LocalWriteEvents()
            val scheduler = mockk<SyncScheduler>(relaxed = true)
            val job = SyncTrigger(events, scheduler).start(backgroundScope)
            runCurrent()
            events.written(SHOP)
            runCurrent()
            verify(exactly = 1) { scheduler.requestNow(SHOP) }
            verify(exactly = 1) { scheduler.ensurePeriodic(SHOP) }
            job.cancel()
            events.written(SHOP)
            runCurrent()
            verify(exactly = 1) { scheduler.requestNow(SHOP) }
        }
}
