package app.cetele.android.core.data.sync

import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.data.sync.fake.FakeSyncServer
import app.cetele.android.core.domain.ledger.Balance
import app.cetele.android.core.domain.ledger.BalanceLine
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.sync.EntryInput
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import app.cetele.android.core.domain.model.EntryType as DomainEntryType

class SyncConvergenceTest {
    @Test fun twoOfflineDevicesConvergeAcrossReplayRenamesDeletionAndReversals() =
        runTest {
            val server = FakeSyncServer()
            val a = InMemorySyncLocalStore()
            val b = InMemorySyncLocalStore()
            val owner = SyncFixtures.engine(a, server.client("owner"), 2)
            val staff = SyncFixtures.engine(b, server.client("staff", FakeSyncServer.Role.STAFF), 2)
            SyncFixtures.customer(a, "a-customer", "c1", "Birinci")
            SyncFixtures.entry(a, "a-debt", EntryInput("d1", "c1", EntryType.DEBT, 1000, SyncFixtures.today))
            SyncFixtures.customer(b, "b-customer", "c2", "İkinci")
            SyncFixtures.entry(b, "b-payment", EntryInput("p2", "c2", EntryType.PAYMENT, 200, SyncFixtures.today))
            SyncFixtures.entry(b, "b-debt", EntryInput("d2", "c2", EntryType.DEBT, 800, SyncFixtures.today), 2)
            server.failNextPushWith(afterApplying = 1)
            assertEquals(SyncOutcome.Offline, owner.sync(SHOP))
            val originalBatch = server.pushes.last().body
            assertTrue(owner.sync(SHOP) is SyncOutcome.Done)
            assertEquals(originalBatch, server.pushes.last().body)
            val duplicate = server.client("owner").push(SHOP, originalBatch).getOrNull()!!
            assertTrue(duplicate.results.all { it.status == OperationStatus.DUPLICATE })
            assertTrue(staff.sync(SHOP) is SyncOutcome.Done)
            owner.sync(SHOP)
            assertState(server, a, b)
            assertEquals(1000, balance(a, "c1"))
            assertEquals(600, balance(b, "c2"))

            SyncFixtures.customer(a, "a-rename", "c1", "Erken", 10)
            SyncFixtures.customer(b, "b-rename", "c1", "Geç", 10)
            owner.sync(SHOP)
            // A pull may replace B's row, but must never replace the captured queued edit.
            PullApplier(b, server.client("staff"), 2).pull(SHOP)
            staff.sync(SHOP)
            owner.sync(SHOP)
            assertEquals("Geç", a.customers.getValue(SHOP to "c1").name)
            assertState(server, a, b)

            SyncFixtures.entry(b, "b-stale", EntryInput("stale", "c1", EntryType.DEBT, 700, SyncFixtures.today), 20)
            SyncFixtures.entry(
                b,
                "b-neighbour",
                EntryInput("neighbour", "c2", EntryType.DEBT, 300, SyncFixtures.today),
                21,
            )
            SyncFixtures.delete(a, "a-delete", "c1", 20)
            owner.sync(SHOP)
            staff.sync(SHOP)
            assertEquals("customer.deleted", b.operations.getValue(SHOP to "b-stale").lastCode)
            assertFalse(b.entries.containsKey(SHOP to "stale"))
            assertTrue(b.entries.containsKey(SHOP to "neighbour"))

            SyncFixtures.entry(
                b,
                "b-reverse",
                EntryInput("r2", "c2", EntryType.DEBT, 800, SyncFixtures.today, reverses = "d2"),
                30,
            )
            staff.sync(SHOP)
            owner.sync(SHOP)
            assertEquals("r2", a.entries.getValue(SHOP to "d2").reversedBy)
            assertEquals(100, balance(a, "c2"))

            SyncFixtures.delete(b, "staff-delete", "c2", 40)
            SyncFixtures.entry(
                b,
                "staff-neighbour",
                EntryInput("p3", "c2", EntryType.PAYMENT, 50, SyncFixtures.today),
                41,
            )
            staff.sync(SHOP)
            owner.sync(SHOP)
            assertEquals("forbidden", b.operations.getValue(SHOP to "staff-delete").lastCode)
            assertEquals(50, balance(a, "c2"))
            assertState(server, a, b)
            assertEquals(server.head(SHOP), a.cursor(SHOP).lastPulledSeq)
            assertEquals(server.head(SHOP), b.cursor(SHOP).lastPulledSeq)
            assertTrue(server.pulls.all { it.limit == 2 })
            assertTrue(server.pulls.count { it.since > 0 } > 2)
        }

    private fun assertState(
        server: FakeSyncServer,
        a: InMemorySyncLocalStore,
        b: InMemorySyncLocalStore,
    ) {
        assertEquals(server.customers.mapValues { it.value.asEntity(it.key.first, false) }, a.customers)
        assertEquals(server.entries.mapValues { it.value.asEntity(it.key.first) }, a.entries)
        assertEquals(a.customers, b.customers)
        assertEquals(a.entries, b.entries)
    }

    private fun balance(
        store: InMemorySyncLocalStore,
        id: String,
    ): Long =
        Balance
            .of(
                store.entries.values.filter { it.customerId == id }.map {
                    BalanceLine(DomainEntryType.valueOf(it.type), it.amountMinor, it.reverses, it.reversedBy)
                },
            ).minor
}
