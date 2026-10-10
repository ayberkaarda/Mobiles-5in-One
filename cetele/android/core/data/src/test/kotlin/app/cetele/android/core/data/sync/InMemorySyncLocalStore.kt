package app.cetele.android.core.data.sync

import app.cetele.android.core.data.database.SyncCursorEntity
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Clock

@Suppress("TooManyFunctions")
class InMemorySyncLocalStore(
    clock: Clock = SyncFixtures.clock,
) : TransactionalSyncLocalStore(clock) {
    val customers = linkedMapOf<Pair<String, String>, CustomerEntity>()
    val entries = linkedMapOf<Pair<String, String>, LedgerEntryEntity>()
    val operations = linkedMapOf<Pair<String, String>, OutboxRow>()
    val photos = linkedMapOf<Pair<String, String>, PendingPhotoEntity>()
    private val cursors = linkedMapOf<String, SyncCursorEntity>()
    private val changes = MutableStateFlow(0L)
    private val mutex = Mutex()

    override suspend fun <T> transaction(block: suspend () -> T): T =
        mutex.withLock {
            val savedCustomers = customers.toMap()
            val savedEntries = entries.toMap()
            val savedOperations = operations.toMap()
            val savedPhotos = photos.toMap()
            val savedCursors = cursors.toMap()
            var committed = false
            try {
                block().also { committed = true }
            } finally {
                if (!committed) {
                    customers.clear()
                    customers.putAll(savedCustomers)
                    entries.clear()
                    entries.putAll(savedEntries)
                    operations.clear()
                    operations.putAll(savedOperations)
                    photos.clear()
                    photos.putAll(savedPhotos)
                    cursors.clear()
                    cursors.putAll(savedCursors)
                }
                changes.value += 1
            }
        }

    suspend fun seed(row: OutboxRow) {
        putOutbox(row)
    }

    suspend fun seed(row: CustomerEntity) {
        putCustomer(row)
    }

    suspend fun seed(row: LedgerEntryEntity) {
        putEntry(row)
    }

    override suspend fun outbox(shopId: String): List<OutboxRow> = operations.values.filter { it.shopId == shopId }

    override suspend fun putOutbox(row: OutboxRow) {
        operations[row.shopId to row.clientId] = row
    }

    override suspend fun deleteOutbox(
        shopId: String,
        clientId: String,
    ) {
        operations.remove(shopId to clientId)
    }

    override suspend fun getCustomer(
        shopId: String,
        id: String,
    ): CustomerEntity? = customers[shopId to id]

    override suspend fun putCustomer(row: CustomerEntity) {
        customers[row.shopId to row.id] = row
    }

    override suspend fun deleteCustomer(
        shopId: String,
        id: String,
    ) {
        customers.remove(shopId to id)
    }

    override suspend fun getEntry(
        shopId: String,
        id: String,
    ): LedgerEntryEntity? = entries[shopId to id]

    override suspend fun putEntry(row: LedgerEntryEntity) {
        entries[row.shopId to row.id] = row
    }

    override suspend fun deleteEntry(
        shopId: String,
        id: String,
    ) {
        entries.remove(shopId to id)
    }

    override suspend fun cursor(shopId: String): SyncCursorEntity = cursors[shopId] ?: SyncCursorEntity(shopId)

    override suspend fun putCursor(row: SyncCursorEntity) {
        cursors[row.shopId] = row
    }

    override suspend fun allPhotos(shopId: String): List<PendingPhotoEntity> =
        photos.values.filter {
            it.shopId ==
                shopId
        }

    override suspend fun photo(
        shopId: String,
        entryId: String,
    ): PendingPhotoEntity? = photos[shopId to entryId]

    override suspend fun markPhoto(row: PendingPhotoEntity) {
        photos[row.shopId to row.entryId] = row
        changes.value +=
            1
    }

    override suspend fun deletePhoto(
        shopId: String,
        entryId: String,
    ) {
        photos.remove(shopId to entryId)
    }

    override suspend fun shopsWithPending(): List<String> =
        operations.values
            .filter {
                it.state != "REJECTED"
            }.map { it.shopId }
            .distinct()

    override fun observeRows(shopId: String): Flow<List<OutboxRow>> = changes.map { outbox(shopId) }

    override fun observeCursor(shopId: String): Flow<SyncCursorEntity> = changes.map { cursor(shopId) }

    override fun observePhotos(shopId: String): Flow<List<PendingPhotoEntity>> = changes.map { allPhotos(shopId) }

    /** Entry ids whose local photo file the store asked to discard. */
    val discardedFiles = mutableListOf<String>()

    override suspend fun discardPhotoFile(entryId: String) {
        discardedFiles += entryId
    }
}
