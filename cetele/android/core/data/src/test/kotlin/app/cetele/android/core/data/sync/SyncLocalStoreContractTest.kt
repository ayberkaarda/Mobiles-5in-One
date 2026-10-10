package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.sync.SyncFixtures.SHOP
import app.cetele.android.core.network.NetworkJson
import app.cetele.android.core.network.dto.EntryType
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.SyncKind
import app.cetele.android.core.network.dto.sync.CustomerInput
import app.cetele.android.core.network.dto.sync.EntryInput
import app.cetele.android.core.network.dto.sync.OperationResult
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull

abstract class SyncLocalStoreContractTest {
    protected abstract val store: SyncLocalStore

    protected abstract suspend fun seed(row: OutboxRow)

    protected abstract suspend fun seed(row: CustomerEntity)

    protected abstract suspend fun seed(row: LedgerEntryEntity)

    protected abstract suspend fun customer(id: String): CustomerEntity?

    protected abstract suspend fun entry(id: String): LedgerEntryEntity?

    protected suspend fun sequenceAndResultsContract() {
        val input = CustomerInput("customer", "Müşteri", smsConsent = false)
        val row = SyncFixtures.row("operation", SyncKind.CUSTOMER_UPSERT, input.id, NetworkJson.encodeToString(input))
        seed(SyncFixtures.customerEntity(input))
        seed(row)
        seed(row.copy(shopId = "other", clientId = "other-operation"))
        assertEquals(listOf("operation"), store.queuedOperations(SHOP, 500).map { it.clientId })
        assertEquals(mapOf("operation" to 1L), store.assignClientSeqs(SHOP, listOf("operation")))
        assertEquals(mapOf("operation" to 1L), store.assignClientSeqs(SHOP, listOf("operation")))
        assertEquals(2L, store.cursor(SHOP).nextClientSeq)
        assertEquals(1L, store.cursor("other").nextClientSeq)
        store.applyResults(SHOP, listOf(OperationResult("operation", OperationStatus.DUPLICATE, input.id)), 1)
        assertEquals(emptyList<OutboxRow>(), store.queuedOperations(SHOP, 500))
        assertEquals("SYNCED", customer(input.id)?.syncState)
        assertEquals(1, store.queuedOperations("other", 500).size)
        assertNotNull(store.status(SHOP).first().lastPushAt)
    }

    protected suspend fun rollbackAndPendingPayloadContract() {
        val input = CustomerInput("customer", "Yerel düzenleme", smsConsent = false)
        val row = SyncFixtures.row("operation", SyncKind.CUSTOMER_UPSERT, input.id, NetworkJson.encodeToString(input))
        seed(SyncFixtures.customerEntity(input))
        seed(row)
        val change = PullApplierTest.snapshotChange(1, input.id)
        try {
            store.applyChanges(SHOP, listOf(change, change.copy(seq = 2, payload = JsonObject(emptyMap()))), 2)
            throw AssertionError("Malformed page was accepted")
        } catch (_: kotlinx.serialization.SerializationException) {
            assertEquals(0L, store.cursor(SHOP).lastPulledSeq)
            assertEquals(input.name, customer(input.id)?.name)
        }
        store.applyChanges(SHOP, listOf(change), 1)
        assertEquals("Müşteri", customer(input.id)?.name)
        assertEquals("PENDING", customer(input.id)?.syncState)
        assertEquals(
            input,
            PushBatchBuilder(store)
                .build(SHOP)
                .operations
                .single()
                .customer,
        )
        store.applyResults(SHOP, listOf(OperationResult("operation", OperationStatus.REJECTED, code = "forbidden")), 1)
        assertNotNull(customer(input.id))
        assertEquals(0L, store.cursor(SHOP).lastPulledSeq)
        assertEquals(1, store.status(SHOP).first().rejectedCount)
        store.dismissIssue(SHOP, "operation")
        assertEquals(0, store.status(SHOP).first().rejectedCount)
    }

    protected suspend fun photoAndReversalContract() {
        val input = EntryInput("entry", "customer", EntryType.DEBT, 100, SyncFixtures.today)
        seed(SyncFixtures.entryEntity(input))
        val row =
            SyncFixtures
                .row("operation", SyncKind.ENTRY_CREATE, input.id, NetworkJson.encodeToString(input))
                .copy(photoEntryId = input.id, state = "BLOCKED")
        seed(row)
        val at = SyncFixtures.instant.toString()
        store.markPhoto(
            PendingPhotoEntity(input.id, SHOP, "encrypted", 3, state = "QUEUED", createdAt = at, updatedAt = at),
        )
        assertEquals(1, store.status(SHOP).first().blockedCount)
        assertEquals(0, store.queuedOperations(SHOP, 500).size)
        store.markPhoto(store.photo(SHOP, input.id)!!.copy(state = "READY", photoKey = "media/$SHOP/photo.jpg"))
        store.unblockEntry(SHOP, input.id)
        assertEquals(
            "media/$SHOP/photo.jpg",
            PushBatchBuilder(store)
                .build(SHOP)
                .operations
                .single()
                .entry
                ?.photoKey,
        )
        store.applyResults(SHOP, listOf(OperationResult("operation", OperationStatus.REJECTED, code = "conflict")), 0)
        assertNull(entry(input.id))
        assertNull(store.photo(SHOP, input.id))
        assertEquals(1, store.status(SHOP).first().rejectedCount)
    }
}
