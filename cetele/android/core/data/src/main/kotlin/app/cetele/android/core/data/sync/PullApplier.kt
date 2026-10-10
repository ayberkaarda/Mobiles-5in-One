package app.cetele.android.core.data.sync

import app.cetele.android.core.network.ApiResult
import app.cetele.android.core.network.api.SyncApi
import app.cetele.android.core.network.dto.sync.PullResponse
import javax.inject.Inject

class PullApplier(
    private val store: SyncLocalStore,
    private val api: SyncApi,
    private val limit: Int,
) {
    @Inject
    constructor(store: SyncLocalStore, api: SyncApi) : this(store, api, TransactionalSyncLocalStore.BATCH_LIMIT)

    init {
        require(limit in 1..TransactionalSyncLocalStore.BATCH_LIMIT)
    }

    suspend fun pull(shopId: String): ApiResult<Int> {
        var count = 0
        var result = nextPage(shopId)
        while (result is ApiResult.Success && result.value.hasMore) {
            count += result.value.changes.size
            result = nextPage(shopId)
        }
        return result.map { page -> count + page.changes.size }
    }

    /** Applies one page with its cursor; a page that claims more but cannot advance is a protocol error. */
    private suspend fun nextPage(shopId: String): ApiResult<PullResponse> {
        val since = store.cursor(shopId).lastPulledSeq
        val result = api.pull(shopId, since, limit)
        val page = result.getOrNull()
        return when {
            page == null -> {
                result
            }

            page.hasMore && (page.changes.isEmpty() || page.nextSince <= since) -> {
                ApiResult.Failure.Unexpected(PROTOCOL_ERROR)
            }

            else -> {
                store.applyChanges(shopId, page.changes, page.nextSince)
                result
            }
        }
    }

    private companion object {
        const val PROTOCOL_ERROR = 502
    }
}
