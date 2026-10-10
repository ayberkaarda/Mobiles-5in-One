package app.cetele.android.core.data.sync

import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.ChangeEntity
import app.cetele.android.core.network.dto.ChangeOp
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.sync.ChangeView
import app.cetele.android.core.network.dto.sync.CustomerSnapshot
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.EntrySnapshot
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PullApplierTest {
    @Test fun failureInMiddleRollsBackRowsAndCursor() =
        runTest {
            val store = InMemorySyncLocalStore()
            val first = snapshotChange(1, "first")
            val malformed = first.copy(seq = 2, entityId = "second", payload = JsonObject(emptyMap()))
            try {
                store.applyChanges(SHOP, listOf(first, malformed), 2)
                throw AssertionError("Malformed snapshot was accepted")
            } catch (_: kotlinx.serialization.SerializationException) {
                assertEquals(0L, store.cursor(SHOP).lastPulledSeq)
                assertTrue(store.customers.isEmpty())
            }
            store.applyChanges(SHOP, listOf(first, snapshotChange(3, "second")), 3)
            assertEquals(3L, store.cursor(SHOP).lastPulledSeq)
            assertEquals(2, store.customers.size)
        }

    @Test fun sinceBeyondHeadIsAnEmptySuccessfulPage() =
        runTest {
            val store = InMemorySyncLocalStore()
            store.applyChanges(SHOP, emptyList(), 100)
            val result = PullApplier(store, FakeSyncServer().client("owner"), 2).pull(SHOP)
            assertEquals(ApiResult.Success(0, 200), result)
            assertEquals(100L, store.cursor(SHOP).lastPulledSeq)
            assertTrue(store.customers.isEmpty())
        }

    @Test fun pulledOriginalKeepsLocalPendingReversal() =
        runTest {
            val store = InMemorySyncLocalStore()
            val original = EntryInput("original", "customer", EntryType.DEBT, 1500, SyncFixtures.today)
            store.seed(SyncFixtures.entryEntity(original).copy(reversedBy = "reversal", syncState = "SYNCED"))
            store.seed(SyncFixtures.entryEntity(original.copy(id = "reversal", reverses = "original")))
            val snapshot =
                EntrySnapshot(
                    "original",
                    "customer",
                    EntryType.DEBT,
                    1500,
                    "TRY",
                    SyncFixtures.today,
                    createdAt = SyncFixtures.instant,
                )
            val change =
                ChangeView(
                    1,
                    ChangeEntity.ENTRY,
                    "original",
                    ChangeOp.UPSERT,
                    SyncFixtures.instant,
                    NetworkJson.encodeToJsonElement(EntrySnapshot.serializer(), snapshot) as JsonObject,
                )
            store.applyChanges(SHOP, listOf(change), 1)
            assertEquals("reversal", store.entries[SHOP to "original"]?.reversedBy)
            store.seed(store.entries.getValue(SHOP to "reversal").copy(syncState = "SYNCED"))
            store.applyChanges(SHOP, listOf(change.copy(seq = 2)), 2)
            assertEquals(null, store.entries[SHOP to "original"]?.reversedBy)
        }

    @Test fun refreshThresholdUsesElapsedSeconds() {
        assertTrue(PullRefreshPolicy.shouldRefresh(null, SyncFixtures.instant))
        assertEquals(false, PullRefreshPolicy.shouldRefresh(SyncFixtures.instant, SyncFixtures.instant.plusSeconds(60)))
        assertTrue(PullRefreshPolicy.shouldRefresh(SyncFixtures.instant, SyncFixtures.instant.plusSeconds(61)))
        assertThrows(IllegalArgumentException::class.java) {
            PullApplier(InMemorySyncLocalStore(), FakeSyncServer().client("owner"), 0)
        }
    }

    companion object {
        fun snapshotChange(
            seq: Long,
            id: String,
        ): ChangeView {
            val snapshot =
                CustomerSnapshot(
                    id,
                    "Müşteri",
                    smsConsent = false,
                    createdAt = SyncFixtures.instant,
                    updatedAt = SyncFixtures.instant,
                )
            return ChangeView(
                seq,
                ChangeEntity.CUSTOMER,
                id,
                ChangeOp.UPSERT,
                SyncFixtures.instant,
                NetworkJson.encodeToJsonElement(CustomerSnapshot.serializer(), snapshot) as JsonObject,
            )
        }
    }
}
