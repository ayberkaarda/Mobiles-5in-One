package app.cetele.android.core.data.sync

import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.ProblemDetail
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class RetryAfterTest {
    @Test fun pushAndPullRateLimitsPreserveServerDelayAndSequence() =
        runTest {
            val store = InMemorySyncLocalStore()
            val server = FakeSyncServer()
            val engine = SyncFixtures.engine(store, server.client("owner"))
            SyncFixtures.customer(store, "operation", "c", "Müşteri")
            server.rateLimit(91)
            assertEquals(SyncOutcome.RetryAfter(91), engine.sync(SHOP))
            assertEquals(0L, store.cursor(SHOP).lastPulledSeq)
            assertEquals(1L, store.operations.getValue(SHOP to "operation").clientSeq)
            engine.sync(SHOP)
            assertEquals(server.pushes.first().body, server.pushes.last().body)
            server.rateLimit(73)
            assertEquals(SyncOutcome.RetryAfter(73), engine.sync(SHOP))
            server.unauthorizedOnce()
            assertEquals(SyncOutcome.Unauthorized, engine.sync(SHOP))
        }

    @Test fun missingOrInvalidDelayHasSafeFloorAndServerFailuresRetry() {
        fun failure(seconds: Int?) = ApiResult.Failure.Problem(ProblemDetail(title = "Limited", status = 429), seconds)
        assertEquals(SyncOutcome.RetryAfter(30), failure(null).outcome())
        assertEquals(SyncOutcome.RetryAfter(1), failure(-1).outcome())
        assertEquals(73000L, TimeUnitMillis.seconds(73))
        assertEquals(SyncOutcome.Offline, ApiResult.Failure.Unexpected(503).outcome())
        assertEquals(SyncOutcome.Offline, ApiResult.Failure.Network(java.io.IOException("Offline")).outcome())
    }

    @Test fun unauthorizedDoesNotWriteStatusAfterSessionWipe() =
        runTest {
            val backing = InMemorySyncLocalStore()
            var writes = 0
            val store =
                object : SyncLocalStore by backing {
                    override suspend fun recordError(
                        shopId: String,
                        code: String?,
                        offline: Boolean,
                    ) {
                        writes++
                    }
                }
            val server = FakeSyncServer()
            server.unauthorizedOnce()
            assertEquals(SyncOutcome.Unauthorized, SyncFixtures.engine(store, server.client("owner")).sync(SHOP))
            assertEquals(0, writes)
        }
}
