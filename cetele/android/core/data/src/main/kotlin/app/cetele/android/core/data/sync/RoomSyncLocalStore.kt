package app.cetele.android.core.data.sync

import androidx.room.useReaderConnection
import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.database.SyncCursorEntity
import app.cetele.android.core.data.database.entity.CustomerEntity
import app.cetele.android.core.data.database.entity.LedgerEntryEntity
import app.cetele.android.core.data.database.entity.PendingPhotoEntity
import app.cetele.android.core.data.database.writeTransaction
import app.cetele.android.core.data.media.EncryptedPhotoStore
import app.cetele.android.core.network.dto.OperationStatus
import app.cetele.android.core.network.dto.sync.OperationResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Clock
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
@Suppress("TooManyFunctions")
class RoomSyncLocalStore
    @Inject
    constructor(
        private val databases: DatabaseStore,
        clock: Clock,
        private val photos: EncryptedPhotoStore,
    ) : TransactionalSyncLocalStore(clock) {
        override suspend fun <T> transaction(block: suspend () -> T): T = databases.get().writeTransaction(block)

        // Indices match the explicit projection, independently of physical table column order.
        @Suppress("MagicNumber")
        override suspend fun outbox(shopId: String): List<OutboxRow> =
            databases.get().useReaderConnection { connection ->
                connection.usePrepared(
                    """
                    SELECT client_id, shop_id, kind, entity_id, payload_json, created_at, client_seq,
                    depends_on_client_id, photo_entry_id, state, attempts, last_code, errors_json,
                    updated_at FROM outbox_operations WHERE shop_id = ?
                    """.trimIndent(),
                ) { statement ->
                    statement.bindText(1, shopId)

                    fun text(index: Int): String? = if (statement.isNull(index)) null else statement.getText(index)
                    buildList {
                        while (statement.step()) {
                            add(
                                OutboxRow(
                                    statement.getText(0),
                                    statement.getText(1),
                                    statement.getText(2),
                                    statement.getText(3),
                                    statement.getText(4),
                                    statement.getText(5),
                                    if (statement.isNull(6)) null else statement.getLong(6),
                                    text(7),
                                    text(8),
                                    statement.getText(9),
                                    statement.getLong(10).toInt(),
                                    text(11),
                                    text(12),
                                    statement.getText(13),
                                ),
                            )
                        }
                    }
                }
            }

        override suspend fun putOutbox(row: OutboxRow) = databases.get().outboxDao().upsert(row)

        override suspend fun deleteOutbox(
            shopId: String,
            clientId: String,
        ) = databases.get().outboxDao().delete(shopId, clientId)

        override suspend fun getCustomer(
            shopId: String,
            id: String,
        ): CustomerEntity? = databases.get().customerDao().get(shopId, id)

        override suspend fun putCustomer(row: CustomerEntity) = databases.get().customerDao().upsert(row)

        override suspend fun deleteCustomer(
            shopId: String,
            id: String,
        ) = databases.get().customerDao().delete(shopId, id)

        override suspend fun getEntry(
            shopId: String,
            id: String,
        ): LedgerEntryEntity? = databases.get().ledgerEntryDao().get(shopId, id)

        override suspend fun putEntry(row: LedgerEntryEntity) = databases.get().ledgerEntryDao().upsert(row)

        override suspend fun deleteEntry(
            shopId: String,
            id: String,
        ) = databases.get().ledgerEntryDao().delete(shopId, id)

        override suspend fun cursor(shopId: String): SyncCursorEntity =
            databases.get().syncCursorDao().get(shopId) ?: SyncCursorEntity(shopId)

        override suspend fun putCursor(row: SyncCursorEntity) = databases.get().syncCursorDao().upsert(row)

        override suspend fun allPhotos(shopId: String): List<PendingPhotoEntity> =
            databases.get().pendingPhotoDao().all(shopId)

        override suspend fun photo(
            shopId: String,
            entryId: String,
        ): PendingPhotoEntity? = databases.get().pendingPhotoDao().get(shopId, entryId)

        override suspend fun markPhoto(row: PendingPhotoEntity) = databases.get().pendingPhotoDao().upsert(row)

        override suspend fun deletePhoto(
            shopId: String,
            entryId: String,
        ) = databases.get().pendingPhotoDao().delete(shopId, entryId)

        override suspend fun removePhoto(
            shopId: String,
            entryId: String,
        ) {
            super.removePhoto(shopId, entryId)
            photos.remove(entryId)
        }

        override suspend fun applyResults(
            shopId: String,
            results: List<OperationResult>,
            head: Long,
        ) {
            val rejected = results.filter { it.status == OperationStatus.REJECTED }.map { it.clientId }.toSet()
            val photoIds = outbox(shopId).filter { it.clientId in rejected }.mapNotNull { it.photoEntryId }
            super.applyResults(shopId, results, head)
            photoIds.forEach { photos.remove(it) }
        }

        override suspend fun shopsWithPending(): List<String> =
            databases
                .get()
                .shopDao()
                .all()
                .map { it.id }
                .filter { databases.get().outboxDao().countPending(it) > 0 }

        override fun observeRows(shopId: String): Flow<List<OutboxRow>> =
            databases
                .get()
                .invalidationTracker
                .createFlow("outbox_operations")
                .map { outbox(shopId) }

        override suspend fun discardPhotoFile(entryId: String) {
            photos.remove(entryId)
        }

        override fun observePhotos(shopId: String): Flow<List<PendingPhotoEntity>> =
            databases
                .get()
                .invalidationTracker
                .createFlow("pending_photos")
                .map { allPhotos(shopId) }

        override fun observeCursor(shopId: String): Flow<SyncCursorEntity> =
            databases
                .get()
                .invalidationTracker
                .createFlow("sync_cursor")
                .map { cursor(shopId) }
    }
