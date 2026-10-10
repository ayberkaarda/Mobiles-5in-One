package app.cetele.android.core.data.sync

import app.cetele.android.core.network.dto.sync.PushRequest
import javax.inject.Inject

class PushBatchBuilder
    @Inject
    constructor(
        private val store: SyncLocalStore,
    ) {
        suspend fun build(shopId: String): PushRequest {
            val rows = store.queuedOperations(shopId, TransactionalSyncLocalStore.BATCH_LIMIT)
            val seqs = store.assignClientSeqs(shopId, rows.map { it.clientId })
            return PushRequest(
                rows
                    .map { row ->
                        val photoKey = row.photoEntryId?.let { store.photo(shopId, it)?.photoKey }
                        OutboxPayloads.operation(row, seqs.getValue(row.clientId), photoKey)
                    }.sortedBy { it.clientSeq },
            )
        }
    }
