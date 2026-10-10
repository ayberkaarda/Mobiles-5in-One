package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OutboxOrderingTest {
    @Test fun blockedPhotoAndDependentReversalDoNotHoldLaterWrites() =
        runTest {
            val store = InMemorySyncLocalStore()
            val server = FakeSyncServer()
            val engine = SyncFixtures.engine(store, server.client("owner"))
            SyncFixtures.customer(store, "customer", "c1", "Müşteri")
            SyncFixtures.entry(store, "photo", EntryInput("e1", "c1", EntryType.DEBT, 100, SyncFixtures.today))
            store.seed(store.operations.getValue(SHOP to "photo").copy(state = "BLOCKED", photoEntryId = "e1"))
            SyncFixtures.entry(
                store,
                "reverse",
                EntryInput("r1", "c1", EntryType.DEBT, 100, SyncFixtures.today, reverses = "e1"),
                2,
                "photo",
            )
            SyncFixtures.entry(store, "later", EntryInput("e2", "c1", EntryType.DEBT, 200, SyncFixtures.today), 3)
            engine.sync(SHOP)
            assertEquals(
                listOf("customer", "later"),
                server.pushes
                    .last()
                    .body.operations
                    .map { it.clientId },
            )
            assertEquals(null, store.operations.getValue(SHOP to "photo").clientSeq)
            val now = SyncFixtures.instant.toString()
            store.markPhoto(
                PendingPhotoEntity(
                    "e1",
                    SHOP,
                    "encrypted",
                    3,
                    "media",
                    "media/$SHOP/media.jpg",
                    "READY",
                    createdAt = now,
                    updatedAt = now,
                ),
            )
            store.unblockEntry(SHOP, "e1")
            engine.sync(SHOP)
            assertEquals(
                listOf("photo"),
                server.pushes
                    .last()
                    .body.operations
                    .map { it.clientId },
            )
            assertEquals(
                "media/$SHOP/media.jpg",
                server.pushes
                    .last()
                    .body.operations
                    .single()
                    .entry
                    ?.photoKey,
            )
            engine.sync(SHOP)
            assertEquals(
                listOf("reverse"),
                server.pushes
                    .last()
                    .body.operations
                    .map { it.clientId },
            )
            val seqs = server.pushes.flatMap { it.body.operations }.map { it.clientSeq }
            assertTrue(seqs.zipWithNext().all { (a, b) -> a < b })
            assertEquals("r1", store.entries.getValue(SHOP to "e1").reversedBy)
        }

    @Test fun assignedSequencesAndCapturedPayloadSurviveRetryAndLaterWrites() =
        runTest {
            val store = InMemorySyncLocalStore()
            val server = FakeSyncServer()
            val engine = SyncFixtures.engine(store, server.client("owner"))
            SyncFixtures.customer(store, "first", "c1", "İlk")
            server.failNextPushWith(afterApplying = 1)
            engine.sync(SHOP)
            val original =
                server.pushes
                    .single()
                    .body.operations
                    .single()
            SyncFixtures.customer(store, "second", "c2", "İkinci", 1)
            engine.sync(SHOP)
            assertEquals(
                original,
                server.pushes
                    .last()
                    .body.operations
                    .first(),
            )
            assertEquals(
                listOf(1L, 2L),
                server.pushes
                    .last()
                    .body.operations
                    .map { it.clientSeq },
            )
            assertEquals(3L, store.cursor(SHOP).nextClientSeq)
        }
}
