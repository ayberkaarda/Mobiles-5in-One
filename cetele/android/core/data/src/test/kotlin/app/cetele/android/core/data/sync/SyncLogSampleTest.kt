package app.cetele.android.core.data.sync

import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SyncLogSampleTest {
    @Test fun logsContainOnlyShopIdentifierCountsAndOutcome() =
        runTest {
            ShadowLog.clear()
            val store = InMemorySyncLocalStore()
            val api = FakeSyncServer().client("owner")
            SyncFixtures.customer(store, "customer", "c", "Private customer name")
            SyncFixtures.entry(
                store,
                "entry",
                EntryInput("e", "c", EntryType.DEBT, 987654, SyncFixtures.today, note = "Private ledger note"),
            )
            val engine =
                SyncEngine(store, api, PushBatchBuilder(store), PullApplier(store, api), RejectionHandler(store))
            engine.sync(SHOP)
            val text = ShadowLog.getLogsForTag("CeteleSync").joinToString("\n") { it.msg }
            assertTrue(text.contains("shop=$SHOP"))
            assertTrue(text.contains("done pushed=2 pulled=2"))
            listOf(
                "Private customer name",
                "Private ledger note",
                "987654",
                "+90",
                "Authorization",
                "https://",
                "accessToken",
                "refreshToken",
            ).forEach {
                assertFalse("Unexpected private field: $it", text.contains(it))
            }
        }
}
