package app.cetele.android.core.data.repository

import app.cetele.android.core.data.database.DatabaseStore
import app.cetele.android.core.data.media.CompressedPhoto
import app.cetele.android.core.data.write.EntryDraft
import app.cetele.android.core.data.write.LocalWriteService
import app.cetele.android.core.data.write.WriteResult
import app.cetele.android.core.domain.model.LedgerEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.LocalDate
import javax.inject.Inject

interface LedgerRepository {
    fun observeEntries(
        shopId: String,
        customerId: String,
    ): Flow<List<LedgerEntry>>

    suspend fun get(
        shopId: String,
        id: String,
    ): LedgerEntry?

    suspend fun create(
        shopId: String,
        draft: EntryDraft,
        photo: CompressedPhoto? = null,
    ): WriteResult

    suspend fun reverse(
        shopId: String,
        id: String,
        today: LocalDate,
    ): WriteResult

    fun observeAll(shopId: String): Flow<List<LedgerEntry>>
}

class RoomLedgerRepository
    @Inject
    constructor(
        private val databases: DatabaseStore,
        private val writes: LocalWriteService,
    ) : LedgerRepository {
        override fun observeEntries(
            shopId: String,
            customerId: String,
        ): Flow<List<LedgerEntry>> =
            databases.get().ledgerEntryDao().observeForCustomer(shopId, customerId).map { rows ->
                rows.map { it.asModel() }
            }

        override suspend fun get(
            shopId: String,
            id: String,
        ): LedgerEntry? =
            databases
                .get()
                .ledgerEntryDao()
                .get(shopId, id)
                ?.asModel()

        override suspend fun create(
            shopId: String,
            draft: EntryDraft,
            photo: CompressedPhoto?,
        ): WriteResult = writes.createEntry(shopId, draft, photo)

        override suspend fun reverse(
            shopId: String,
            id: String,
            today: LocalDate,
        ): WriteResult = writes.reverseEntry(shopId, id, today)

        override fun observeAll(shopId: String): Flow<List<LedgerEntry>> =
            databases.get().ledgerEntryDao().observeAllForExport(shopId).map { rows ->
                rows.map {
                    it.asModel()
                }
            }
    }
