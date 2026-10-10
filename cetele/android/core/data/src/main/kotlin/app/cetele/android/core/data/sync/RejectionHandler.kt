package app.cetele.android.core.data.sync

import app.cetele.android.core.network.dto.sync.OperationResult
import javax.inject.Inject

class RejectionHandler
    @Inject
    constructor(
        private val store: SyncLocalStore,
    ) {
        suspend fun apply(
            shopId: String,
            results: List<OperationResult>,
            head: Long,
        ) {
            store.applyResults(shopId, results, head)
        }

        suspend fun blockBatch(
            shopId: String,
            ids: List<String>,
        ) {
            store.blockBatch(shopId, ids, "validation.failed")
        }
    }
